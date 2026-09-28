const mongoose = require("mongoose");
const { Schema } = mongoose;

// Deliberately separate from Wishlist (see server/models/Wishlist.js) -
// "tracked" and "saved/wishlisted" are different user intents in this
// product and must never share storage or semantics.
//
// Uses the same ObjectId-reference convention already established by
// Property.createdBy (server/models/property.js), not Wishlist's own plain
// username-string convention - a tracked property is owned by a real
// UserProfile document, referenced properly.
const trackedPropertySchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: "UserProfile",
    required: true,
    index: true,
  },
  property: {
    type: Schema.Types.ObjectId,
    ref: "Property",
    required: true,
    index: true,
  },
  trackedAt: {
    type: Date,
    default: Date.now,
  },
});

// A user can only track a given property once - enforced at the database
// level (not just in application code), so a duplicate POST can never
// create a second row even under a race condition.
trackedPropertySchema.index({ user: 1, property: 1 }, { unique: true });

module.exports = mongoose.model("TrackedProperty", trackedPropertySchema);
