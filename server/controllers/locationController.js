// ============================================================================
// LOCATION CONTROLLER — thin HTTP layer over locationService.searchLocations
// ============================================================================
// Public, unauthenticated (matches propertyController.getAllProperties'
// pattern - this is a read-only search, no user data involved). Never
// exposes the raw provider response - only the normalized shape locationService
// already returns.
// ============================================================================

const locationService = require("../services/locationService");

exports.searchLocations = async (req, res) => {
  try {
    const { q, lang } = req.query;
    const result = await locationService.searchLocations(q, { lang });
    res.json(result);
  } catch (error) {
    console.error("[LocationController] searchLocations error:", error.message);
    // Controlled failure shape, matching what locationService itself returns
    // on a provider error - the frontend only ever needs to handle one shape.
    res.status(200).json({ results: [], provider: "photon", status: "unavailable" });
  }
};
