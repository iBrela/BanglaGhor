// server/routes/routingRoutes.js
const express = require("express");
const router = express.Router();
const { query, body } = require("express-validator");
const routingController = require("../controllers/routingController");
const {
  handleValidationErrors,
} = require("../middleware/ValidationMiddleware");
const routingService = require("../services/routingService");

const VALID_MODES = Object.keys(routingService.MODE_TO_COSTING);

// Public, read-only - matches /api/pois/nearby's pattern. Basic shape/type
// checks here; Bangladesh-bounds and business-rule checks (identical-point
// shortcut, matrix cell cap) live in routingController.js.
router.get(
  "/route",
  [
    query("originLat").isFloat().withMessage("originLat must be a number."),
    query("originLng").isFloat().withMessage("originLng must be a number."),
    query("destLat").isFloat().withMessage("destLat must be a number."),
    query("destLng").isFloat().withMessage("destLng must be a number."),
    query("mode").isIn(VALID_MODES).withMessage(`mode must be one of: ${VALID_MODES.join(", ")}`),
    query("geometry")
      .optional()
      .isIn(["true", "false"])
      .withMessage("geometry must be 'true' or 'false'."),
  ],
  handleValidationErrors,
  routingController.getRoute
);

router.post(
  "/matrix",
  [
    body("origins").isArray({ min: 1 }).withMessage("origins must be a non-empty array."),
    body("destinations").isArray({ min: 1 }).withMessage("destinations must be a non-empty array."),
    body("mode").isIn(VALID_MODES).withMessage(`mode must be one of: ${VALID_MODES.join(", ")}`),
  ],
  handleValidationErrors,
  routingController.getMatrix
);

module.exports = router;
