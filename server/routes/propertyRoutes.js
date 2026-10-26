// server/routes/propertyRoutes.js
const express = require("express");
const router = express.Router();
const propertyController = require("../controllers/propertyController");
const authMiddleware = require("../middleware/authMiddleware");
const fetchUserProfileMiddleware = require("../middleware/fetchUserProfileMiddleware");
const checkListingApprovalMiddleware = require("../middleware/checkListingApprovalMiddleware.js"); 
const {
  handleValidationErrors,
} = require("../middleware/ValidationMiddleware");
const { body, param, query } = require("express-validator");
const multer = require("multer");
const accessibilityController = require("../controllers/accessibilityController");
const routingService = require("../services/routingService");
const PointOfInterest = require("../models/PointOfInterest");

const VALID_ACCESSIBILITY_MODES = Object.keys(routingService.MODE_TO_COSTING);

// >> ENSURE THIS MULTER CONFIGURATION IS PRESENT AND CORRECT <<
// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Not an image! Please upload an image file."), false);
    }
  },
});

router.post(
  "/",
  authMiddleware, 
  fetchUserProfileMiddleware, 
  [
    
    // .escape() deliberately NOT used on title/address fields below - it
    // HTML-entity-encodes the stored value (e.g. "Road No. 9/A" becomes
    // "Road No. 9&#x2F;A" in the database), which then renders as that raw,
    // unreadable entity text everywhere the property is displayed, since
    // nothing in this app's frontend ever decodes it back (confirmed: zero
    // uses of dangerouslySetInnerHTML anywhere in src/ - every field is
    // rendered as plain React text, which already safely escapes markup on
    // its own). .escape() here only corrupted legitimate punctuation
    // (slashes, ampersands, apostrophes) in real addresses/titles without
    // adding any actual XSS protection beyond what React already provides.
    body("title").notEmpty().trim().withMessage("Title is required."), //
    body("price").isNumeric().withMessage("Price must be a number.").toFloat(), //

    body("addressLine1") //
      .notEmpty()
      .trim()
      .withMessage("Address Line 1 is required."),
    body("addressLine2").optional().trim(), //
    body("cityTown") //
      .notEmpty()
      .trim()
      .withMessage("City/Town is required."),
    body("upazila") //
      .notEmpty()
      .trim()
      .withMessage("Upazila is required."),
    body("district") //
      .notEmpty()
      .trim()
      .withMessage("District is required."),
    body("postalCode") //
      .notEmpty()
      .trim()
      .withMessage("Postal Code is required."),

    
    body("propertyType") //
      .isIn(["apartment", "house", "condo", "land", "commercial"])
      .withMessage("Invalid property type."),
    body("listingType") //
      .isIn(["rent", "buy", "sold"])
      .withMessage("Invalid listing type."),

    body("listingStatus")
      .optional() 
      .isIn(["available", "rented", "sold", "unavailable"])
      .withMessage("Invalid listing status."),

    
    body("bedrooms") //
      .optional()
      .isInt({ min: 0 })
      .withMessage("Bedrooms must be a non-negative integer.")
      .toInt(),
    body("bathrooms") //
      .optional()
      .isInt({ min: 0 })
      .withMessage("Bathrooms must be a non-negative integer.")
      .toInt(),
    body("area") //
      .optional()
      .isNumeric()
      .withMessage("Area must be a number.")
      .toFloat(),

    body("features.parking") //
      .optional()
      .isBoolean()
      .withMessage("Parking must be true or false."),
    body("features.garden") //
      .optional()
      .isBoolean()
      .withMessage("Garden must be true or false."),
    body("features.airConditioning") //
      .optional()
      .isBoolean()
      .withMessage("Air Conditioning must be true or false."),
    body("features.furnished") //
      .optional()
      .isIn(["no", "semi", "full"])
      .withMessage("Invalid furnished status."),
    body("features.pool") //
      .optional()
      .isBoolean()
      .withMessage("Pool must be true or false."),

    body("bangladeshDetails.backupPower")
      .optional() 
      .isIn(["ips", "generator", "solar", "none"]) 
      .withMessage("Invalid backup power option."),
    body("bangladeshDetails.sewerSystem")
      .optional()
      .isIn(["covered", "open", "septic_tank", "none"]) 
      .withMessage("Invalid sewer system option."),
    body("bangladeshDetails.parkingType")
      .optional()
      .isIn(["dedicated", "street", "garage", "none"]) 
      .withMessage("Invalid parking type option."),

    // Only required for property types that actually have building
    // utilities (not land/commercial) - matches the frontend's own
    // needsBuildingSpecifics gate (see useListingForm.js/
    // Step3_PropertyDetails.js). Previously these were unconditionally
    // .notEmpty() for every property type, which meant a land/commercial
    // listing (the frontend never requires these for that type) could fail
    // this validator - a real pre-existing gating inconsistency, now fixed.
    body("bangladeshDetails.propertyCondition")
      .optional({ checkFalsy: true })
      .isIn(["new", "under_construction", "resale"])
      .withMessage("Invalid property condition."),
    body("bangladeshDetails.propertyCondition").custom((value, { req }) => {
      const isLandOrCommercial = ["land", "commercial"].includes(req.body.propertyType);
      if (!isLandOrCommercial && !value) {
        throw new Error("Property condition is required for this property type.");
      }
      return true;
    }),
    body("bangladeshDetails.waterSource")
      .optional({ checkFalsy: true })
      .isIn(["wasa", "deep_tube_well", "both", "other"])
      .withMessage("Invalid water source."),
    body("bangladeshDetails.waterSource").custom((value, { req }) => {
      const isLandOrCommercial = ["land", "commercial"].includes(req.body.propertyType);
      if (!isLandOrCommercial && !value) {
        throw new Error("Water source is required for this property type.");
      }
      return true;
    }),
    body("bangladeshDetails.gasSource")
      .optional({ checkFalsy: true })
      .isIn(["piped", "cylinder", "none"])
      .withMessage("Invalid gas source."),
    body("bangladeshDetails.gasSource").custom((value, { req }) => {
      const isLandOrCommercial = ["land", "commercial"].includes(req.body.propertyType);
      if (!isLandOrCommercial && !value) {
        throw new Error("Gas source is required for this property type.");
      }
      return true;
    }),
    body("bangladeshDetails.gasLineInstalled")
      .optional() 
      .isIn(["yes", "no", "na"]) 
      .withMessage("Invalid gas line installation status."),
    body("bangladeshDetails.floodProne")
      .optional() 
      .isIn(["yes", "no", "sometimes"]) 
      .withMessage("Invalid flood prone status."),
    body("bangladeshDetails.securityFeatures.*") 
      .optional()
      .isIn(["gated", "guards", "cctv"]) 
      .withMessage("Invalid security feature selected."),
    body("bangladeshDetails.earthquakeResistance")
      .optional() 
      .isIn(["yes", "no", "unknown"]) 
      .withMessage("Invalid earthquake resistance status."),
    body("bangladeshDetails.balcony")
      .optional() 
      .isIn(["yes", "no"]) 
      .withMessage("Invalid balcony status."),
    body("bangladeshDetails.rooftopAccess")
      .optional() 
      .isIn(["yes", "no"]) 
      .withMessage("Invalid rooftop access status."),
    body("bangladeshDetails.ownershipPapers")
      .optional()
      .isIn(["clear", "pending", "issue", "unknown"]) 
      .withMessage("Invalid ownership papers status."),
    body("bangladeshDetails.propertyTenure")
      .optional()
      .isIn(["freehold", "leasehold", "unknown", ""]) 
      .withMessage("Invalid property tenure."),
  ],
  handleValidationErrors, //
  propertyController.createProperty //
);


