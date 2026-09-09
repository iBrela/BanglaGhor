const Property = require("../models/property.js");
const mongoose = require("mongoose");
const axios = require("axios");
const {
  buildBilingualDescription,
  buildFromManualDescription,
} = require("../services/propertyDescriptionService");
const {
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");
const {
  getPropertyImagesS3Client,
  buildS3ObjectUrl,
  extractS3KeyFromUrl,
} = require("../services/s3Provider");

const S3_PROPERTY_IMAGES_BUCKET = process.env.APP_S3_BUCKET_PROPERTY_IMAGES;
const S3_PROPERTY_IMAGES_FOLDER = "property-images/";

// ============================================================================
// Helper: Permanently delete property images from S3.
// Used ONLY by admin permanent-delete (never on soft delete or hide/unfeature).
// Errors on individual images are logged and skipped, not thrown, so a bad
// image URL never blocks the rest of the cleanup or the DB deletion itself.
// ============================================================================
async function deletePropertyImages(imageUrls) {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) return;
  const propertyImagesS3Client = await getPropertyImagesS3Client();
  for (const url of imageUrls) {
    const key = extractS3KeyFromUrl(url);
    if (!key) continue;
    try {
      await propertyImagesS3Client.send(
        new DeleteObjectCommand({
          Bucket: S3_PROPERTY_IMAGES_BUCKET,
          Key: key,
        })
      );
    } catch (err) {
      console.error(`Failed to delete S3 image (${url}):`, err.message);
    }
  }
}
exports.deletePropertyImages = deletePropertyImages;

const isValidBangladeshLocation = (lat, lng) => {
  const BD_BOUNDS = {
    minLat: 20.5,
    maxLat: 26.7,
    minLng: 88.0,
    maxLng: 92.7,
  };

  return (
    lat >= BD_BOUNDS.minLat &&
    lat <= BD_BOUNDS.maxLat &&
    lng >= BD_BOUNDS.minLng &&
    lng <= BD_BOUNDS.maxLng
  );
};

const getDistrictCoordinates = (district) => {
  const districtMap = {
    Dhaka: { lat: 23.8103, lng: 90.4125 },
    Gazipur: { lat: 24.0958, lng: 90.4125 },
    Narayanganj: { lat: 23.6238, lng: 90.5 },
    Chattogram: { lat: 22.3569, lng: 91.7832 },
    "Cox's Bazar": { lat: 21.4272, lng: 92.0101 },
    Sylhet: { lat: 24.8949, lng: 91.8687 },
    Moulvibazar: { lat: 24.4843, lng: 91.7774 },
    Rajshahi: { lat: 24.3745, lng: 88.6042 },
    Bogura: { lat: 24.8465, lng: 89.3729 },
    Khulna: { lat: 22.8456, lng: 89.5403 },
    Jessore: { lat: 23.1681, lng: 89.2134 },
    Barisal: { lat: 22.701, lng: 90.3535 },
    Rangpur: { lat: 25.7439, lng: 89.2752 },
  };

  const normalizedDistrict = district.toLowerCase().trim();

  for (const [key, value] of Object.entries(districtMap)) {
    if (key.toLowerCase() === normalizedDistrict) {
      return value;
    }
  }

  for (const [key, value] of Object.entries(districtMap)) {
    if (
      normalizedDistrict.includes(key.toLowerCase()) ||
      key.toLowerCase().includes(normalizedDistrict)
    ) {
      return value;
    }
  }

  return districtMap["Dhaka"];
};

