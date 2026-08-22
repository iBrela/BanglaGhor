// ============================================================================
// ROUTING CONTROLLER — thin HTTP layer over routingService
// ============================================================================
// Public, unauthenticated (matches the existing /api/properties,
// /api/locations/search, and /api/pois/nearby pattern). All business-rule
// validation (Bangladesh bounds, mode enum, matrix cell cap) lives here,
// same split as poiController.js - routingRoutes.js only checks basic
// shape/type via express-validator before this runs.
// ============================================================================

const routingService = require("../services/routingService");
const { isWithinBangladesh } = require("../../src/shared/bangladeshGeo");

const VALID_MODES = Object.keys(routingService.MODE_TO_COSTING); // ["driving","walking","cycling"]
const MAX_MATRIX_CELLS = 100;

// HTTP status mapping for routingService.RoutingError, chosen and applied
// consistently everywhere a RoutingError can surface (both endpoints below):
//   404 - NO_ROUTE: the coordinates were valid and in-bounds, but Valhalla
//         found no path between them. 404 ("no such route exists") reads
//         more precisely to a frontend consumer than 422 here - the request
//         itself wasn't malformed, the resource (a route) just doesn't exist.
//   503 - ENGINE_UNAVAILABLE: Valhalla could not be reached (down, network
//         partition, or VALHALLA_URL unset) - a dependency-availability
//         problem, not a client or routing-logic error.
//   500 - UNEXPECTED: Valhalla responded with something routingService
//         couldn't make sense of - an unanticipated backend failure.
// In every case the raw Valhalla error is logged server-side but never sent
// to the client - only a generic, stable message per type.
function handleRoutingError(error, res) {
  if (error instanceof routingService.RoutingError) {
    console.error(`[RoutingController] ${error.type}: ${error.message}`);
    if (error.type === "NO_ROUTE") {
      return res.status(404).json({ error: "No route could be found between these points." });
    }
    if (error.type === "ENGINE_UNAVAILABLE") {
      return res.status(503).json({ error: "Routing engine is currently unavailable." });
    }
    return res.status(500).json({ error: "Unexpected routing engine response." });
  }
  console.error("[RoutingController] Unexpected error:", error.message);
  return res.status(500).json({ error: "Server error while calculating route." });
}

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// ============================================================================
// GET /api/routing/route
// ============================================================================
exports.getRoute = async (req, res) => {
  try {
    const originLat = parseFloat(req.query.originLat);
    const originLng = parseFloat(req.query.originLng);
    const destLat = parseFloat(req.query.destLat);
    const destLng = parseFloat(req.query.destLng);
    const mode = req.query.mode;
    const geometryRaw = req.query.geometry;

    if (![originLat, originLng, destLat, destLng].every(isFiniteNumber)) {
      return res.status(400).json({
        error: "originLat, originLng, destLat, destLng are required and must be numeric.",
      });
    }
    if (!isWithinBangladesh(originLat, originLng) || !isWithinBangladesh(destLat, destLng)) {
      return res.status(400).json({ error: "Both origin and destination must be within Bangladesh." });
    }
    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(", ")}` });
    }
    if (geometryRaw !== undefined && geometryRaw !== "true" && geometryRaw !== "false") {
      return res.status(400).json({ error: "geometry must be 'true' or 'false' if provided." });
    }
    const geometry = geometryRaw === "true";

    // Effectively-identical origin/destination (same point at ~10m cache
    // precision - see routingService's roundCoord) would only produce a
    // useless zero-length round trip through Valhalla. Short-circuit
    // locally instead of spending a network call proving what's already
    // known, per the same coordinate precision routingService itself uses.
    if (
      routingService.roundCoord(originLat) === routingService.roundCoord(destLat) &&
      routingService.roundCoord(originLng) === routingService.roundCoord(destLng)
    ) {
      return res.json({
        route: {
          distanceMeters: 0,
          durationSeconds: 0,
          mode,
          geometry: geometry
            ? { type: "LineString", coordinates: [[originLng, originLat], [originLng, originLat]] }
            : null,
        },
      });
    }

    const route = await routingService.getRoute({
      originLat,
      originLng,
      destLat,
      destLng,
      mode,
      geometry,
    });

    res.json({ route });
  } catch (error) {
    handleRoutingError(error, res);
  }
};

// ============================================================================
// POST /api/routing/matrix
// ============================================================================
exports.getMatrix = async (req, res) => {
  try {
    const { origins, destinations, mode } = req.body || {};

    if (!Array.isArray(origins) || origins.length === 0) {
      return res.status(400).json({ error: "origins must be a non-empty array." });
    }
    if (!Array.isArray(destinations) || destinations.length === 0) {
      return res.status(400).json({ error: "destinations must be a non-empty array." });
    }
    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(", ")}` });
    }

    const totalCells = origins.length * destinations.length;
    if (totalCells > MAX_MATRIX_CELLS) {
      return res.status(400).json({
        error: `Too many origin/destination combinations: ${totalCells} exceeds the limit of ${MAX_MATRIX_CELLS}.`,
      });
    }

    const badPoint = (p) =>
      !p || !isFiniteNumber(p.lat) || !isFiniteNumber(p.lng) || !isWithinBangladesh(p.lat, p.lng);

    if (origins.some(badPoint) || destinations.some(badPoint)) {
      return res.status(400).json({
        error: "Every origin and destination must have numeric lat/lng within Bangladesh.",
      });
    }

    const matrix = await routingService.getMatrix({ origins, destinations, mode });

    res.json(matrix);
  } catch (error) {
    handleRoutingError(error, res);
  }
};
