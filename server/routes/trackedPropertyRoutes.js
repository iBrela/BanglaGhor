const express = require("express");
const router = express.Router();
const trackedPropertyController = require("../controllers/trackedPropertyController");
const authMiddleware = require("../middleware/authMiddleware");

// All three routes reuse the project's existing Cognito/JWT authMiddleware -
// no new authentication mechanism. Ownership is resolved server-side from
// the verified token inside the controller, never from client-supplied ids.
router.get("/", authMiddleware, trackedPropertyController.getTrackedProperties);
router.post("/", authMiddleware, trackedPropertyController.trackProperty);
router.delete("/:propertyId", authMiddleware, trackedPropertyController.untrackProperty);

module.exports = router;
