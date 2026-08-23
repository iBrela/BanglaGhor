// ============================================================================
// ROUTING SERVICE — Valhalla client
// ============================================================================
// Talks to a self-hosted Valhalla instance (see server/tools/README-routing-
// setup.md for how to build/run one locally) over plain HTTP. Valhalla is a
// separate, long-running service - it can never be embedded in the Node
// process (in production the backend runs as a Netlify Function, which is
// stateless/short-lived), so every call here is a real network request that
// can fail independently of BanglaGhor's own backend.
//
// This module owns exactly two concerns: talking to Valhalla, and turning
// its response (or failure) into BanglaGhor's own stable shape. Request
// validation (coordinate bounds, mode enum, etc.) happens in
// routingController.js, one layer up, matching the poiController.js/
// poiService.js split from M3.
// ============================================================================

const axios = require("axios");
const polyline = require("@mapbox/polyline");
const NodeCache = require("node-cache");

// No hardcoded fallback URL - env controls deployment. If VALHALLA_URL isn't
// set, every routing request fails as ENGINE_UNAVAILABLE (see below) rather
// than the server crashing at startup - unlike MONGO_URI, the whole app does
// not depend on routing, so a missing/misconfigured Valhalla must not break
// M1/M2/M3 behavior.
const VALHALLA_URL = process.env.VALHALLA_URL;

const REQUEST_TIMEOUT_MS = 8000;

// BanglaGhor travel mode -> Valhalla costing model. Valhalla has many more
// costing models (bus, truck, motor_scooter, ...) - BanglaGhor only exposes
// the three that make sense for a real-estate accessibility question.
const MODE_TO_COSTING = {
  driving: "auto",
  walking: "pedestrian",
  cycling: "bicycle",
};

// ============================================================================
// CACHE
// ============================================================================
// Single-route results only (see getMatrix below for why matrix is left
// uncached in this phase). Keyed on mode + rounded coordinates + whether
// geometry was requested, so a geometry=true call never serves a
// geometry=false cache entry or vice versa.
//
// Coordinate rounding: 4 decimal degrees. At Bangladesh's latitude
// (~20-27N) that's roughly 11m of latitude and ~10m of longitude
// (1 degree longitude * cos(24 deg) ~ 101.4km, /10000 ~ 10.1m) - the same
// order of magnitude as the ~11m CENTER_EPSILON_DEGREES tolerance already
// used in MapComponent.js for "is this the same point" comparisons. For
// property-to-POI accessibility questions (the intended use of this API),
// snapping two requests that differ by less than ~10m onto the same cached
// route is the right tradeoff - GPS/geocoding precision is rarely better
// than that anyway, and it turns "the same property, queried again" into a
// guaranteed cache hit.
//
// TTL: 24 hours. A route between two fixed points only changes when the
// underlying road network changes - i.e. only when Valhalla's tiles are
// rebuilt from fresh OSM data, which is an infrequent, deliberate operation
// (see README-routing-setup.md), not something that happens intra-day. A
// much longer TTL (days) would be defensible on pure routing-stability
// grounds, but property coordinates themselves are user-submitted and can
// be corrected by an owner/admin at any time - 24h bounds how long a stale
// property location can keep serving a now-wrong cached distance, without
// throwing away the vast majority of the caching benefit (repeated queries
// against the same property/POI pair within the same day, which is the
// realistic access pattern this is optimizing for).
const ROUTE_CACHE_TTL_SECONDS = 24 * 60 * 60;

const routeCache = new NodeCache({
  stdTTL: ROUTE_CACHE_TTL_SECONDS,
  checkperiod: 3600,
  useClones: false,
});

function roundCoord(n) {
  return Number(n.toFixed(4));
}

function routeCacheKey({ mode, originLat, originLng, destLat, destLng, geometry }) {
  return [
    "route",
    mode,
    `${roundCoord(originLat)},${roundCoord(originLng)}`,
    `${roundCoord(destLat)},${roundCoord(destLng)}`,
    geometry ? "geom" : "nogeom",
  ].join(":");
}

// ============================================================================
// ERROR TYPE
// ============================================================================
// routingController.js maps `type` to an HTTP status. Keeping the
// distinction here (where the actual Valhalla response/error is available)
// rather than in the controller, since only this layer can tell the
// difference between "Valhalla responded with a structured error" and
// "Valhalla could not be reached at all".
class RoutingError extends Error {
  constructor(type, message, cause) {
    super(message);
    this.name = "RoutingError";
    this.type = type; // "NO_ROUTE" | "ENGINE_UNAVAILABLE" | "UNEXPECTED"
    this.cause = cause;
  }
}

