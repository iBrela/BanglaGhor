// server/routes/locationRoutes.js
const express = require("express");
const router = express.Router();
const { query } = require("express-validator");
const locationController = require("../controllers/locationController");
const {
  handleValidationErrors,
} = require("../middleware/ValidationMiddleware");

// Public autocomplete search - Photon only (see locationService.js for why).
router.get(
  "/search",
  [
    query("q")
      .optional()
      .isString()
      .isLength({ max: 200 })
      .withMessage("Query must be a string of at most 200 characters."),
    query("lang")
      .optional()
      .isIn(["en", "bn"])
      .withMessage("lang must be 'en' or 'bn'."),
  ],
  handleValidationErrors,
  locationController.searchLocations
);

module.exports = router;
