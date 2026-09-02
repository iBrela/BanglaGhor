const mongoose = require("mongoose");
const { Schema } = mongoose;

const propertySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    price: { type: Number, required: true },

    // Structured address fields
    addressLine1: { type: String, required: true },
    addressLine2: { type: String },
    cityTown: { type: String, required: true },
    upazila: { type: String, required: true },
    district: { type: String, required: true },
    postalCode: { type: String, required: true },

    // Coordinate storage - both formats for compatibility
    latitude: { type: Number },
    longitude: { type: Number },

    // Position object for frontend map compatibility
    position: {
      lat: { type: Number },
      lng: { type: Number },
    },

    // GeoJSON location for MongoDB geospatial queries (used by smart chatbot)
    geoLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude] - GeoJSON format
        default: undefined,
      },
    },

    // Location accuracy flag
    locationAccuracy: {
      type: String,
      enum: ["precise", "approximate", "district-level", "unknown"],
      default: "unknown",
    },

    // Original geocoded address (for troubleshooting)
    geocodedAddress: { type: String },

    // Property Type & Listing Type
    propertyType: {
      type: String,
      required: true,
      enum: ["apartment", "house", "condo", "land", "commercial"],
    },
    listingType: {
      type: String,
      enum: ["rent", "buy", "sold"],
      default: "rent",
      required: true,
    },

    listingStatus: {
      type: String,
      enum: ["available", "rented", "sold", "unavailable"],
      default: "available",
      required: true,
      index: true,
    },

    // Basic Details
    bedrooms: { type: Number, default: 0 },
    bathrooms: { type: Number, default: 0 },
    area: { type: Number },

    // Features (Standard) - Nested object
    features: {
      parking: { type: Boolean, default: false },
      garden: { type: Boolean, default: false },
      airConditioning: { type: Boolean, default: false },
      furnished: { type: String, enum: ["no", "semi", "full"], default: "no" },
      pool: { type: Boolean, default: false },
    },

    // Bangladesh Specific Details - Nested object
    bangladeshDetails: {
      propertyCondition: {
        type: String,
        enum: ["new", "under_construction", "resale"],
      },
      proximityToMainRoad: { type: String },
      publicTransport: { type: String },
      floodProne: { type: String, enum: ["yes", "no", "sometimes"] },
      waterSource: {
        type: String,
        enum: ["wasa", "deep_tube_well", "both", "other"],
      },
      gasSource: { type: String, enum: ["piped", "cylinder", "none"] },
      gasLineInstalled: { type: String, enum: ["yes", "no", "na"] },
      backupPower: {
        type: String,
        enum: ["ips", "generator", "solar", "none"],
      },
      sewerSystem: {
        type: String,
        enum: ["covered", "open", "septic_tank", "none"],
      },
      nearbySchools: { type: String },
      nearbyHospitals: { type: String },
      nearbyMarkets: { type: String },
      nearbyReligiousPlaces: { type: String },
      nearbyOthers: { type: String },
      securityFeatures: [{ type: String, enum: ["gated", "guards", "cctv"] }],
      earthquakeResistance: { type: String, enum: ["yes", "no", "unknown"] },
      roadWidth: { type: String },
      parkingType: {
        type: String,
        enum: ["dedicated", "street", "garage", "none"],
      },
      floorNumber: { type: Number },
      totalFloors: { type: Number },
      balcony: { type: String, enum: ["yes", "no"] },
      rooftopAccess: { type: String, enum: ["yes", "no"] },
      naturalLight: { type: String },
      ownershipPapers: {
        type: String,
        enum: ["clear", "pending", "issue", "unknown"],
      },
      propertyTenure: {
        type: String,
        enum: ["freehold", "leasehold", "unknown"],
        default: "unknown",
      },
      recentRenovations: { type: String },
      nearbyDevelopments: { type: String },
      reasonForSelling: { type: String },
    },

    isHidden: {
      type: Boolean,
      default: false,
      index: true,
    },

    featuredAt: {
      type: Date,
      default: null,
      index: true,
    },

    // Soft delete (admin Recycle Bin)
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "UserProfile",
      default: null,
    },

    // Description & Images
    // description stays as the legacy/display field (kept in sync with
    // description_en for anything still reading it directly). description_en
    // and description_bn are additive - both default to "" so existing
    // documents never need a migration and simply read as "no bilingual
    // version yet", falling back to the legacy field on the frontend.
    description: { type: String },
    description_en: { type: String, default: "" },
    description_bn: { type: String, default: "" },
    images: {
      type: [String], // Array of S3 image URLs
      default: [],
    },

    // Ownership & Timestamps
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "UserProfile",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

// Add custom instance methods for location handling
propertySchema.methods = {
  // Method to return a formatted address string
  getFormattedAddress: function () {
    const addressParts = [
      this.addressLine1,
      this.addressLine2,
      this.upazila,
      this.cityTown,
      this.district,
      this.postalCode,
    ].filter(Boolean);

    return addressParts.length > 0
      ? addressParts.join(", ")
      : "Location details not available";
  },

  // Method to check if position data is valid
  hasValidPosition: function () {
    return (
      this.position &&
      typeof this.position.lat === "number" &&
      typeof this.position.lng === "number"
    );
  },
};

// Add hooks for automatic position field synchronization
propertySchema.pre("save", function (next) {
  // If latitude and longitude are set, but position is not
  if (this.isModified("latitude") || this.isModified("longitude")) {
    if (this.latitude !== undefined && this.longitude !== undefined) {
      if (!this.position) this.position = {};
      this.position.lat = this.latitude;
      this.position.lng = this.longitude;

      // Also sync geoLocation for geospatial queries
      this.geoLocation = {
        type: "Point",
        coordinates: [this.longitude, this.latitude], // [lng, lat] for GeoJSON
      };
    }
  }

  // If position is set, but latitude and longitude are not
  if (this.isModified("position.lat") || this.isModified("position.lng")) {
    if (
      this.position &&
      typeof this.position.lat === "number" &&
      typeof this.position.lng === "number"
    ) {
      this.latitude = this.position.lat;
      this.longitude = this.position.lng;

      // Also sync geoLocation
      this.geoLocation = {
        type: "Point",
        coordinates: [this.position.lng, this.position.lat],
      };
    }
  }

  next();
});

// Add index for faster geospatial queries (legacy)
propertySchema.index({ latitude: 1, longitude: 1 });

// 2dsphere index for proper geo queries (allows "find within radius" queries)
propertySchema.index({ geoLocation: "2dsphere" });

// Add index on fields commonly used for searching/filtering
propertySchema.index({
  district: 1,
  upazila: 1,
  propertyType: 1,
  listingType: 1,
  listingStatus: 1,
  price: 1,
});

module.exports =
  mongoose.models.Property || mongoose.model("Property", propertySchema);