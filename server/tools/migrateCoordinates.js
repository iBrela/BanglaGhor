// ============================================================================
// MIGRATION SCRIPT: Add Geo-coordinates to Existing Properties
// ============================================================================
// Purpose: Use OpenStreetMap Nominatim (FREE) to geocode every property
//          that doesn't have valid coordinates yet, and populate:
//             - latitude
//             - longitude
//             - position { lat, lng }
//             - geoLocation { type: "Point", coordinates: [lng, lat] }
//             - locationAccuracy (precise/approximate/district-level)
//             - geocodedAddress (the resolved address from Nominatim)
//
// Usage:
//   node tools/migrateCoordinates.js              # Live run
//   node tools/migrateCoordinates.js --dry-run    # Preview only
//   node tools/migrateCoordinates.js --force      # Re-geocode all
// ============================================================================

// Force public DNS (fixes Atlas SRV resolution on some networks)
require("node:dns").setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config({ path: "./.env" });

const mongoose = require("mongoose");
const Property = require("../models/property");
const locationService = require("../services/locationService");

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  BATCH_SIZE: 25,
  BATCH_PAUSE_MS: 3000,
  DRY_RUN: process.argv.includes("--dry-run"),
  FORCE: process.argv.includes("--force"),
};

// ============================================================================
// HELPERS
// ============================================================================
function buildSearchAddress(property) {
  const components = [
    property.addressLine1,
    property.addressLine2,
    property.upazila,
    property.cityTown,
    property.district,
    property.postalCode,
  ].filter(Boolean);
  return components.join(", ");
}

function buildFallbackAddress(property) {
  const components = [
    property.cityTown,
    property.upazila,
    property.district,
  ].filter(Boolean);
  return components.join(", ");
}

function buildDistrictOnlyAddress(property) {
  return property.district || "";
}

function hasValidCoordinates(property) {
  return (
    typeof property.latitude === "number" &&
    typeof property.longitude === "number" &&
    !isNaN(property.latitude) &&
    !isNaN(property.longitude) &&
    property.geoLocation?.coordinates?.length === 2
  );
}

// ============================================================================
// CORE: Geocode a single property with smart fallback
// ============================================================================
async function geocodeProperty(property) {
  const attempts = [
    { address: buildSearchAddress(property), accuracy: "precise" },
    { address: buildFallbackAddress(property), accuracy: "approximate" },
    { address: buildDistrictOnlyAddress(property), accuracy: "district-level" },
  ].filter((a) => a.address && a.address.length > 0);

  for (const attempt of attempts) {
    try {
      const result = await locationService.geocode(attempt.address);
      if (result && result.coords) {
        return {
          success: true,
          coords: result.coords,
          accuracy: attempt.accuracy,
          resolvedAddress: result.name,
          source: result.source,
        };
      }
    } catch (error) {
      console.error(`    ↳ Attempt failed (${attempt.accuracy}):`, error.message);
    }
  }
  return { success: false };
}

