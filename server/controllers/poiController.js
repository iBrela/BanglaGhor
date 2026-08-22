// ============================================================================
// POI CONTROLLER — thin HTTP layer over poiService.findNearbyPOIs
// ============================================================================
// Public, unauthenticated (matches the existing /api/properties and
// /api/locations/search pattern - read-only, no user data involved).
// ============================================================================

const poiService = require("../services/poiService");
const PointOfInterest = require("../models/PointOfInterest");
const { isWithinBangladesh } = require("../../src/shared/bangladeshGeo");

const DEFAULT_RADIUS_METERS = 2000;
const MAX_RADIUS_METERS = 20000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

exports.getNearbyPOIs = async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const category = req.query.category || undefined;
    const radius =
      req.query.radius !== undefined ? parseFloat(req.query.radius) : DEFAULT_RADIUS_METERS;
    const limit =
      req.query.limit !== undefined ? parseInt(req.query.limit, 10) : DEFAULT_LIMIT;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "lat and lng are required and must be numeric." });
    }
    if (!isWithinBangladesh(lat, lng)) {
      return res.status(400).json({ error: "Coordinates are outside Bangladesh." });
    }
    if (category && !PointOfInterest.CATEGORIES.includes(category)) {
      return res
        .status(400)
        .json({ error: `Invalid category. Must be one of: ${PointOfInterest.CATEGORIES.join(", ")}` });
    }
    if (!Number.isFinite(radius) || radius <= 0) {
      return res.status(400).json({ error: "radius must be a positive number." });
    }
    if (!Number.isFinite(limit) || limit <= 0) {
      return res.status(400).json({ error: "limit must be a positive integer." });
    }

    const cappedRadius = Math.min(radius, MAX_RADIUS_METERS);
    const cappedLimit = Math.min(limit, MAX_LIMIT);

    const results = await poiService.findNearbyPOIs({
      lat,
      lng,
      category,
      maxDistance: cappedRadius,
      limit: cappedLimit,
    });

    res.json({
      results,
      count: results.length,
      query: { lat, lng, category: category || null, radius: cappedRadius },
    });
  } catch (error) {
    console.error("[PoiController] getNearbyPOIs error:", error.message);
    res.status(500).json({ error: "Server error while searching nearby points of interest." });
  }
};
