const express = require("express");
const router = express.Router();
const { body } = require("express-validator");
const {
  handleValidationErrors,
} = require("../middleware/ValidationMiddleware");
const contactController = require("../controllers/contactController");

// Public - matches /api/properties (GET) and /api/locations/search's
// unauthenticated pattern. The product doesn't require login to contact
// support, and nothing here reads req.user/req.userProfile.
router.post(
  "/",
  [
    body("name")
      .notEmpty()
      .trim()
      .escape()
      .isLength({ max: 100 })
      .withMessage("Name is required (max 100 characters)."),
    body("email")
      .notEmpty()
      .trim()
      .isEmail()
      .withMessage("A valid email address is required.")
      .normalizeEmail()
      .isLength({ max: 254 })
      .withMessage("Email is too long."),
    body("phone")
      .optional({ checkFalsy: true })
      .trim()
      .escape()
      .isLength({ max: 30 })
      .withMessage("Phone number is too long."),
    body("subject")
      .notEmpty()
      .trim()
      .escape()
      .isLength({ max: 200 })
      .withMessage("Subject is required (max 200 characters)."),
    body("message")
      .notEmpty()
      .trim()
      .escape()
      .isLength({ max: 5000 })
      .withMessage("Message is required (max 5000 characters)."),
  ],
  handleValidationErrors,
  contactController.submitContactMessage
);

module.exports = router;
