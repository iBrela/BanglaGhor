const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { body } = require("express-validator");
const {
  handleValidationErrors,
} = require("../middleware/ValidationMiddleware");
const contactController = require("../controllers/contactController");

// Scoped to this one public, unauthenticated, database-writing endpoint
// only - not applied anywhere else. A modest, user-friendly cap (5
// submissions per 15 minutes per client IP) that a real visitor filling out
// the form once or twice would never hit, while blocking obvious automated
// spam. Placed before validation so even invalid repeated submissions count
// toward the limit. Note: the default store is in-memory, per Node
// process - in the Netlify/serverless deployment, req.ip is set directly by
// serverless-http from AWS/Netlify's own connection-verified sourceIp
// (verified: unaffected by a spoofed X-Forwarded-For header either way),
// so no Express trust-proxy configuration is needed or set for this.
const contactFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many contact requests. Please try again later." },
});

// Public - matches /api/properties (GET) and /api/locations/search's
// unauthenticated pattern. The product doesn't require login to contact
// support, and nothing here reads req.user/req.userProfile.
router.post(
  "/",
  contactFormLimiter,
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
