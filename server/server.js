const path = require("path");

require("node:dns").setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const aiRoutes = require("./routes/aiRoutes");
const propertyRoutes = require("./routes/propertyRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const userProfileRoutes = require("./routes/userProfileRoutes");
const trackedPropertyRoutes = require("./routes/trackedPropertyRoutes");
const adminRoutes = require("./routes/adminRoutes");
const chatRoutes = require("./routes/chatRoutes");
const locationRoutes = require("./routes/locationRoutes");
const poiRoutes = require("./routes/poiRoutes");
const routingRoutes = require("./routes/routingRoutes");
const accessibilityRoutes = require("./routes/accessibilityRoutes");
const contactRoutes = require("./routes/contactRoutes");

// 2) imports
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");

const app = express();

// Safe HTTP security headers. This server never sends the React HTML
// document (see netlify.toml - the frontend is built and served separately
// by Netlify's static hosting; this Express app only ever answers /api/*
// JSON requests, confirmed by there being no express.static/sendFile/HTML
// response anywhere in this codebase). Content-Security-Policy protects a
// rendered HTML document (inline scripts, image/connect/frame sources,
// etc.) - since this server doesn't serve that document, a CSP header here
// would apply only to JSON API responses, where it provides no real
// protection while adding real risk of misconfiguration against this
// project's external integrations (MapLibre/PMTiles, Cognito, Ably, S3
// property images). Left disabled here; if the frontend's own document
// ever needs a CSP, it belongs wherever that HTML is actually served
// (Netlify headers config), not here.
// HSTS: only meaningful over HTTPS. Local dev runs plain HTTP - Helmet
// would otherwise still send Strict-Transport-Security, which browsers
// mostly ignore over HTTP but which has no purpose there. Enabled only
// when NODE_ENV=production (Netlify Functions sets this automatically),
// matching how TLS termination actually happens (Netlify's edge, not this
// app) - never assumes local development is HTTPS.
app.use(
  helmet({
    contentSecurityPolicy: false,
    hsts: process.env.NODE_ENV === "production" ? {} : false,
  })
);

// Comma-separated list of browser origins allowed to call this API - see
// server/.env.example. Defaults to the local CRA dev origin (this app's
// package.json "proxy" only covers same-origin dev requests; many hooks in
// src/ call REACT_APP_API_URL/localhost:5001 directly, which is a genuine
// cross-origin browser request in local dev, so it must stay allowed here).
// No production origin is hardcoded - it must be set via ALLOWED_ORIGINS.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header - curl, server-to-server calls, health checks,
      // this project's own smoke tests. No browser same-origin policy
      // applies to these, so allow them through rather than breaking
      // legitimate non-browser callers.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      // Unapproved browser origin: withhold CORS headers instead of
      // throwing, so the request still completes normally server-side and
      // it's the browser - not this server - that blocks the response. No
      // error, no internal details returned, no crash risk.
      callback(null, false);
    },
  })
);
app.use(express.json());

// 3) API Routes
app.use("/api/ai", aiRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/users/:username/wishlist", wishlistRoutes);
app.use("/api/user-profiles", userProfileRoutes);
app.use("/api/tracked-properties", trackedPropertyRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/pois", poiRoutes);
app.use("/api/routing", routingRoutes);
app.use("/api/accessibility", accessibilityRoutes);
app.use("/api/contact", contactRoutes);

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

// 7) Start Server - only when this file is run directly (`node server.js`),
// never when it's require()'d as a module. server/netlify/functions/api.js
// requires this file to get `app` for serverless-http, which only needs the
// Express app itself, not a listening TCP server - without this guard,
// importing the app in that serverless context would also bind a port for
// no purpose every cold start.
const PORT = process.env.PORT || 5001;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { app };
