// ============================================================================
// RECOMMENDATION SERVICE — deterministic amenity-aware property ranking
// ============================================================================
// Takes the small candidate-property list ragService.js already produces
// (currently capped at CONFIG.MAX_RESULTS = 5) plus the amenity requirements
// intentService.js already extracts, and:
//
//   1. For each candidate property, checks each requested amenity category
//      against REAL PointOfInterest data via the existing
//      poiService.findNearbyPOIs() - no duplicate MongoDB/POI query logic.
//   2. Produces structured, ID-free-of-invention evidence per property:
//      which amenities were actually verified nearby, with the real POI
//      name/distance, or matched:false + nearestPOI:null when nothing real
//      was found.
//   3. Ranks candidates deterministically from that evidence alone - more
//      verified matches first, then shorter total matched distance as a
//      tie-breaker, otherwise stable (original order preserved).
//
// The LLM never decides ranking or invents facts here - see ragService.js's
// generateReply(), which only ever describes this pre-computed evidence.
//
// Straight-line/geospatial POI distance (above) is always the first-stage
// evidence layer. enrichWithTravelTime() (below) optionally refines already-
// matched amenities with real Valhalla travel time/distance via
// routingService.getMatrix() - the same matrix function
// accessibilityService.js uses, reused directly rather than duplicated.
// Travel time is a pure enhancement: it never decides matched/unmatched
// (that's already settled by the geospatial radius check above) and a
// Valhalla failure degrades to travel:null, never breaks the recommendation.
// ============================================================================

const poiService = require("./poiService");
const routingService = require("./routingService");

// Matches accessibilityService.js's own DEFAULT_MODE, for consistency with
// the rest of the app's travel-time features. Not exposed as a per-request
// option here (intentService's amenity schema deliberately isn't touched by
// this task), same conservative default used elsewhere.
const DEFAULT_TRAVEL_MODE = "driving";

// ============================================================================
// COORDINATE VALIDITY
// ============================================================================
// Mirrors the exact gate propertyDescriptionService.js's getNearbyPOIHighlights
// already uses for the same "is this property's location trustworthy enough
// to derive real nearby-place claims from" question - "district-level" and
// "unknown" are deliberately never treated as usable evidence here, and this
// never falls back to a display-only district/division centroid (that
// fallback exists only in src/shared/propertyLocation.js's
// getPropertyDisplayCoordinates, for map rendering - never appropriate for
// amenity-distance claims).
function getVerifiableCoordinates(property) {
  const accuracy = property?.locationAccuracy;
  if (accuracy !== "precise" && accuracy !== "approximate") return null;

  // Canonical field per the project's own geospatial convention (2dsphere-
  // indexed, [lng, lat] - same as ragService.js's addDistanceInfo already
  // reads for its own distance calculation).
  const coords = property?.geoLocation?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;

  const [lng, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };
}

// ============================================================================
// PER-AMENITY NEAREST-MATCH LOOKUP
// ============================================================================
// No default radius is invented here - when the user gave no maxDistance_km,
// this reuses poiService's OWN existing default radius
// (DEFAULT_MAX_DISTANCE_METERS, currently 2000m), rather than picking a new
// number specific to this feature.
async function findNearestAmenityMatch(point, amenity) {
  const maxDistanceMeters =
    amenity.maxDistance_km != null
      ? Math.round(amenity.maxDistance_km * 1000) // km -> meters
      : poiService.DEFAULT_MAX_DISTANCE_METERS;

  let results = [];
  try {
    // limit: 1 - findNearbyPOIs already returns nearest-first ($geoNear),
    // so the single closest result within range is exactly what "the
    // nearest valid matching POI" means. Never invents a POI: an empty
    // result here means matched:false, never a fabricated placeholder.
    results = await poiService.findNearbyPOIs({
      lat: point.lat,
      lng: point.lng,
      category: amenity.category,
      maxDistance: maxDistanceMeters,
      limit: 1,
    });
  } catch (error) {
    // Read-only lookup - never let a POI query failure block the whole
    // recommendation; same fail-safe convention as
    // propertyDescriptionService.js's getNearbyPOIHighlights.
    console.error(
      `[RecommendationService] POI lookup failed for category "${amenity.category}":`,
      error.message
    );
    results = [];
  }

  const nearest = results[0] || null;

  return {
    category: amenity.category,
    requestedMaxDistanceKm: amenity.maxDistance_km ?? null,
    matched: !!nearest,
    nearestPOI: nearest
      ? {
          name: nearest.name || nearest.nameEn || nearest.nameBn || null,
          distanceMeters: nearest.distanceMeters,
          // Kept only so enrichWithTravelTime() below can route to this
          // exact already-verified POI without a second poiService query -
          // never displayed directly, never used to change matched/unmatched.
          geoLocation: nearest.geoLocation,
        }
      : null,
    // Always present (even when unmatched, for a consistent shape) -
    // populated by enrichWithTravelTime() only when a real Valhalla
    // duration was obtained for this exact matched POI. Never set from
    // straight-line distance, never estimated.
    travel: null,
  };
}

