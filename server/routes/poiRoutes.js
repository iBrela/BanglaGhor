// server/routes/poiRoutes.js
const express = require("express");
const router = express.Router();
const { query } = require("express-validator");
const poiController = require("../controllers/poiController");
const {
  handleValidationErrors,
} = require("../middleware/ValidationMiddleware");
const PointOfInterest = require("../models/PointOfInterest");

// Public nearby-POI search - read-only, no chatbot/routing integration yet.
router.get(
  "/nearby",
  [
    query("lat").isFloat().withMessage("lat must be a number."),
    query("lng").isFloat().withMessage("lng must be a number."),
    query("category")
      .optional()
      .isIn(PointOfInterest.CATEGORIES)
      .withMessage(`category must be one of: ${PointOfInterest.CATEGORIES.join(", ")}`),
    query("radius")
      .optional()
      .isFloat({ gt: 0 })
      .withMessage("radius must be a positive number."),
    query("limit")
      .optional()
      .isInt({ gt: 0 })
      .withMessage("limit must be a positive integer."),
  ],
  handleValidationErrors,
  poiController.getNearbyPOIs
);

module.exports = router;
