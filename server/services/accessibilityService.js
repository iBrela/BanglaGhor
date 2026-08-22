// ============================================================================
// ACCESSIBILITY SERVICE — travel-time-ranked POI accessibility
// ============================================================================
// Answers "which hospital/school/etc. is actually nearest by travel time",
// not just nearest in a straight line. Reuses the two already-proven
// building blocks rather than duplicating any geospatial/routing logic:
//
//   Stage 1: poiService.findNearbyPOIs()  - cheap MongoDB $geoNear shortlist
//   Stage 2: routingService.getMatrix()   - real travel distance/time for
//                                            just that shortlist
//
// Talks to routingService directly (in-process function calls) - never
// makes an HTTP request to this server's own /api/routing/* endpoints.
// ============================================================================

const poiService = require("./poiService");
const routingService = require("./routingService");

const DEFAULT_MODE = "driving";
// Straight-line candidate radius, per mode. Sized generously relative to
// the "real" travel radius a caller usually means, since travel distance is
// always >= straight-line distance (Phase C measured real Bangladesh
// ratios of 1.5-2.2x for urban/river/rural/hill-tract routes) - too tight a
// candidate radius risks never even shortlisting the POI that turns out to
// be nearest by actual travel time. Walking gets a smaller default since a
// straight-line candidate beyond ~2km is very rarely a realistic walking
// option and would just waste matrix cells on candidates no one would
// actually walk to.
const DEFAULT_RADIUS_METERS_BY_MODE = {
  driving: 5000,
  walking: 2000,
  cycling: 3000,
};
const DEFAULT_CANDIDATE_LIMIT = 12;
const DEFAULT_RESULT_LIMIT = 5;

// Caps how many null (Phase C: "unreachable-by-matrix") cells get a
// single-route fallback retry per call. Phase C proved this divergence is
// real (a pair Valhalla's matrix reports as unreachable can still succeed
// via a direct /route call) but also found it RARE in real testing (one
// instance across all matrix testing). A small, fixed cap absorbs that
// realistic case - deliberately not "retry every null", since a request
// with many genuinely unreachable candidates (e.g. a query point in a
// sparse rural area) must not balloon into dozens of extra Valhalla calls.
const MAX_FALLBACK_CALLS = 3;

function defaultRadiusForMode(mode) {
  return DEFAULT_RADIUS_METERS_BY_MODE[mode] || DEFAULT_RADIUS_METERS_BY_MODE[DEFAULT_MODE];
}

function pointFromPOI(poi) {
  const coords = poi.geoLocation?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  return { lat: coords[1], lng: coords[0] };
}

// ============================================================================
// findNearbyPOIsByTravelTime
// ============================================================================
async function findNearbyPOIsByTravelTime({
  lat,
  lng,
  category,
  mode = DEFAULT_MODE,
  candidateRadius,
  candidateLimit = DEFAULT_CANDIDATE_LIMIT,
  resultLimit = DEFAULT_RESULT_LIMIT,
  maxTravelTimeSeconds,
}) {
  const radius = candidateRadius || defaultRadiusForMode(mode);

  // Stage 1: cheap straight-line shortlist.
  const candidates = await poiService.findNearbyPOIs({
    lat,
    lng,
    category,
    maxDistance: radius,
    limit: candidateLimit,
  });

  if (candidates.length === 0) {
    return { results: [] };
  }

  const points = candidates.map(pointFromPOI);

  // Stage 2: real travel distance/time for the whole shortlist in one call.
  const matrix = await routingService.getMatrix({
    origins: [{ lat, lng }],
    destinations: points,
    mode,
  });

  const durations = matrix.durationsSeconds[0];
  const distances = matrix.distancesMeters[0];

  const nullIndexes = durations
    .map((d, i) => (d === null ? i : -1))
    .filter((i) => i !== -1)
    .slice(0, MAX_FALLBACK_CALLS);

  await Promise.all(
    nullIndexes.map(async (i) => {
      try {
        const route = await routingService.getRoute({
          originLat: lat,
          originLng: lng,
          destLat: points[i].lat,
          destLng: points[i].lng,
          mode,
          geometry: false,
        });
        durations[i] = route.durationSeconds;
        distances[i] = route.distanceMeters;
      } catch (err) {
        // Still unreachable, or a one-off engine hiccup for just this
        // candidate - leave as null (excluded below). A single candidate
        // failing here must never fail the whole request; a systemic
        // failure (engine fully down) already threw earlier, at the
        // getMatrix() call above, and propagates normally.
      }
    })
  );

  let results = candidates
    .map((poi, i) => ({
      poi: {
        id: poi.id,
        name: poi.name,
        nameBn: poi.nameBn,
        nameEn: poi.nameEn,
        category: poi.category,
        geoLocation: poi.geoLocation,
      },
      straightLineDistanceMeters: poi.distanceMeters,
      routeDistanceMeters: distances[i] ?? null,
      durationSeconds: durations[i] ?? null,
    }))
    // Excludes candidates still unreachable after the fallback above -
    // never surfaced as an error, just absent from results (matches "no
    // result survives the filter" being a clean empty set, not a failure).
    .filter((r) => r.durationSeconds !== null);

  if (typeof maxTravelTimeSeconds === "number") {
    results = results.filter((r) => r.durationSeconds <= maxTravelTimeSeconds);
  }

  results.sort((a, b) => a.durationSeconds - b.durationSeconds);

  return {
    results: results.slice(0, resultLimit).map((r) => ({
      ...r,
      durationMinutes: Math.round((r.durationSeconds / 60) * 10) / 10,
    })),
  };
}

// ============================================================================
// getAccessibilitySummary — nearest-by-travel-time across a fixed set of
// everyday categories, for a single point (a property).
// ============================================================================
// Fixed, small category list and a conservative per-category candidateLimit
// (well below the general endpoint's default) so one summary request has a
// bounded, predictable cost: 5 matrix calls (one per category) plus, worst
// case, up to MAX_FALLBACK_CALLS single-route fallbacks each - never
// "dozens" of route calls even in the worst case.
const SUMMARY_CATEGORIES = ["hospital", "school", "marketplace", "pharmacy", "place_of_worship"];
const SUMMARY_CANDIDATE_LIMIT = 6;

async function getAccessibilitySummary({ lat, lng, mode = DEFAULT_MODE }) {
  // No per-category try/catch: a genuine failure (engine down, or the
  // origin point itself unroutable) is a systemic problem that should fail
  // the whole summary honestly via the normal RoutingError propagation the
  // controller already handles - not be silently swallowed into a
  // misleadingly-empty summary. "No POI found for this category" is NOT an
  // error in this design (findNearbyPOIsByTravelTime returns an empty
  // results array normally), so it naturally becomes `null` below without
  // needing a catch at all.
  const entries = await Promise.all(
    SUMMARY_CATEGORIES.map(async (category) => {
      const { results } = await findNearbyPOIsByTravelTime({
        lat,
        lng,
        category,
        mode,
        candidateLimit: SUMMARY_CANDIDATE_LIMIT,
        resultLimit: 1,
      });
      return [category, results[0] || null];
    })
  );
  return Object.fromEntries(entries);
}

module.exports = {
  findNearbyPOIsByTravelTime,
  getAccessibilitySummary,
  DEFAULT_RADIUS_METERS_BY_MODE,
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_RESULT_LIMIT,
  SUMMARY_CATEGORIES,
  defaultRadiusForMode,
};
