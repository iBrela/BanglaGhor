const express = require("express");
const router = express.Router({ mergeParams: true });
const wishlistController = require("../controllers/wishlistController");
const authMiddleware = require("../middleware/authMiddleware");

// The Wishlist model's "username" field is keyed by the user's email (see
// useWishlist.js on the frontend), not the Cognito "cognito:username" claim -
// so ownership must be checked against req.user.email, not req.user.username.
const verifyWishlistOwner = (req, res, next) => {
  const requestedUsername = req.params.username;
  const authenticatedEmail = req.user?.email;

  if (
    !authenticatedEmail ||
    !requestedUsername ||
    authenticatedEmail.toLowerCase() !== requestedUsername.toLowerCase()
  ) {
    return res
      .status(403)
      .json({ message: "You can only access your own wishlist." });
  }
  next();
};

router.post(
  "/",
  authMiddleware,
  verifyWishlistOwner,
  wishlistController.addToWishlist
);
router.get(
  "/",
  authMiddleware,
  verifyWishlistOwner,
  wishlistController.getWishlist
);
router.delete(
  "/",
  authMiddleware,
  verifyWishlistOwner,
  wishlistController.removeFromWishlist
);

module.exports = router;