router.get(
  "/",
  [
    query("random") 
      .optional()
      .isBoolean()
      .withMessage("Random must be true or false."),
    query("featured") 
      .optional()
      .isBoolean()
      .withMessage("Featured must be true or false."),
    query("limit") 
      .optional()
      .isInt({ min: 1 })
      .withMessage("Limit must be a positive integer."),
    query("listingType") 
      .optional()
      .isIn(["rent", "buy", "sold"])
      .withMessage("Invalid listing type filter."),
    query("listingStatus") 
      .optional()
      .isIn(["available", "rented", "sold", "unavailable"])
      .withMessage("Invalid listing status filter."),
    query("includeUnavailable") 
      .optional()
      .isBoolean()
      .withMessage("includeUnavailable must be true or false.")
      .toBoolean(),
  ],
  handleValidationErrors, //
  propertyController.getAllProperties //
);


router.get(
  "/:id",
  [
    param("id").isMongoId().withMessage("Invalid property ID format."), //
  ],
  handleValidationErrors, //
  propertyController.getPropertyById //
);

router.put(
  "/:id",
  authMiddleware, //
  fetchUserProfileMiddleware, // <<<< ADD THIS if updates depend on user profile or for ownership checks
  [
    param("id").isMongoId().withMessage("Invalid property ID format."), //
    // .escape() intentionally not used here either - see the matching
    // comment on the create-property validator above.
    body("title") //
      .optional()
      .notEmpty()
      .trim()
      .withMessage("Title cannot be empty if provided."),
    body("price") //
      .optional()
      .isNumeric()
      .withMessage("Price must be a number.")
      .toFloat(),
    body("addressLine1") //
      .optional()
      .notEmpty()
      .trim()
      .withMessage("Address Line 1 cannot be empty if provided."),
    body("cityTown") //
      .optional()
      .notEmpty()
      .trim()
      .withMessage("City/Town cannot be empty if provided."),
    body("isHidden") //
      .optional()
      .isBoolean()
      .withMessage("isHidden must be true or false."),

    body("listingStatus")
      .optional()
      .isIn(["available", "rented", "sold", "unavailable"])
      .withMessage("Invalid listing status provided for update."),
  ],
  handleValidationErrors, //
  propertyController.updateProperty //
);


