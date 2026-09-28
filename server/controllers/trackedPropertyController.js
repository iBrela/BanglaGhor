const mongoose = require("mongoose");
const TrackedProperty = require("../models/TrackedProperty");
const UserProfile = require("../models/UserProfile");
const Property = require("../models/property");

// Same identity resolution userProfileController.js's own getMyListings
// already uses - req.user comes from authMiddleware (verified Cognito JWT
// claims only: email/username/sub, see server/middleware/authMiddleware.js)
// and is never trusted for anything beyond looking up the caller's own
// UserProfile row. No new auth mechanism.
async function resolveUserProfile(req) {
  const queryIdentifier = req.user?.sub
    ? { cognitoSub: req.user.sub }
    : { email: req.user?.email };
  return UserProfile.findOne(queryIdentifier);
}

const projection =
  "title price listingType propertyType images addressLine1 cityTown district upazila createdAt bedrooms bathrooms area listingStatus locationAccuracy geoLocation latitude longitude position";

exports.getTrackedProperties = async (req, res) => {
  if (!req.user || (!req.user.email && !req.user.sub)) {
    return res.status(401).json({ error: "Authentication required." });
  }
  try {
    const userProfile = await resolveUserProfile(req);
    if (!userProfile) {
      return res.status(200).json([]);
    }

    const tracked = await TrackedProperty.find({ user: userProfile._id })
      .sort({ trackedAt: -1 })
      .populate({
        path: "property",
        match: { isDeleted: { $ne: true } },
        select: projection,
      });

    // populate's `match` leaves `property: null` on a row whose target was
    // soft-deleted since being tracked - drop those rather than surfacing a
    // broken card. The stale TrackedProperty row itself is left alone (no
    // implicit delete here); it simply stops appearing until untracked.
    const properties = tracked.filter((t) => t.property).map((t) => t.property);
    res.status(200).json(properties);
  } catch (error) {
    console.error("Error fetching tracked properties:", error.message);
    res.status(500).json({ error: "Server error fetching tracked properties." });
  }
};

exports.trackProperty = async (req, res) => {
  if (!req.user || (!req.user.email && !req.user.sub)) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const { propertyId } = req.body;
  // The only field read from the request body - never trusted as-is, always
  // validated as a real ObjectId and then checked against the database
  // before any write, per the "never trust a client-supplied property ID"
  // requirement.
  if (!propertyId || !mongoose.Types.ObjectId.isValid(propertyId)) {
    return res.status(400).json({ error: "A valid propertyId is required." });
  }

  try {
    const userProfile = await resolveUserProfile(req);
    if (!userProfile) {
      return res.status(404).json({ error: "User profile not found." });
    }

    const property = await Property.findOne({
      _id: propertyId,
      isDeleted: { $ne: true },
    }).select("_id");
    if (!property) {
      return res.status(404).json({ error: "Property not found." });
    }

    try {
      await TrackedProperty.create({ user: userProfile._id, property: property._id });
    } catch (err) {
      // E11000 = the unique {user, property} index rejected a duplicate -
      // treat re-tracking an already-tracked property as an idempotent
      // success rather than an error.
      if (err.code === 11000) {
        return res.status(200).json({ message: "Property is already tracked." });
      }
      throw err;
    }

    res.status(201).json({ message: "Property tracked successfully." });
  } catch (error) {
    console.error("Error tracking property:", error.message);
    res.status(500).json({ error: "Server error tracking property." });
  }
};

exports.untrackProperty = async (req, res) => {
  if (!req.user || (!req.user.email && !req.user.sub)) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const { propertyId } = req.params;
  if (!propertyId || !mongoose.Types.ObjectId.isValid(propertyId)) {
    return res.status(400).json({ error: "A valid propertyId is required." });
  }

  try {
    const userProfile = await resolveUserProfile(req);
    if (!userProfile) {
      return res.status(404).json({ error: "User profile not found." });
    }

    // Scoped to this caller's own userProfile._id (resolved server-side
    // from the verified JWT, never from client input) - structurally
    // impossible for one user to untrack another user's row, since the
    // delete filter always includes their own resolved id.
    const result = await TrackedProperty.findOneAndDelete({
      user: userProfile._id,
      property: propertyId,
    });
    if (!result) {
      return res.status(404).json({ error: "Tracked property not found." });
    }

    res.status(200).json({ message: "Property untracked successfully." });
  } catch (error) {
    console.error("Error untracking property:", error.message);
    res.status(500).json({ error: "Server error untracking property." });
  }
};