const constructGeocodingAddress = (addressData) => {
  const {
    addressLine1,
    addressLine2,
    upazila,
    cityTown,
    district,
    postalCode,
  } = addressData;

  // De-duplicate exact (case-insensitive) repeated components - e.g. a
  // Dhaka-city property where cityTown and district are BOTH literally
  // "Dhaka" previously produced "..., Dhaka, Dhaka, 1213, Bangladesh".
  // Confirmed by direct testing: that literal repetition measurably
  // degrades OpenCage's match quality (it fell back to a city-wide
  // centroid instead of resolving the specific neighbourhood), while the
  // same address with the duplicate removed resolved much closer to the
  // correct area. This never drops genuinely different components (e.g.
  // upazila "Banani" is kept even though addressLine1 also mentions
  // "Banani" - only whole-component exact repeats are removed).
  const rawComponents = [
    addressLine1,
    addressLine2,
    upazila,
    cityTown,
    district,
    postalCode,
  ];
  const seen = new Set();
  const addressComponents = [];
  for (const part of rawComponents) {
    const trimmed = (part || "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addressComponents.push(trimmed);
  }
  addressComponents.push("Bangladesh");

  return addressComponents.join(", ");
};

// ============================================================================
// Helper: does a geocoding result actually land in the requested area?
// ============================================================================
// OpenCage's `confidence` score measures how sure it is of its own best
// guess - it does NOT measure whether that guess is in the neighbourhood
// the user actually specified. A query OpenCage can't resolve below city
// level can still come back with a moderate/high confidence city-centroid
// match (this is exactly what caused a Banani address to silently save
// Old Dhaka/Islampur coordinates: OpenCage matched only "Dhaka" the city,
// with no suburb/neighbourhood component at all, yet still returned a
// confidence high enough for "approximate").
//
// Only the finer-grained locality fields are checked (suburb, neighbourhood,
// quarter, city_district, town, village) - not city/county/state, which are
// expected to match broadly and don't tell us whether the SPECIFIC area was
// actually found.
function getResultLocalityTerms(components) {
  if (!components) return [];
  // Deliberately excludes `town`/`city`/`county`/`state`: for Bangladesh
  // results OpenCage's `town` is frequently just an alias for the city
  // itself (e.g. town: "Dhaka" on a result that only matched the city as a
  // whole) - including it would let a generic "Dhaka" match trivially
  // "match" any requested Dhaka-city upazila, defeating this check
  // entirely (confirmed while testing the actual buggy Banani result,
  // which carries exactly that town: "Dhaka" field).
  return [
    components.suburb,
    components.neighbourhood,
    components.quarter,
    components.city_district,
    components.village,
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
}

function areaMatchesRequest(addressData, components) {
  const requestedTerms = [addressData.upazila, addressData.cityTown]
    .map((v) => (v || "").trim().toLowerCase())
    .filter(Boolean);
  // Nothing specific enough was supplied to check against - don't reject.
  if (requestedTerms.length === 0) return true;

  // A result whose own postcode matches the user-supplied postcode is
  // trusted even without a suburb/neighbourhood component: Bangladeshi
  // postal codes are neighbourhood-sized (e.g. Banani=1213, Gulshan=1212),
  // so this is an independent, granular confirmation - and OpenCage's
  // Bangladesh coverage often resolves only to postcode level with no
  // suburb tag at all, so requiring a suburb tag too would reject many
  // otherwise-correct matches.
  if (
    addressData.postalCode &&
    components?.postcode &&
    String(components.postcode).trim() === String(addressData.postalCode).trim()
  ) {
    return true;
  }

  const resultTerms = getResultLocalityTerms(components);
  // A specific area was requested but the geocoder result has no
  // neighbourhood-level info at all (only city/state/etc.) and no matching
  // postcode either - that's the exact failure mode behind the Banani ->
  // Islampur bug, so treat it as a mismatch rather than trusting the
  // coordinate anyway.
  if (resultTerms.length === 0) return false;

  return requestedTerms.some((req) =>
    resultTerms.some((res) => res.includes(req) || req.includes(res))
  );
}

const geocodeAddress = async (addressData) => {
  const fullAddress = constructGeocodingAddress(addressData);
  console.log("Geocoding address:", fullAddress);

  try {
    const geoRes = await axios.get(
      "https://api.opencagedata.com/geocode/v1/json",
      {
        params: {
          q: fullAddress,
          key: process.env.OPENCAGE_API_KEY,
          countrycode: "bd",
          limit: 1,
          no_annotations: 0,
          abbrv: 1,
        },
        // Without this, a slow/hanging OpenCage request had no bound and
        // could stall property create/update indefinitely. 8s matches
        // routingService.js's own REQUEST_TIMEOUT_MS for a similar
        // external geo-dependency call. On timeout, axios rejects the same
        // way as any other request failure, so the existing catch block
        // below (which already returns null -> triggers the district-level
        // fallback in createProperty/updateProperty) handles it exactly
        // like any other geocoding failure - no new fallback logic needed.
        timeout: 8000,
      }
    );

    if (geoRes.data.results && geoRes.data.results.length > 0) {
      const result = geoRes.data.results[0];
      const location = result.geometry;

      let locationAccuracy = "approximate";

      if (result.confidence >= 8) {
        locationAccuracy = "precise";
      } else if (result.confidence >= 5) {
        locationAccuracy = "approximate";
      } else {
        locationAccuracy = "district-level";
      }

      if (!isValidBangladeshLocation(location.lat, location.lng)) {
        console.warn(
          `Geocoding returned coordinates outside Bangladesh: ${location.lat}, ${location.lng}`
        );

        const districtCoordinates = getDistrictCoordinates(
          addressData.district
        );
        if (districtCoordinates) {
          location.lat = districtCoordinates.lat;
          location.lng = districtCoordinates.lng;
          locationAccuracy = "district-level";
          console.log(
            `Using fallback coordinates for ${addressData.district}: ${location.lat}, ${location.lng}`
          );
        }
      } else if (!areaMatchesRequest(addressData, result.components)) {
        // In-country, but the result doesn't actually mention the
        // upazila/cityTown the user specified (see areaMatchesRequest) - a
        // confident-looking match on the wrong neighbourhood is worse than
        // an honest "we only know the district", so this is never accepted
        // as precise/approximate. Reuses the same district-centroid
        // fallback as a total geocoding failure, rather than inventing a
        // new coordinate.
        console.warn(
          `Geocoding result for "${fullAddress}" (formatted: "${result.formatted}") did not match the requested area - falling back to district-level coordinates instead of a mismatched precise/approximate location.`
        );

        const districtCoordinates = getDistrictCoordinates(
          addressData.district
        );
        if (districtCoordinates) {
          location.lat = districtCoordinates.lat;
          location.lng = districtCoordinates.lng;
        }
        locationAccuracy = "district-level";
      }

      return {
        latitude: location.lat,
        longitude: location.lng,
        position: {
          lat: location.lat,
          lng: location.lng,
        },
        locationAccuracy,
        geocodedAddress: fullAddress,
        formatted: result.formatted || fullAddress,
      };
    } else {
      console.warn(`No geocoding results for address: ${fullAddress}`);

      const districtCoordinates = getDistrictCoordinates(addressData.district);
      if (districtCoordinates) {
        return {
          latitude: districtCoordinates.lat,
          longitude: districtCoordinates.lng,
          position: {
            lat: districtCoordinates.lat,
            lng: districtCoordinates.lng,
          },
          locationAccuracy: "district-level",
          geocodedAddress: fullAddress,
          formatted: fullAddress,
        };
      }

      return null;
    }
  } catch (error) {
    console.error("Error during geocoding:", error.message);
    return null;
  }
};

exports.createProperty = async (req, res) => {
  if (!req.userProfile || !req.userProfile._id) {
    return res
      .status(401)
      .json({ message: "Authentication required to create listing." });
  }

  try {
    const addressData = {
      addressLine1: req.body.addressLine1,
      addressLine2: req.body.addressLine2,
      cityTown: req.body.cityTown,
      upazila: req.body.upazila,
      district: req.body.district,
      postalCode: req.body.postalCode,
    };

    const geocodeResult = await geocodeAddress(addressData);

    let propertyData = {
      ...req.body,
      createdBy: req.userProfile._id,
      listingStatus: req.body.listingStatus || "available",
      images: req.body.images || [],
    };

    if (geocodeResult) {
      propertyData = {
        ...propertyData,
        latitude: geocodeResult.latitude,
        longitude: geocodeResult.longitude,
        position: geocodeResult.position,
        locationAccuracy: geocodeResult.locationAccuracy,
        geocodedAddress: geocodeResult.geocodedAddress,
      };
      console.log(
        `Geocoded address to: ${geocodeResult.latitude}, ${geocodeResult.longitude} (accuracy: ${geocodeResult.locationAccuracy})`
      );
    } else {
      console.warn(
        `Geocoding failed completely for address. Using district fallback or general default.`
      );
      const districtCoordinates = getDistrictCoordinates(addressData.district);
      if (districtCoordinates) {
        propertyData.latitude = districtCoordinates.lat;
        propertyData.longitude = districtCoordinates.lng;
        propertyData.position = {
          lat: districtCoordinates.lat,
          lng: districtCoordinates.lng,
        };
        propertyData.locationAccuracy = "district-level";
      } else {
        const defaultMapCenter = { lat: 23.8103, lng: 90.4125 };
        propertyData.latitude = defaultMapCenter.lat;
        propertyData.longitude = defaultMapCenter.lng;
        propertyData.position = {
          lat: defaultMapCenter.lat,
          lng: defaultMapCenter.lng,
        };
        propertyData.locationAccuracy = "unknown";
      }
    }

    // Bilingual description: if the seller typed one (English OR Bangla -
    // detected automatically, see propertyDescriptionService.detectLanguage),
    // it's used as-is (never overwritten by AI) and only translated to the
    // other language. If left blank, the Groq -> Gemini -> deterministic-
    // template chain fills in English, then Gemini -> Groq translates it to
    // Bangla. None of this throws, so listing creation can't fail because an
    // AI/translation provider is down. `description` (legacy field) is set
    // by the service itself - normally the English version, but if the
    // seller wrote in Bangla and translation to English failed, it holds
    // their original Bangla text instead of being left empty.
    const manualDescription = (req.body.description || "").trim();
    const { description, description_en, description_bn } =
      await buildBilingualDescription(propertyData, manualDescription);
    propertyData.description = description;
    propertyData.description_en = description_en;
    propertyData.description_bn = description_bn;

    const newProperty = new Property(propertyData);
    await newProperty.save();
    const populatedProperty = await Property.findById(newProperty._id).populate(
      "createdBy",
      "_id displayName email cognitoSub profilePictureUrl"
    );
    res.status(201).json(populatedProperty || newProperty);
  } catch (err) {
    console.error("Create property error:", err);
    if (err.name === "ValidationError") {
      let errors = {};
      for (let field in err.errors) {
        errors[field] = err.errors[field].message;
      }
      return res
        .status(400)
        .json({ message: "Validation Error", errors: errors });
    }
    res.status(500).json({ error: "Server error creating property" });
  }
};

exports.getAllProperties = async (req, res) => {
  console.log("--- getAllProperties: Received req.query:", req.query);

  try {
    const isRandom = req.query.random === "true";
    const isFeatured = req.query.featured === "true";
    const defaultLimit = isRandom ? 30 : isFeatured ? 25 : 0;
    const limit = parseInt(req.query.limit) || defaultLimit;

    const baseFilter = {
      isHidden: { $ne: true },
      isDeleted: { $ne: true },
    };

    if (req.query.includeUnavailable !== "true") {
      baseFilter.listingStatus = "available";
    }

    let properties;
    let query;

    const userFieldsToPopulate =
      "_id displayName email cognitoSub profilePictureUrl";

    if (isRandom && limit > 0) {
      properties = await Property.aggregate([
        { $match: baseFilter },
        { $sample: { size: limit } },
      ]);
      const propertyIds = properties.map((p) => p._id);
      properties = await Property.find({ _id: { $in: propertyIds } }).populate(
        "createdBy",
        userFieldsToPopulate
      );

      console.log(
        `Workspaceed ${properties.length} random, visible properties (limit: ${limit}) with status filter`
      );
    } else if (isFeatured) {
      console.log(`Workspaceing featured listings (limit: ${limit})`);
      query = Property.find({ ...baseFilter, featuredAt: { $ne: null } })
        .populate("createdBy", userFieldsToPopulate)
        .sort({ featuredAt: -1 });
      if (limit > 0) {
        query.limit(limit);
      }
      properties = await query.exec();
      console.log(
        `Workspaceed ${properties.length} featured properties with status filter.`
      );
    } else {
      const queryFilters = { ...baseFilter };
      if (req.query.listingType)
        queryFilters.listingType = req.query.listingType;

      if (req.query.listingStatus) {
        queryFilters.listingStatus = req.query.listingStatus;
      }

      if (req.query.nearLat && req.query.nearLng && req.query.radius) {
        const lat = parseFloat(req.query.nearLat);
        const lng = parseFloat(req.query.nearLng);
        const radius = parseInt(req.query.radius, 10) / 111.12;

        queryFilters.$and = queryFilters.$and || [];
        queryFilters.$and.push(
          { latitude: { $gte: lat - radius, $lte: lat + radius } },
          { longitude: { $gte: lng - radius, $lte: lng + radius } }
        );
      }

      query = Property.find(queryFilters)
        .populate("createdBy", userFieldsToPopulate)
        .sort({ createdAt: -1 });
      if (limit > 0) {
        query.limit(limit);
      }
      properties = await query.exec();
      console.log(
        `Workspaceed ${properties.length} visible properties with filters/limit and status filter.`
      );
    }

    const processedProperties = properties.map((prop) => {
      const property = prop.toObject ? prop.toObject() : prop;
      if (!property.position && property.latitude && property.longitude) {
        property.position = {
          lat: property.latitude,
          lng: property.longitude,
        };
      }
      return property;
    });

    res.json(processedProperties);
  } catch (err) {
    console.error("Fetch all properties error:", err);
    res.status(500).json({ error: "Server error fetching properties" });
  }
};

exports.getPropertyById = async (req, res) => {
  try {
    const property = await Property.findOne({
      _id: req.params.id,
      isHidden: { $ne: true },
      isDeleted: { $ne: true },
    }).populate(
      "createdBy",
      "_id displayName email cognitoSub profilePictureUrl"
    );

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    const propertyObj = property.toObject();
    if (
      !propertyObj.position &&
      propertyObj.latitude &&
      propertyObj.longitude
    ) {
      propertyObj.position = {
        lat: propertyObj.latitude,
        lng: propertyObj.longitude,
      };
    }

    res.json(propertyObj);
  } catch (err) {
    console.error("Fetch property by ID error:", err);
    if (err.kind === "ObjectId") {
      return res.status(400).json({ error: "Invalid property ID format" });
    }
    res.status(500).json({ error: "Server error fetching property" });
  }
};

// Fields a property owner (or an admin acting through this same endpoint -
// admin moderation actions like feature/approve/hide/soft-delete go through
// their own dedicated routes in adminController.js, never this one) may
// directly set via PUT /api/properties/:id. Deliberately excludes:
// - system/ownership fields: _id, createdBy, createdAt, updatedAt, __v
// - admin-only moderation fields: isHidden, featuredAt, isDeleted,
//   deletedAt, deletedBy (all managed exclusively by adminController.js)
// - geocoding-derived fields: latitude, longitude, position,
//   locationAccuracy, geocodedAddress, geoLocation - these are computed
//   below by geocodeAddress() when an address field changes, or via the
//   separate updatePropertyCoordinates endpoint - never accepted directly
//   from the client.
const OWNER_EDITABLE_PROPERTY_FIELDS = [
  "title",
  "price",
  "addressLine1",
  "addressLine2",
  "cityTown",
  "upazila",
  "district",
  "postalCode",
  "propertyType",
  "listingType",
  "listingStatus",
  "bedrooms",
  "bathrooms",
  "area",
  "features",
  "bangladeshDetails",
  "description",
  "images",
];

exports.updateProperty = async (req, res) => {
  try {
    const propertyId = req.params.id;
    const existingProperty = await Property.findById(propertyId);

    if (!existingProperty) {
      return res.status(404).json({ error: "Property not found" });
    }

    if (
      existingProperty.createdBy.toString() !==
        req.userProfile._id.toString() &&
      !req.userProfile.isAdmin
    ) {
      return res
        .status(403)
        .json({ error: "You are not authorized to update this property." });
    }

    const addressFields = [
      "addressLine1",
      "addressLine2",
      "cityTown",
      "upazila",
      "district",
      "postalCode",
    ];
    const addressFieldsUpdated = addressFields.some(
      (field) => field in req.body
    );

    let updatedFields = {};
    for (const field of OWNER_EDITABLE_PROPERTY_FIELDS) {
      if (field in req.body) {
        updatedFields[field] = req.body[field];
      }
    }

    // Conservative bilingual-description handling: only touch
    // description/description_en/description_bn when the seller submitted a
    // real, intentional change - i.e. text that doesn't already match any
    // of the three stored description fields (covers both "resubmitted the
    // English version unchanged" and "resubmitted the Bangla version
    // unchanged"). An empty or unchanged submission leaves all three fields
    // exactly as stored - this never runs automatically on every edit, and
    // never overwrites seller-written content with AI output. When it does
    // run, the language of the NEW text is auto-detected (English or
    // Bangla) and only the opposite-language field is (re)translated - see
    // propertyDescriptionService.buildFromManualDescription.
    if ("description" in req.body) {
      const trimmedNewDescription = (req.body.description || "").trim();
      const isUnchanged =
        !trimmedNewDescription ||
        trimmedNewDescription === (existingProperty.description_en || "") ||
        trimmedNewDescription === (existingProperty.description_bn || "") ||
        trimmedNewDescription === (existingProperty.description || "");
      if (!isUnchanged) {
        const result = await buildFromManualDescription(trimmedNewDescription);
        updatedFields.description = result.description;
        updatedFields.description_en = result.description_en;
        updatedFields.description_bn = result.description_bn;
      } else {
        delete updatedFields.description;
      }
    }

    if (addressFieldsUpdated) {
      const addressDataForUpdate = {
        addressLine1: req.body.addressLine1 || existingProperty.addressLine1,
        addressLine2: req.body.addressLine2 || existingProperty.addressLine2,
        cityTown: req.body.cityTown || existingProperty.cityTown,
        upazila: req.body.upazila || existingProperty.upazila,
        district: req.body.district || existingProperty.district,
        postalCode: req.body.postalCode || existingProperty.postalCode,
      };

      console.log(
        "Address fields updated. Re-geocoding with:",
        addressDataForUpdate
      );

      let geocodeResult = null;
      try {
        geocodeResult = await geocodeAddress(addressDataForUpdate);
      } catch (geocodeError) {
        console.error(
          "Error during geocoding for update:",
          geocodeError.message
        );
      }

      if (!geocodeResult) {
        // geocodeAddress() only returns null when the OpenCage API call
        // itself fails (network/auth/rate-limit) - a "no results" address
        // already gets a district-level fallback inside geocodeAddress()
        // itself. Fall back the same way createProperty() does on total
        // failure, so the new address text is never left paired with the
        // old, unrelated coordinates from before this edit.
        console.warn(
          "Geocoding failed for updated address. Using district-level fallback coordinates."
        );
        const districtCoordinates = getDistrictCoordinates(
          addressDataForUpdate.district
        );
        const fallback = districtCoordinates || { lat: 23.8103, lng: 90.4125 };
        geocodeResult = {
          latitude: fallback.lat,
          longitude: fallback.lng,
          position: { lat: fallback.lat, lng: fallback.lng },
          locationAccuracy: districtCoordinates ? "district-level" : "unknown",
          geocodedAddress: constructGeocodingAddress(addressDataForUpdate),
        };
      }

      // findByIdAndUpdate() does not run document pre-save middleware, so
      // geoLocation (the GeoJSON field M5's accessibility endpoints and the
      // chatbot's geo queries actually read) must be set explicitly here -
      // it will not be synchronized automatically the way it is on create().
      updatedFields.latitude = geocodeResult.latitude;
      updatedFields.longitude = geocodeResult.longitude;
      updatedFields.position = geocodeResult.position;
      updatedFields.locationAccuracy = geocodeResult.locationAccuracy;
      updatedFields.geocodedAddress = geocodeResult.geocodedAddress;
      updatedFields.geoLocation = {
        type: "Point",
        coordinates: [geocodeResult.longitude, geocodeResult.latitude],
      };
      console.log(
        `Geocoded updated address to: ${geocodeResult.latitude}, ${geocodeResult.longitude} (accuracy: ${geocodeResult.locationAccuracy})`
      );
    }

    const updatedProperty = await Property.findByIdAndUpdate(
      propertyId,
      { $set: updatedFields },
      { new: true, runValidators: true }
    ).populate(
      "createdBy",
      "_id displayName email cognitoSub profilePictureUrl"
    );

    if (!updatedProperty) {
      return res
        .status(404)
        .json({ error: "Property not found during update attempt." });
    }

    res.json(updatedProperty);
  } catch (err) {
    console.error("Update property error:", err);
    if (err.name === "ValidationError") {
      let errors = {};
      for (let field in err.errors) {
        errors[field] = err.errors[field].message;
      }
      return res
        .status(400)
        .json({ message: "Validation Error", errors: errors });
    }
    if (err.kind === "ObjectId") {
      return res.status(400).json({ error: "Invalid property ID format" });
    }
    res.status(500).json({ error: "Server error updating property" });
  }
};

exports.deleteProperty = async (req, res) => {
  try {
    const propertyId = req.params.id;
    const propertyToDelete = await Property.findById(propertyId);

    if (!propertyToDelete) {
      return res.status(404).json({ error: "Property not found" });
    }

    if (
      propertyToDelete.createdBy.toString() !==
        req.userProfile._id.toString() &&
      !req.userProfile.isAdmin
    ) {
      return res
        .status(403)
        .json({ error: "You are not authorized to delete this property." });
    }

    const deletedProperty = await Property.findByIdAndDelete(propertyId);
    if (!deletedProperty) {
      return res
        .status(404)
        .json({ error: "Property not found, may have been deleted already." });
    }
    res.json({ message: "Property deleted successfully" });
  } catch (err) {
    console.error("Delete property error:", err);
    if (err.kind === "ObjectId") {
      return res.status(400).json({ error: "Invalid property ID format" });
    }
    res.status(500).json({ error: "Server error deleting property" });
  }
};

exports.updatePropertyCoordinates = async (req, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid property ID" });
    }

    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return res
        .status(400)
        .json({ error: "Latitude and longitude must be numbers" });
    }

    if (!isValidBangladeshLocation(latitude, longitude)) {
      return res.status(400).json({
        error: "Coordinates are outside Bangladesh",
        details: "Please provide coordinates within Bangladesh territory",
      });
    }

    const propertyToUpdate = await Property.findById(id);
    if (!propertyToUpdate) {
      return res.status(404).json({ error: "Property not found" });
    }
    if (
      propertyToUpdate.createdBy.toString() !==
        req.userProfile._id.toString() &&
      !req.userProfile.isAdmin
    ) {
      return res.status(403).json({
        error:
          "You are not authorized to update coordinates for this property.",
      });
    }

    const updatedProperty = await Property.findByIdAndUpdate(
      id,
      {
        latitude,
        longitude,
        position: { lat: latitude, lng: longitude },
        locationAccuracy: "precise",
        manuallyUpdated: true,
      },
      { new: true, runValidators: true }
    );

    if (!updatedProperty) {
      return res
        .status(404)
        .json({ error: "Property not found after update attempt." });
    }

    res.json({
      message: "Property coordinates updated successfully",
      property: updatedProperty,
    });
  } catch (err) {
    console.error("Update property coordinates error:", err);
    res
      .status(500)
      .json({ error: "Server error updating property coordinates" });
  }
};