// ============================================================================
// "Enhance with AI" (Phase 2 listing-flow improvement) - seller-triggered,
// pre-submission only. Never creates/modifies a Property document, so this
// deliberately doesn't need fetchUserProfileMiddleware/approval checks -
// just an authenticated user, to keep the AI call from being publicly
// abusable. Description length capped to keep prompt size/AI usage bounded.
// ============================================================================
router.post(
  "/enhance-description",
  authMiddleware,
  [
    // Blank is valid input here (generates a fresh grounded description
    // from confirmed listing data instead of merging with seller text -
    // see propertyDescriptionService.enhanceOrGenerateDescription).
    body("description")
      .trim()
      .optional({ checkFalsy: true })
      .isLength({ max: 4000 })
      .withMessage("Description must be at most 4000 characters."),
    body("lang").optional().isIn(["en", "bn"]).withMessage("Invalid language."),
  ],
  handleValidationErrors,
  propertyController.enhanceDescription
);

router.post(
  "/upload-image",
  authMiddleware,
  fetchUserProfileMiddleware,
  checkListingApprovalMiddleware,
  upload.single("propertyImage"), // 'propertyImage' is the field name from FormData
  propertyController.uploadPropertyImageToS3 // Ensure this controller function exists
);

router.delete(
  "/:id",
  authMiddleware, //
  fetchUserProfileMiddleware, // <<<< ADD THIS if deletes depend on user profile or for ownership checks
  [
    param("id").isMongoId().withMessage("Invalid property ID format."), //
  ],
  handleValidationErrors, //
  propertyController.deleteProperty //
);

// ============================================================================
// ACCESSIBILITY (Phase E) - additive, read-only sub-resources of a property.
// Deliberately kept out of propertyController.js (a different concern -
// travel-time/POI accessibility, not property CRUD) - handlers live in
// accessibilityController.js, reused as-is from accessibilityRoutes.js's
// standalone /api/accessibility/nearby endpoint. Existing property routes
// above are completely unchanged.
// ============================================================================
router.get(
  "/:id/accessibility",
  [
    param("id").isMongoId().withMessage("Invalid property ID format."),
    query("category")
      .isIn(PointOfInterest.CATEGORIES)
      .withMessage(`category must be one of: ${PointOfInterest.CATEGORIES.join(", ")}`),
    query("mode")
      .optional()
      .isIn(VALID_ACCESSIBILITY_MODES)
      .withMessage(`mode must be one of: ${VALID_ACCESSIBILITY_MODES.join(", ")}`),
    query("radius").optional().isFloat({ gt: 0 }).withMessage("radius must be a positive number."),
    query("candidateLimit").optional().isInt({ gt: 0 }).withMessage("candidateLimit must be a positive integer."),
    query("limit").optional().isInt({ gt: 0 }).withMessage("limit must be a positive integer."),
    query("maxMinutes").optional().isFloat({ gt: 0 }).withMessage("maxMinutes must be a positive number."),
  ],
  handleValidationErrors,
  accessibilityController.getPropertyAccessibility
);

router.get(
  "/:id/accessibility-summary",
  [
    param("id").isMongoId().withMessage("Invalid property ID format."),
    query("mode")
      .optional()
      .isIn(VALID_ACCESSIBILITY_MODES)
      .withMessage(`mode must be one of: ${VALID_ACCESSIBILITY_MODES.join(", ")}`),
  ],
  handleValidationErrors,
  accessibilityController.getPropertyAccessibilitySummary
);

module.exports = router;