// ============================================================================
// PER-PROPERTY ANALYSIS
// ============================================================================
async function analyzeProperty(property, amenities) {
  const point = getVerifiableCoordinates(property);

  // No precise/approximate, finite coordinates: never claim any amenity
  // matched - still return a fully-shaped result (all matched:false) so
  // ranking and the prompt can treat "couldn't verify" uniformly, not as a
  // special case that needs separate handling downstream.
  const amenityMatches = point
    ? await Promise.all(
        amenities.map((amenity) => findNearestAmenityMatch(point, amenity))
      )
    : amenities.map((amenity) => ({
        category: amenity.category,
        requestedMaxDistanceKm: amenity.maxDistance_km ?? null,
        matched: false,
        nearestPOI: null,
        travel: null,
      }));

  const matchedAmenityCount = amenityMatches.filter((m) => m.matched).length;

  return {
    property,
    amenityMatches,
    matchedAmenityCount,
    requestedAmenityCount: amenities.length,
    // Lets callers/prompts distinguish "no amenity matched because none
    // exist nearby" from "no amenity matched because this property's
    // location isn't trustworthy enough to check at all".
    hasVerifiableLocation: !!point,
  };
}

// ============================================================================
// PUBLIC: analyze a (small) candidate set against requested amenities
// ============================================================================
// Callers are expected to pass an already-small candidate list - this
// mirrors ragService.js's own CONFIG.MAX_RESULTS (currently 5), so no
// additional internal cap/pagination is added here. Each property triggers
// at most `amenities.length` tiny indexed $geoNear queries (limit: 1 each).
async function analyzeCandidates(properties, amenities) {
  if (!Array.isArray(amenities) || amenities.length === 0) return [];
  if (!Array.isArray(properties) || properties.length === 0) return [];

  return Promise.all(
    properties.map((property) => analyzeProperty(property, amenities))
  );
}

// ============================================================================
// TRAVEL-TIME REFINEMENT (Valhalla) - optional, additive, never authoritative
// ============================================================================
// Only ever routes to an amenity that ALREADY passed the geospatial
// matched:true check above - never an unmatched or invented POI, and never
// for a property whose location isn't precise/approximate (same
// getVerifiableCoordinates gate as the straight-line stage).
//
// One routingService.getMatrix() call PER PROPERTY (1 origin, one
// destination per already-matched amenity - typically 1-3 for a real
// chatbot query) - reuses the exact same matrix function
// accessibilityService.js already uses for its own travel-time features, no
// duplicated Valhalla HTTP logic. Never falls back to per-amenity
// getRoute() retries the way accessibilityService.findNearbyPOIsByTravelTime
// does for its own null-cell recovery - that would add up to 3 extra calls
// per property on top of the matrix call, and Step 4's own contract already
// accepts "travel unavailable" as a normal, non-error outcome, so the extra
// calls aren't justified here. A property with zero matched amenities makes
// zero Valhalla calls (nothing to route to).
//
// A Valhalla failure (unreachable engine, no route, timeout, or
// misconfiguration) for a given property is caught and swallowed: every
// already-computed geospatial fact (matched, nearestPOI, distanceMeters)
// is left completely untouched, and every amenityMatches[].travel simply
// stays null. This deliberately differs from accessibilityService.js's own
// getAccessibilitySummary(), which lets RoutingError propagate - there,
// travel time IS the feature being requested, so a failure should surface;
// here, travel time is an enhancement layered onto an already-complete
// straight-line recommendation, so POST /api/ai/chatbot must keep working
// even if Valhalla is completely down.
async function enrichWithTravelTime(evidenceList, mode = DEFAULT_TRAVEL_MODE) {
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) return evidenceList;

  await Promise.all(
    evidenceList.map(async (evidence) => {
      if (!evidence.hasVerifiableLocation) return; // same coordinate-trust gate as the geospatial stage

      const point = getVerifiableCoordinates(evidence.property);
      if (!point) return;

      // Only already-matched amenities with a real, geolocated POI - never
      // an unmatched entry, never one without usable coordinates.
      const routable = evidence.amenityMatches.filter(
        (m) =>
          m.matched &&
          m.nearestPOI &&
          m.nearestPOI.geoLocation &&
          Array.isArray(m.nearestPOI.geoLocation.coordinates) &&
          m.nearestPOI.geoLocation.coordinates.length === 2
      );
      if (routable.length === 0) return;

      const destinations = routable.map((m) => {
        const [lng, lat] = m.nearestPOI.geoLocation.coordinates;
        return { lat, lng };
      });

      try {
        const matrix = await routingService.getMatrix({
          origins: [point],
          destinations,
          mode,
        });
        const durations = matrix.durationsSeconds[0] || [];
        const distances = matrix.distancesMeters[0] || [];

        routable.forEach((m, i) => {
          const durationSeconds = durations[i];
          const distanceMeters = distances[i];
          // Valhalla's matrix returns null for a cell it can't solve
          // (documented behavior, see routingService.getMatrix) - that is
          // NOT an error, just "no verified travel data for this pair".
          if (typeof durationSeconds === "number") {
            m.travel = {
              durationMinutes: Math.round((durationSeconds / 60) * 10) / 10,
              distanceKm:
                typeof distanceMeters === "number"
                  ? Math.round((distanceMeters / 1000) * 10) / 10
                  : null,
              mode,
            };
          }
          // else: leave m.travel as the null default set in findNearestAmenityMatch
        });
      } catch (error) {
        // Non-fatal by design - see the function-level comment above.
        // error.message only, matching the rest of this file's convention.
        console.error(
          `[RecommendationService] Travel-time enrichment failed for "${evidence.property?.title || evidence.property?._id}" (non-fatal):`,
          error.message
        );
      }
    })
  );

  return evidenceList;
}

