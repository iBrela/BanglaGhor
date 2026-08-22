// server/routes/accessibilityRoutes.js
const express = require("express");
const router = express.Router();
const { query } = require("express-validator");
const accessibilityController = require("../controllers/accessibilityController");
const {
  handleValidationErrors,
} = require("../middleware/ValidationMiddleware");
const routingService = require("../services/routingService");
const PointOfInterest = require("../models/PointOfInterest");

const VALID_MODES = Object.keys(routingService.MODE_TO_COSTING);

// Public, read-only - same convention as poiRoutes.js/routingRoutes.js.
// Shape/type checks here; Bangladesh-bounds and the rest of the numeric
// business validation live in accessibilityController.js.
router.get(
  "/nearby",
  [
    query("lat").isFloat().withMessage("lat must be a number."),
    query("lng").isFloat().withMessage("lng must be a number."),
    query("category")
      .isIn(PointOfInterest.CATEGORIES)
      .withMessage(`category must be one of: ${PointOfInterest.CATEGORIES.join(", ")}`),
    query("mode")
      .optional()
      .isIn(VALID_MODES)
      .withMessage(`mode must be one of: ${VALID_MODES.join(", ")}`),
    query("radius").optional().isFloat({ gt: 0 }).withMessage("radius must be a positive number."),
    query("candidateLimit").optional().isInt({ gt: 0 }).withMessage("candidateLimit must be a positive integer."),
    query("limit").optional().isInt({ gt: 0 }).withMessage("limit must be a positive integer."),
    query("maxMinutes").optional().isFloat({ gt: 0 }).withMessage("maxMinutes must be a positive number."),
  ],
  handleValidationErrors,
  accessibilityController.getNearby
);

module.exports = router;
