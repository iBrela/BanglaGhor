// ============================================================================
// PointOfInterest Model
// ============================================================================
// Purpose: nationwide Bangladesh POIs imported from OpenStreetMap (see
// server/tools/importBangladeshPOIs.js), for "properties near a hospital/
// school/park/etc." queries (server/services/poiService.js). Read-only from
// the app's perspective - the only writer is the import tool.
//
// Follows the exact same GeoJSON Point + 2dsphere convention already used by
// Property.geoLocation and GeocodeCache.location - no new geo pattern
// introduced.
//
// Deliberately does NOT store the raw OSM tags object - only the normalized
// fields the app actually needs (see the M3 audit report for why: most
// categories carry dozens of incidental tags - phone numbers, websites,
// opening_hours, etc. - that nothing in this app reads).
// ============================================================================

const mongoose = require("mongoose");
const { Schema } = mongoose;

const CATEGORIES = [
  "hospital",
  "clinic",
  "pharmacy",
  "school",
  "college",
  "university",
  "park",
  "marketplace",
  "place_of_worship",
  "police",
  "fire_station",
  "bus_station",
  "railway_station",
  "ferry_terminal",
  "bank",
  "atm",
];

const pointOfInterestSchema = new Schema({
  // OSM's own identifiers. Node/way/relation IDs are only unique WITHIN
  // their own type (a node #123 and a way #123 are different real-world
  // features) - both fields together are this collection's true identity,
  // see the compound unique index below.
  osmId: { type: Number, required: true },
  osmType: { type: String, enum: ["node", "way", "relation"], required: true },

  // `name` is OSM's generic name tag - present far more often than the
  // language-specific ones below, and is frequently already Bangla script
  // even without an explicit name:bn tag (confirmed during the M3 audit).
  // Treat it as the reliable fallback, not nameBn/nameEn.
  name: { type: String },
  nameBn: { type: String },
  nameEn: { type: String },

  // Normalized, provider-independent category - see
  // importBangladeshPOIs.js's CATEGORY_RULES for the exact, deterministic
  // (first-match-wins) OSM tag -> category mapping. Every imported document
  // has exactly one category, never more than one.
  category: { type: String, required: true, enum: CATEGORIES, index: true },

  geoLocation: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },

  // Only the address fields genuinely present with useful frequency in the
  // real data (addr:city / addr:district) - not a full address block, since
  // most POIs don't carry a complete structured address in OSM.
  address: {
    city: { type: String },
    district: { type: String },
  },

  source: { type: String, default: "openstreetmap" },
  // The OSM element's own last-edit timestamp (from osmium's exported
  // feature, when present) - NOT this document's own write time.
  sourceUpdatedAt: { type: Date },
  importedAt: { type: Date, default: Date.now },

  // Internal refresh-safety marker only - identifies which --refresh run
  // last touched this document, so a completed refresh can safely delete
  // stale documents left over from before it (see importBangladeshPOIs.js's
  // "REFRESH SAFETY" design). Never read or written by anything except the
  // import tool itself.
  importRunId: { type: String },
});

pointOfInterestSchema.index({ geoLocation: "2dsphere" });
pointOfInterestSchema.index({ osmId: 1, osmType: 1 }, { unique: true });

module.exports =
  mongoose.models.PointOfInterest ||
  mongoose.model("PointOfInterest", pointOfInterestSchema);

module.exports.CATEGORIES = CATEGORIES;