// ============================================================================
// DETERMINISTIC RANKING
// ============================================================================
// Sum of nearest-POI distances for MATCHED amenities only - a pure
// tie-breaker (rule 2 below). Unmatched entries contribute 0, so this never
// penalizes a property beyond what matchedAmenityCount (the primary sort
// key) already accounts for.
function sumMatchedDistanceMeters(evidence) {
  return evidence.amenityMatches.reduce(
    (sum, m) => sum + (m.matched ? m.nearestPOI.distanceMeters : 0),
    0
  );
}

// Sum of verified travel duration (minutes) across MATCHED amenities only -
// returns null, not a partial number, if ANY matched amenity is missing
// real travel data (Valhalla never ran, failed, or returned an unreachable
// cell for that pair). A partial travel comparison isn't meaningful, so an
// incomplete total intentionally can't win a tie-break; the caller falls
// back to the straight-line comparator in that case instead.
function sumMatchedTravelMinutes(evidence) {
  const matched = evidence.amenityMatches.filter((m) => m.matched);
  if (matched.length === 0) return null;

  let total = 0;
  for (const m of matched) {
    if (!m.travel || typeof m.travel.durationMinutes !== "number") return null;
    total += m.travel.durationMinutes;
  }
  return total;
}

// Priority, in order:
//   1. More matched requested-amenity categories ranks higher.
//   2. Equal match count -> when BOTH properties have complete, real
//      Valhalla travel data for every matched amenity, shorter total
//      verified travel time ranks higher (a genuine, non-invented refinement
//      over straight-line distance).
//   3. Equal match count AND (travel data incomplete/unavailable for either
//      side, or travel times tie) -> shorter total straight-line distance
//      across matched amenities ranks higher (the original, always-available
//      comparator).
//   4. Still equal -> original (candidate) order is preserved. Array.sort is
//      stable in Node/V8 (guaranteed since ES2019), so this needs no extra
//      tie-break key.
// No AI-generated or opaque score anywhere in this comparator - every input
// is a real, already-computed count, duration, or distance. The LLM never
// participates in this decision.
function rankEvidence(evidenceList) {
  return [...evidenceList].sort((a, b) => {
    if (b.matchedAmenityCount !== a.matchedAmenityCount) {
      return b.matchedAmenityCount - a.matchedAmenityCount;
    }

    const travelA = sumMatchedTravelMinutes(a);
    const travelB = sumMatchedTravelMinutes(b);
    if (travelA !== null && travelB !== null && travelA !== travelB) {
      return travelA - travelB;
    }

    return sumMatchedDistanceMeters(a) - sumMatchedDistanceMeters(b);
  });
}

module.exports = {
  analyzeCandidates,
  enrichWithTravelTime,
  rankEvidence,
};
