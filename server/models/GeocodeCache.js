// ============================================================================
// GeocodeCache Model
// ============================================================================
// Purpose: Persistent MongoDB cache for geocoded locations.
//
// Why this exists:
//   - In-memory cache (NodeCache) is lost on server restart
//   - Nominatim API has rate limits (1 req/sec)
//   - Same locations get searched repeatedly by different users
//   - This cache survives forever and grows smarter over time
//
// How it works:
//   1. First time "Dhaka University" is searched → API call → save to DB
//   2. Every subsequent search → instant DB lookup (no API call)
//   3. After 90 days, entry refreshes from API (data freshness)
// ============================================================================

const mongoose = require("mongoose");

const geocodeCacheSchema = new mongoose.Schema(
  {
    // The normalized search query (lowercase, trimmed)
    // This is the unique key — same query always returns same result
    queryKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },

    // Original query as user typed it (for debugging / analytics)
    originalQuery: {
      type: String,
      required: true,
    },

    // GeoJSON Point — works with MongoDB geospatial queries
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },

    // Human-readable place name from the API
    displayName: {
      type: String,
      required: true,
    },

    // Place type (city, village, university, hospital, etc.)
    placeType: {
      type: String,
      default: "location",
    },

    // Detailed address breakdown (when available)
    addressDetails: {
      country: String,
      state: String,        // Division (Dhaka, Chittagong, etc.)
      district: String,
      city: String,
      suburb: String,
      neighbourhood: String,
      road: String,
      postcode: String,
    },

    // Which API provided this data (for debugging / analytics)
    source: {
      type: String,
      enum: ["nominatim", "photon", "ai_translated", "manual"],
      required: true,
    },

    // How many times this cache entry has been used
    hitCount: {
      type: Number,
      default: 1,
    },

    // Last time this entry was accessed
    lastAccessedAt: {
      type: Date,
      default: Date.now,
    },

    // When the entry was first cached (auto)
    // When the entry was last updated from API (auto)
  },
  { timestamps: true }
);

// Geospatial index — enables "find nearest cached location" queries
geocodeCacheSchema.index({ location: "2dsphere" });

// Compound index for analytics queries
geocodeCacheSchema.index({ source: 1, hitCount: -1 });

module.exports =
  mongoose.models.GeocodeCache ||
  mongoose.model("GeocodeCache", geocodeCacheSchema);