// ============================================================================
// MAIN MIGRATION FUNCTION
// ============================================================================
async function migrate() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║       PROPERTY GEOCODING MIGRATION                       ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`Mode:      ${CONFIG.DRY_RUN ? "🔍 DRY RUN (no DB writes)" : "✏️  LIVE RUN"}`);
  console.log(`Force:     ${CONFIG.FORCE ? "Yes (re-geocode all)" : "No (skip already geocoded)"}`);
  console.log("─────────────────────────────────────────────────────────────\n");

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB\n");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }

  // Find properties needing geocoding
  const query = CONFIG.FORCE
    ? {}
    : {
        $or: [
          { "geoLocation.coordinates": { $exists: false } },
          { "geoLocation.coordinates": { $size: 0 } },
          { latitude: { $exists: false } },
          { longitude: { $exists: false } },
          { latitude: null },
          { longitude: null },
        ],
      };

  const properties = await Property.find(query);
  console.log(`📊 Found ${properties.length} properties to geocode\n`);

  if (properties.length === 0) {
    console.log("✨ Nothing to migrate. All properties already have coordinates.");
    await mongoose.connection.close();
    return;
  }

  const stats = {
    total: properties.length,
    successPrecise: 0,
    successApproximate: 0,
    successDistrict: 0,
    failed: 0,
    skipped: 0,
    failedList: [],
  };

  const startTime = Date.now();

  for (let i = 0; i < properties.length; i++) {
    const property = properties[i];
    const progress = `[${i + 1}/${properties.length}]`;
    const propertyDesc = `"${property.title}" (${property._id})`;
    console.log(`${progress} ${propertyDesc}`);

    if (!CONFIG.FORCE && hasValidCoordinates(property)) {
      console.log(`    ⏭️  Already geocoded, skipping`);
      stats.skipped++;
      continue;
    }

    const address = buildSearchAddress(property);
    console.log(`    📍 Address: ${address}`);

    const result = await geocodeProperty(property);

    if (!result.success) {
      console.log(`    ❌ Failed to geocode`);
      stats.failed++;
      stats.failedList.push({ id: property._id, title: property.title });
      continue;
    }

    const [lng, lat] = result.coords;
    console.log(
      `    ✅ ${result.accuracy.toUpperCase()} match: ${result.resolvedAddress} (${lat.toFixed(4)}, ${lng.toFixed(4)}) via ${result.source}`
    );

    if (result.accuracy === "precise") stats.successPrecise++;
    else if (result.accuracy === "approximate") stats.successApproximate++;
    else stats.successDistrict++;

    // ─── WRITE TO DB using raw driver (bypasses Mongoose middleware issues) ──
    if (!CONFIG.DRY_RUN) {
      try {
        await Property.collection.updateOne(
          { _id: property._id },
          {
            $set: {
              latitude: lat,
              longitude: lng,
              "position.lat": lat,
              "position.lng": lng,
              "geoLocation.type": "Point",
              "geoLocation.coordinates": [lng, lat],
              locationAccuracy: result.accuracy,
              geocodedAddress: result.resolvedAddress,
            },
          }
        );
        console.log(`    💾 Saved to DB`);
      } catch (dbErr) {
        console.error(`    ⚠️  DB update failed:`, dbErr.message);
        stats.failed++;
        stats.failedList.push({
          id: property._id,
          title: property.title,
          reason: "DB write failed",
        });
      }
    } else {
      console.log(`    🔍 (Dry run - not saved)`);
    }

    console.log("");

    if ((i + 1) % CONFIG.BATCH_SIZE === 0 && i + 1 < properties.length) {
      console.log(`⏸️  Batch pause (${CONFIG.BATCH_PAUSE_MS}ms)...\n`);
      await new Promise((resolve) => setTimeout(resolve, CONFIG.BATCH_PAUSE_MS));
    }
  }

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                    MIGRATION SUMMARY                     ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`Total properties:       ${stats.total}`);
  console.log(`✅ Precise matches:     ${stats.successPrecise}`);
  console.log(`🟡 Approximate matches: ${stats.successApproximate}`);
  console.log(`🟠 District-level only: ${stats.successDistrict}`);
  console.log(`⏭️  Skipped (existing): ${stats.skipped}`);
  console.log(`❌ Failed:              ${stats.failed}`);
  console.log(`⏱️  Total time:         ${totalTime}s`);
  console.log("─────────────────────────────────────────────────────────────");

  const successTotal =
    stats.successPrecise + stats.successApproximate + stats.successDistrict;
  const successRate = stats.total > 0
    ? ((successTotal / stats.total) * 100).toFixed(1)
    : 0;
  console.log(`🎯 Success rate:        ${successRate}%`);

  if (stats.failedList.length > 0) {
    console.log("\n❌ Failed properties:");
    stats.failedList.forEach((f) => {
      console.log(`   - ${f.title || "(no title)"} [${f.id}]${f.reason ? ` — ${f.reason}` : ""}`);
    });
  }

  if (CONFIG.DRY_RUN) {
    console.log("\n🔍 DRY RUN: No changes were saved.");
  }

  console.log();
  await mongoose.connection.close();
  console.log("✅ Database connection closed");
}

migrate().catch((err) => {
  console.error("\n💥 Migration crashed:", err);
  mongoose.connection.close();
  process.exit(1);
});