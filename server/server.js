const path = require("path");

require("node:dns").setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const aiRoutes = require("./routes/aiRoutes");
const propertyRoutes = require("./routes/propertyRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const userProfileRoutes = require("./routes/userProfileRoutes");
const adminRoutes = require("./routes/adminRoutes");
const chatRoutes = require("./routes/chatRoutes");
const locationRoutes = require("./routes/locationRoutes");
const poiRoutes = require("./routes/poiRoutes");
const routingRoutes = require("./routes/routingRoutes");
const accessibilityRoutes = require("./routes/accessibilityRoutes");

// 2) imports
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 3) API Routes
app.use("/api/ai", aiRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/users/:username/wishlist", wishlistRoutes);
app.use("/api/user-profiles", userProfileRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/pois", poiRoutes);
app.use("/api/routing", routingRoutes);
app.use("/api/accessibility", accessibilityRoutes);

// 4) Connect to DB
// No process.exit() here: this module is also require()'d directly by the
// Netlify Functions handler (server/netlify/functions/api.js), so exiting
// the process on a connection problem would kill that serverless
// invocation rather than just failing the current request. Failures are
// logged instead, and existing per-request DB calls already surface their
// own errors (e.g. Mongoose's buffering timeout) through normal
// controller error handling.
const uri = process.env.MONGO_URI;

const connectToDatabase = () => {
  if (!uri) {
    console.error(
      "No Mongo URI found in ENV! Check your .env name. Routes that need the database will fail until MONGO_URI is set."
    );
    return;
  }

  // Guard against re-connecting an already-connected/connecting instance,
  // in case this module ends up require()'d more than once in the same
  // process (e.g. a reused warm serverless container).
  if (mongoose.connection.readyState !== 0) {
    return;
  }

  mongoose
    .connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    .then(() => {
      console.log("✅ Connected to MongoDB Atlas successfully!");
    })
    .catch((err) => {
      console.error("❌ Error connecting to MongoDB Atlas:", err.message);
    });
};

connectToDatabase();

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB connection error (post-startup):", err.message);
});

// 5) MODELS (Ensure UserProfile is defined in its file)
const Property = require("./models/property");
const Wishlist = require("./models/Wishlist");
const UserProfile = require("./models/UserProfile");

// 6) TEST ROUTE
app.get("/", (req, res) => {
  res.send("Hello from the backend server! MongoDB connection is active.");
});

// // 7) Start Server
const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});//  🎉  This has been commented out for deployment on Netlify 🎉

module.exports = { app };