// Classifies an axios failure (or a structurally-wrong success response)
// from a Valhalla call. Coordinates have already been validated as
// well-formed and within Bangladesh by the controller before this module is
// ever called, so a structured 4xx error response from Valhalla at this
// point means Valhalla itself could not find a route for otherwise-valid
// input (e.g. a point with no nearby routable edge) - that is BanglaGhor's
// NO_ROUTE case, not an input-validation failure.
function classifyValhallaError(error) {
  if (error.response) {
    // Valhalla responded, just not with a successful route. Verified during
    // Phase A testing: Valhalla's own error responses are always structured
    // JSON with an "error" string and "error_code" (e.g. 171 "No suitable
    // edges near location"), returned as HTTP 400 - never a raw crash.
    if (typeof error.response.data?.error === "string") {
      return new RoutingError(
        "NO_ROUTE",
        `Valhalla returned no route: ${error.response.data.error}`,
     .m  if (!VALHALLA_URL) {
    throw new RoutingError(
      "ENGINE_UNAVAILABLE",
      "VALHALLA_URL is not configured"
    );
  }
  try {
    const response = await axios.get(`${VALHALLA_URL}${path}`, {
      params: { json: JSON.stringify(payload) },
      timeout: REQUEST_TIMEOUT_MS,
    });
    return response.data;
  } catch (error) {
    if (error instanceof RoutingError) throw error;
    throw classifyValhallaError(error);
  }
}

// Decodes Valhalla's polyline6-encoded leg shapes into a single GeoJSON
// LineString. Valhalla uses 6 decimal digits of precision (verified against
// real Phase A route responses and Valhalla's own docs) - NOT the 5-digit
// precision @mapbox/polyline defaults to, which would silently produce
// wrong coordinates if left unspecified.
//
// A single-leg route (the only kind BanglaGhor's 2-point /route requests
// produce) has exactly one shape string, but this concatenates all legs'
// points in order for robustness rather than assuming leg count.
function legsToGeoJSON(legs) {
  const coordinates = [];
  for (const leg of legs) {
    const points = polyline.decode(leg.shape, 6); // [[lat, lng], ...]
    for (const [lat, lng] of points) {
      coordinates.push([lng, lat]); // GeoJSON order: [lng, lat]
    }
  }
  return { type: "LineString", coordinates };
}

// ============================================================================
// SINGLE ROUTE
// ============================================================================
async function getRoute({ originLat, originLng, destLat, destLng, mode, geometry }) {
  const cacheKey = routeCacheKey({ mode, originLat, originLng, destLat, destLng, geometry });
  const cached = routeCache.get(cacheKey);
  if (cached) return cached;

  const payload = {
    locations: [
      { lat: originLat, lon: originLng },
      { lat: destLat, lon: destLng },
    ],
    costing: MODE_TO_COSTING[mode],
    units: "kilometers",
  };

  const data = await callValhalla("/route", payload);

  if (!data.trip || !data.trip.summary) {
    throw new RoutingError(
      "UNEXPECTED",
      "Valhalla response was missing trip.summary"
    );
  }

  const result = {
    distanceMeters: Math.round(data.trip.summary.length * 1000),
    durationSeconds: Math.round(data.trip.summary.time),
    mode,
    geometry: geometry ? legsToGeoJSON(data.trip.legs) : null,
  };

  routeCache.set(cacheKey, result);
  return result;
}

// ============================================================================
// MATRIX
// ============================================================================
// Deliberately uncached in Phase B. A correct matrix cache would need to
// cache at the level of individual source-target cells (so a partially-
// overlapping later request could reuse some cells) rather than the whole
// request, which is meaningfully more complex than the single-route cache
// above - not justified until there's a real access pattern (Phase E's
// POI/property integration) showing matrix calls are actually repeated
// often enough to matter. Left uncached and documented rather than adding
// that complexity speculatively.
async function getMatrix({ origins, destinations, mode }) {
  const payload = {
    sources: origins.map((o) => ({ lat: o.lat, lon: o.lng })),
    targets: destinations.map((d) => ({ lat: d.lat, lon: d.lng })),
    costing: MODE_TO_COSTING[mode],
    units: "kilometers",
  };

  const data = await callValhalla("/sources_to_targets", payload);

  if (!Array.isArray(data.sources_to_targets)) {
    throw new RoutingError(
      "UNEXPECTED",
      "Valhalla matrix response was missing sources_to_targets"
    );
  }

  // Row-major, same shape Valhalla itself returns - each row already
  // corresponds to one source, each cell to one target, in order. Verified
  // against a real Phase A 3x3 matrix response. Unreachable cells come back
  // from Valhalla with time/distance already null (documented Valhalla
  // behavior) - passed through as null rather than guessed at or coerced.
  const durationsSeconds = data.sources_to_targets.map((row) =>
    row.map((cell) => (cell.time === null || cell.time === undefined ? null : Math.round(cell.time)))
  );
  const distancesMeters = data.sources_to_targets.map((row) =>
    row.map((cell) =>
      cell.distance === null || cell.distance === undefined
        ? null
        : Math.round(cell.distance * 1000)
    )
  );

  return { durationsSeconds, distancesMeters, mode };
}

module.exports = {
  getRoute,
  getMatrix,
  RoutingError,
  MODE_TO_COSTING,
  roundCoord,
};