// s3 property images upload
exports.uploadPropertyImageToS3 = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No image file uploaded." });
  }
  if (!S3_PROPERTY_IMAGES_BUCKET || !process.env.APP_AWS_REGION) {
    console.error("S3 Property Images Bucket or Region not configured.");
    return res
      .status(500)
      .json({ message: "Server configuration error for file upload." });
  }

  const file = req.file;
  const originalName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${S3_PROPERTY_IMAGES_FOLDER}${uuidv4()}-${originalName}`;

  try {
    const uploadParams = {
      Bucket: S3_PROPERTY_IMAGES_BUCKET,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: "public-read",
    };

    const propertyImagesS3Client = await getPropertyImagesS3Client();
    await propertyImagesS3Client.send(new PutObjectCommand(uploadParams));

    const imageUrl = await buildS3ObjectUrl(S3_PROPERTY_IMAGES_BUCKET, fileName);
    res
      .status(200)
      .json({ message: "Image uploaded successfully", imageUrl: imageUrl });
  } catch (error) {
    console.error("Error uploading property image to S3:", error);
    if (error.name === "CredentialsError" || error.name === "AccessDenied") {
      console.error(
        "AWS Credentials or Permissions issue for Property Images S3 Client."
      );
    }
    res.status(500).json({ message: "Failed to upload image." });
  }
};

exports.batchGeocodeProperties = async (req, res) => {
  if (!req.userProfile || !req.userProfile.isAdmin) {
    return res
      .status(403)
      .json({ error: "Admin privileges required for batch geocoding." });
  }

  try {
    const { limit = 10 } = req.query;
    const parsedLimit = parseInt(limit, 10);

    if (isNaN(parsedLimit) || parsedLimit <= 0) {
      return res.status(400).json({
        error: "Invalid limit parameter. Must be a positive integer.",
      });
    }

    const properties = await Property.find({
      isDeleted: { $ne: true },
      $or: [
        { latitude: { $exists: false } },
        { longitude: { $exists: false } },
        { position: { $exists: false } },
        { locationAccuracy: "unknown" },
      ],
    }).limit(parsedLimit);

    console.log(
      `Found ${properties.length} properties to geocode (limit: ${parsedLimit})`
    );

    if (properties.length === 0) {
      return res.json({
        message: "No properties currently need geocoding based on criteria.",
      });
    }

    const results = {
      totalToProcess: properties.length,
      successfulGeocodes: 0,
      failedGeocodes: 0,
      details: [],
    };

    for (const property of properties) {
      const addressData = {
        addressLine1: property.addressLine1,
        addressLine2: property.addressLine2,
        cityTown: property.cityTown,
        upazila: property.upazila,
        district: property.district,
        postalCode: property.postalCode,
      };

      try {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const geocodeResult = await geocodeAddress(addressData);

        if (geocodeResult) {
          await Property.findByIdAndUpdate(property._id, {
            ...geocodeResult,
          });

          results.successfulGeocodes++;
          results.details.push({
            propertyId: property._id.toString(),
            status: "success",
            coordinates: `${geocodeResult.latitude}, ${geocodeResult.longitude}`,
            accuracy: geocodeResult.locationAccuracy,
            formattedAddress: geocodeResult.formatted,
          });
        } else {
          results.failedGeocodes++;
          results.details.push({
            propertyId: property._id.toString(),
            status: "failed",
            reason:
              "Geocoding returned no results for the constructed address.",
            addressAttempted: constructGeocodingAddress(addressData),
          });
        }
      } catch (error) {
        results.failedGeocodes++;
        results.details.push({
          propertyId: property._id.toString(),
          status: "error",
          reason: error.message,
          addressAttempted: constructGeocodingAddress(addressData),
        });
      }
    }

    res.json({
      message: `Batch geocoding completed. Success: ${results.successfulGeocodes}, Failed: ${results.failedGeocodes} out of ${results.totalToProcess}.`,
      results,
    });
  } catch (err) {
    console.error("Batch geocode error:", err);
    res.status(500).json({ error: "Server error during batch geocoding." });
  }
};