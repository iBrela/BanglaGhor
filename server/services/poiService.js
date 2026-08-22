// ============================================================================
// POI SERVICE — nearby Point of Interest queries
// ============================================================================
// Read-only. The only writer of the PointOfInterest collection is
// server/tools/importBangladeshPOIs.js.
//
// Uses $geoNear (aggregation pipeline stage) rather than a plain $near query
// operator specifically because the actual distance value is wanted in the
// response (for testing now, and useful for later chatbot/travel-time work
// per the M3 design) - $geoNear computes and returns it natively via
// distanceField, so there's no reason to recompute distance manually in JS
// when MongoDB already provides it against the same 2dsphere index.
// ============================================================================

const PointOfInterest = require("../models/PointOfInterest");

const DEFAULT_MAX_DISTANCE_METERS = 2000;
const DEFAULT_LIMIT = 20;

/**
 * Find POIs near a point, nearest first, with real distance in meters.
 *
 * @param {{ lat: number, lng: number, category?: string, maxDistance?: number, limit?: number }} params
 * @returns {Promise<Array<{ id, name, nameBn, nameEn, category, geoLocation, distanceMeters }>>}
 */
async function findNearbyPOIs({
  lat,
  lng,
  category,
  maxDistance = DEFAULT_MAX_DISTANCE_METERS,
  limit = DEFAULT_LIMIT,
}) {
  const geoNearStage = {
    near: { type: "Point", coordinates: [lng, lat] },
    distanceField: "distanceMeters",
    maxDistance,
    spherical: true, // required for 2dsphere-indexed GeoJSON geometry
  };
  if (category) geoNearStage.query = { category };

  const docs = await PointOfInterest.aggregate([
    { $geoNear: geoNearStage },
    { $limit: limit },
    {
      $project: {
        name: 1,
        nameBn: 1,
        nameEn: 1,
        category: 1,
        geoLocation: 1,
        distanceMeters: 1,
      },
    },
  ]);

  return docs.map((d) => ({
    id: d._id,
    name: d.name || null,
    nameBn: d.nameBn || null,
    nameEn: d.nameEn || null,
    category: d.category,
    geoLocation: d.geoLocation,
    distanceMeters: Math.round(d.distanceMeters),
  }));
}

module.exports = { findNearbyPOIs, DEFAULT_MAX_DISTANCE_METERS, DEFAULT_LIMIT };
