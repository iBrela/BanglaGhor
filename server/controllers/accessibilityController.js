// ============================================================================
// ACCESSIBILITY CONTROLLER — thin HTTP layer over accessibilityService
// ============================================================================
// Public, unauthenticated (matches /api/pois/nearby and /api/routing/route).
// Shape/business validation lives here; accessibilityService.js assumes
// already-valid input, same split as poiController/routingController.
// ============================================================================

const accessibilityService = require("../services/accessibilityService");
const routingService = require("../services/routingService");
const PointOfInterest = require("../models/PointOfInterest");
const Property = require("../models/property");
const { isWithinBangladesh } = require("../../src/shared/bangladeshGeo");

const VALID_MODES = Object.keys(routingService.MODE_TO_COSTING);
const DEFAULT_MODE = "driving";

const MAX_RADIUS_METERS = 20000; // matches poiController's own hard cap
const MAX_CANDIDATE_LIMIT = 20;
const DEFAULT_RESULT_LIMIT = accessibilityService.DEFAULT_RESULT_LIMIT;
const MAX_RESULT_LIMIT = 20;
// A 2-hour "accessibility" claim isn't a meaningful real-estate signal -
// caps maxMinutes the same way poiController caps radius/limit.
const MAX_MINUTES = 120;

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// Shared by both /accessibility/nearby (query-supplied lat/lng) and the
// property-centric endpoints (property-supplied lat/lng) - the category/
// mode/radius/candidateLimit/limit/maxMinutes validation is identical
// either way, only where lat/lng comes from differs.
function parseAccessibilityQuery(req) {
  const category = req.query.category;
  if (!category || !PointOfInterest.CATEGORIES.includes(category)) {
    return { error: { status: 400, body: { error: `category is required and must be one of: ${PointOfInterest.CATEGORIES.join(", ")}` } } };
  }

  const mode = req.query.mode || DEFAULT_MODE;
  if (!VALID_MODES.includes(mode)) {
    return { error: { status: 400, body: { error: `mode must be one of: ${VALID_MODES.join(", ")}` } } };
  }

  let radius = req.query.radius !== undefined ? parseFloat(req.query.radius) : accessibilityService.defaultRadiusForMode(mode);
  if (!isFiniteNumber(radius) || radius <= 0) {
    return { error: { status: 400, body: { error: "radius must be a positive number." } } };
  }
  radius = Math.min(radius, MAX_RADIUS_METERS);

  let candidateLimit = req.query.candidateLimit !== undefined ? parseInt(req.query.candidateLimit, 10) : accessibilityService.DEFAULT_CANDIDATE_LIMIT;
  if (!Number.isFinite(candidateLimit) || candidateLimit <= 0) {
    return { error: { status: 400, body: { error: "candidateLimit must be a positive integer." } } };
  }
  candidateLimit = Math.min(candidateLimit, MAX_CANDIDATE_LIMIT);

  let limit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : DEFAULT_RESULT_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) {
    return { error: { status: 400, body: { error: "limit must be a positive integer." } } };
  }
  limit = Math.min(limit, MAX_RESULT_LIMIT);

  let maxTravelTimeSeconds;
  let maxMinutes;
  if (req.query.maxMinutes !== undefined) {
    maxMinutes = parseFloat(req.query.maxMinutes);
    if (!isFiniteNumber(maxMinutes) || maxMinutes <= 0) {
      return { error: { status: 400, body: { error: "maxMinutes must be a positive number." } } };
    }
    maxMinutes = Math.min(maxMinutes, MAX_MINUTES);
    maxTravelTimeSeconds = maxMinutes * 60;
  }

  return { category, mode, radius, candidateLimit, limit, maxTravelTimeSeconds, maxMinutes: maxMinutes ?? null };
}

// Maps routingService.RoutingError (the only kind of error
// accessibilityService lets propagate for a systemic failure) to the same
// HTTP status contract routingController.js already established -
// duplicated intentionally rather than imported, since routingController's
// version also handles non-RoutingError branches specific to route
// requests; keeping this one small and self-contained here is clearer than
// sharing a generic cross-cutting error handler for two request shapes.
function handleAccessibilityError(error, res) {
  if (error instanceof routingService.RoutingError) {
    console.error(`[AccessibilityController] ${error.type}: ${error.message}`);
    if (error.type === "NO_ROUTE") {
      return res.status(404).json({ error: "No route could be found from this location." });
    }
    if (error.type === "ENGINE_UNAVAILABLE") {
      return res.status(503).json({ error: "Routing engine is currently unavailable." });
    }
    return res.status(500).json({ error: "Unexpected routing engine response." });
  }
  console.error("[AccessibilityController] Unexpected error:", error.message);
  return res.status(500).json({ error: "Server error while calculating accessibility." });
}

// ============================================================================
// GET /api/accessibility/nearby
// ============================================================================
exports.getNearby = async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
      return res.status(400).json({ error: "lat and lng are required and must be numeric." });
    }
    if (!isWithinBangladesh(lat, lng)) {
      return res.status(400).json({ error: "Coordinates are outside Bangladesh." });
    }

    const parsed = parseAccessibilityQuery(req);
    if (parsed.error) return res.status(parsed.error.status).json(parsed.error.body);
    const { category, mode, radius, candidateLimit, limit, maxTravelTimeSeconds, maxMinutes } = parsed;

    const { results } = await accessibilityService.findNearbyPOIsByTravelTime({
      lat, lng, category, mode,
      candidateRadius: radius,
      candidateLimit,
      resultLimit: limit,
      maxTravelTimeSeconds,
    });

    res.json({
      results,
      count: results.length,
      query: { lat, lng, category, mode, radius, candidateLimit, limit, maxMinutes },
    });
  } catch (error) {
    handleAccessibilityError(error, res);
  }
};

// Shared by the two property-centric handlers below: loads a property,
// confirms it has usable coordinates, and returns [lat, lng] or writes an
// error response and returns null.
async function resolvePropertyPoint(req, res) {
  const { id } = req.params;
  const property = await Property.findById(id).select("geoLocation isDeleted");
  if (!property || property.isDeleted) {
    res.status(404).json({ error: "Property not found." });
    return null;
  }
  const coords = property.geoLocation?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) {
    res.status(422).json({ error: "Property has no usable coordinates." });
    return null;
  }
  return { lat: coords[1], lng: coords[0] };
}

// ============================================================================
// GET /api/properties/:id/accessibility
// ============================================================================
exports.getPropertyAccessibility = async (req, res) => {
  try {
    const point = await resolvePropertyPoint(req, res);
    if (!point) return; // resolvePropertyPoint already wrote the response

    const parsed = parseAccessibilityQuery(req);
    if (parsed.error) return res.status(parsed.error.status).json(parsed.error.body);
    const { category, mode, radius, candidateLimit, limit, maxTravelTimeSeconds, maxMinutes } = parsed;

    const { results } = await accessibilityService.findNearbyPOIsByTravelTime({
      lat: point.lat, lng: point.lng, category, mode,
      candidateRadius: radius,
      candidateLimit,
      resultLimit: limit,
      maxTravelTimeSeconds,
    });

    res.json({
      propertyId: req.params.id,
      results,
      count: results.length,
      query: { category, mode, radius, candidateLimit, limit, maxMinutes },
    });
  } catch (error) {
    handleAccessibilityError(error, res);
  }
};

// ============================================================================
// GET /api/properties/:id/accessibility-summary
// ============================================================================
exports.getPropertyAccessibilitySummary = async (req, res) => {
  try {
    const point = await resolvePropertyPoint(req, res);
    if (!point) return;

    const mode = req.query.mode || DEFAULT_MODE;
    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(", ")}` });
    }

    const summary = await accessibilityService.getAccessibilitySummary({
      lat: point.lat,
      lng: point.lng,
      mode,
    });

    res.json({ propertyId: req.params.id, mode, summary });
  } catch (error) {
    handleAccessibilityError(error, res);
  }
};
