// ============================================================================
// TOOL: Import Bangladesh Points of Interest (POIs) from OpenStreetMap
// ============================================================================
// Purpose: populate the PointOfInterest collection nationwide from a real
// OSM extract, so "properties near a hospital/school/park/etc." queries
// (server/services/poiService.js) have real data to search.
//
// This tool does NOT parse the .osm.pbf itself. It reads GeoJSON produced by
// osmium-tool (see the extraction commands below) - the M3 audit found that
// a naive direct-PBF parse would lose a significant fraction of real POIs
// for way/relation-heavy categories (park: 70% ways, college: 39%,
// place_of_worship: 31%) unless it correctly resolves way/relation geometry,
// which is exactly what osmium already does well. One reliable path, not
// two different-quality ones.
//
// ── STEP 1 & 2: run the two osmium extraction commands (filter, then
//    export). There is no official osmium-tool Docker image (verified - the
//    osmcode/osmium-tool project only documents building from source); see
//    server/tools/README-poi-import.md for the exact, copy-pasteable
//    commands, the specific third-party image used, and why - including how
//    to substitute a different image if needed. Uses Docker, the same
//    dependency already required for M1's Planetiler build.
//
// ── STEP 3: run this tool:
//
//   cd server
//   node tools/importBangladeshPOIs.js --geojson ../map-build/data/bangladesh-pois.geojson --dry-run
//   node tools/importBangladeshPOIs.js --geojson ../map-build/data/bangladesh-pois.geojson
//
// Reads MONGO_URI from server/.env - works unchanged against ANY MongoDB
// instance (this development database, or a client's own Atlas cluster
// later). No hardcoded database, no personal absolute paths - --geojson is
// the only path input, always CLI-supplied.
//
// CLI options:
//   --geojson <path>      (required) path to the GeoJSON produced above
//   --dry-run              parse + normalize only, no DB connection, no writes
//   --refresh               after a fully successful import, delete stale
//                            source=openstreetmap documents this run didn't
//                            touch (see the refresh-safety design below) -
//                            a normal (non---refresh) run NEVER deletes
//   --categories a,b,c      import only these categories (see CATEGORIES
//                            below for the full list)
//   --batch-size <n>        MongoDB bulkWrite batch size (default 500) -
//                            local write batching only, not an external
//                            rate limit (there is no external API call in
//                            this tool)
// ============================================================================

// Force public DNS (fixes Atlas SRV resolution on some networks) - same
// fix already established in server.js and tools/migrateCoordinates.js.
require("node:dns").setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config({ path: "./.env" });

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");
const PointOfInterest = require("../models/PointOfInterest");
const { isWithinBangladesh } = require("../../src/shared/bangladeshGeo");

// ============================================================================
// CLI ARGS
// ============================================================================
function parseArgs(argv) {
  const args = {
    geojson: null,
    dryRun: false,
    refresh: false,
    categories: null,
    batchSize: 500,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--geojson") args.geojson = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--refresh") args.refresh = true;
    else if (arg === "--categories") {
      args.categories = (argv[++i] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === "--batch-size") {
      const n = parseInt(argv[++i], 10);
      args.batchSize = Number.isFinite(n) && n > 0 ? n : args.batchSize;
    } else {
      console.warn(`Ignoring unrecognized argument: ${arg}`);
    }
  }
  return args;
}

// ============================================================================
// CATEGORY RULES
// ============================================================================
// Ordered so the FIRST matching rule wins - each imported OSM element
// resolves to exactly ONE category, never duplicated. Order is by
// specificity: dedicated healthcare-facility types are checked before
// generic commerce/civic categories, so an element that happens to carry
// tags matching more than one rule (a real, if rare, possibility in OSM
// data - e.g. a hospital also tagged healthcare=pharmacy for its in-house
// dispensary) resolves to the more specific, more useful category rather
// than being imported twice.
//
// Every OR-condition below was verified against the real Bangladesh extract
// during the M3 audit (see the audit report for measured counts) - not
// guessed.
const CATEGORY_RULES = [
  { category: "hospital", test: (t) => t.amenity === "hospital" || t.healthcare === "hospital" },
  { category: "clinic", test: (t) => t.amenity === "clinic" || t.healthcare === "clinic" },
  { category: "pharmacy", test: (t) => t.amenity === "pharmacy" || t.healthcare === "pharmacy" },
  { category: "university", test: (t) => t.amenity === "university" },
  { category: "college", test: (t) => t.amenity === "college" },
  { category: "school", test: (t) => t.amenity === "school" },
  { category: "place_of_worship", test: (t) => t.amenity === "place_of_worship" },
  {
    category: "marketplace",
    test: (t) => t.amenity === "marketplace" || t.shop === "marketplace" || t.shop === "supermarket",
  },
  { category: "bank", test: (t) => t.amenity === "bank" },
  { category: "atm", test: (t) => t.amenity === "atm" },
  { category: "police", test: (t) => t.amenity === "police" },
  { category: "fire_station", test: (t) => t.amenity === "fire_station" },
  { category: "bus_station", test: (t) => t.amenity === "bus_station" },
  { category: "railway_station", test: (t) => t.railway === "station" },
  { category: "ferry_terminal", test: (t) => t.amenity === "ferry_terminal" },
  { category: "park", test: (t) => t.leisure === "park" },
];

function resolveCategory(tags) {
  for (const rule of CATEGORY_RULES) {
    if (rule.test(tags)) return rule.category;
  }
  return null;
}

// ============================================================================
// GEOMETRY -> ONE REPRESENTATIVE POINT
// ============================================================================
// Point geometries are used directly. LineString/Polygon/MultiPolygon are
// reduced via BOUNDING-BOX CENTER: the midpoint of the min/max longitude and
// min/max latitude across every coordinate in the (possibly nested)
// geometry. Chosen over a vertex-average or true area-weighted polygon
// centroid because it's simple, deterministic, and not skewed by uneven
// vertex density - a real characteristic of OSM ways, which often have far
// more vertices along one edge than another. This is a reasonable
// representative point for "is this property near X" proximity search - not
// a claim of geometric/visual precision for irregularly-shaped features.
function extractRepresentativePoint(geometry) {
  if (!geometry || !geometry.coordinates) return null;

  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates;
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }

  const flatCoords = [];
  (function collect(node) {
    if (typeof node[0] === "number") {
      flatCoords.push(node);
    } else if (Array.isArray(node)) {
      node.forEach(collect);
    }
  })(geometry.coordinates);

  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const pair of flatCoords) {
    const [lng, lat] = pair;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(maxLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
    return null;
  }
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

// ============================================================================
// OSM FEATURE ID PARSING
// ============================================================================
// osmium export's Feature.id (present only when exported with -u type_id -
// see STEP 2 above) is a type letter followed by the numeric OSM id, e.g.
// "n265945386" for plain nodes/ways/relations - verified directly against
// real osmium output during the M3 audit (default export, without -u, has
// NO Feature.id at all).
//
// A FOURTH letter, "a" (area), was discovered during the real Bangladesh
// import run: any closed way or multipolygon relation that osmium resolves
// into polygon/MultiPolygon geometry is exported as a synthetic "area"
// object, not a plain way/relation. Its id is libosmium's own doubled
// encoding to avoid collisions between way-derived and relation-derived
// areas: area_id = way_id*2 (even) or relation_id*2+1 (odd). Verified
// against the real data, not assumed: every "a"-prefixed feature in this
// dataset was MultiPolygon geometry, and the even/odd split (11,858 even /
// 146 odd) is consistent with a real way/relation split (146 matches the
// relation counts measured in the original M3 audit closely). Decoding this
// back to the true way/relation id and type means osmId/osmType always
// point at a real, look-up-able OSM element - not an osmium-internal one.
const OSM_TYPE_BY_LETTER = { n: "node", w: "way", r: "relation" };

function parseFeatureId(id) {
  if (typeof id !== "string") return null;
  const match = /^([nwra])(\d+)$/.exec(id);
  if (!match) return null;
  const [, letter, numStr] = match;
  const num = Number(numStr);

  if (letter === "a") {
    return num % 2 === 0
      ? { osmType: "way", osmId: num / 2, isResolvedArea: true }
      : { osmType: "relation", osmId: (num - 1) / 2, isResolvedArea: true };
  }

  return { osmType: OSM_TYPE_BY_LETTER[letter], osmId: num, isResolvedArea: false };
}

// ============================================================================
// NORMALIZE ONE FEATURE
// ============================================================================
// Discovered against the real Bangladesh extract: osmium's export can emit
// the SAME real-world way/relation TWICE - once as a plain w<id>/r<id>
// feature (often incomplete geometry, e.g. an unclosed LineString) and once
// as the resolved a<id> area feature (complete Polygon/MultiPolygon). Both
// decode to the same {osmType, osmId} via parseFeatureId above. The caller
// (main, below) deduplicates by that key and prefers the isResolvedArea
// entry when both exist, since it has the more complete/correct geometry -
// see the dedup loop for how this is applied.
function normalizeFeature(feature) {
  const tags = (feature && feature.properties) || {};

  const category = resolveCategory(tags);
  if (!category) return { skipped: "noCategoryMatch" };

  const idInfo = parseFeatureId(feature.id);
  if (!idInfo) return { skipped: "noOsmId" };

  const point = extractRepresentativePoint(feature.geometry);
  if (!point) return { skipped: "noUsableGeometry" };

  const [lng, lat] = point;
  if (!isWithinBangladesh(lat, lng)) return { skipped: "outsideBangladesh" };

  const doc = {
    osmId: idInfo.osmId,
    osmType: idInfo.osmType,
    category,
    geoLocation: { type: "Point", coordinates: [lng, lat] },
    source: "openstreetmap",
    importedAt: new Date(),
  };
  if (tags.name) doc.name = tags.name;
  if (tags["name:bn"]) doc.nameBn = tags["name:bn"];
  if (tags["name:en"]) doc.nameEn = tags["name:en"];
  if (tags["addr:city"] || tags["addr:district"]) {
    doc.address = {};
    if (tags["addr:city"]) doc.address.city = tags["addr:city"];
    if (tags["addr:district"]) doc.address.district = tags["addr:district"];
  }
  // NOTE: osmium's default GeoJSON export does not include the OSM
  // element's own edit timestamp in `properties` - sourceUpdatedAt is left
  // unset here rather than guessed. See the M3 implementation report for
  // this known limitation.

  return { doc, isResolvedArea: idInfo.isResolvedArea };
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("\n============================================================");
  console.log(" BanglaGhor — Bangladesh POI Import");
  console.log("============================================================");
  console.log(`Mode:        ${args.dryRun ? "DRY RUN (no DB connection, no writes)" : "LIVE"}`);
  console.log(`Refresh:     ${args.refresh ? "yes (stale docs swept after a fully successful import)" : "no (incremental upsert only, never deletes)"}`);
  console.log(`Categories:  ${args.categories ? args.categories.join(", ") : "all"}`);
  console.log(`Batch size:  ${args.batchSize}`);
  console.log("------------------------------------------------------------\n");

  if (!args.geojson) {
    console.error("Missing required --geojson <path>. See this file's header comment for the extraction commands that produce it.");
    process.exit(1);
  }
  const geojsonPath = path.resolve(args.geojson);
  if (!fs.existsSync(geojsonPath)) {
    console.error(`GeoJSON file not found: ${geojsonPath}`);
    process.exit(1);
  }

  if (args.categories) {
    const invalid = args.categories.filter((c) => !PointOfInterest.CATEGORIES.includes(c));
    if (invalid.length > 0) {
      console.error(`Unknown categor${invalid.length > 1 ? "ies" : "y"}: ${invalid.join(", ")}`);
      console.error(`Valid categories: ${PointOfInterest.CATEGORIES.join(", ")}`);
      process.exit(1);
    }
  }

  if (!args.dryRun && !process.env.MONGO_URI) {
    console.error("MONGO_URI not set. Add it to server/.env.");
    process.exit(1);
  }

  console.log(`Reading ${geojsonPath} ...`);
  // A single readFileSync + JSON.parse, not a streaming JSON parser: the
  // real GeoJSON this pipeline produces is on the order of low tens of MB
  // (measured during the M3 audit: ~46k source features before this tool's
  // own per-category filtering) - well within what JSON.parse handles
  // directly and quickly. A true streaming parser would only be justified
  // at a materially larger scale than this dataset actually is.
  const raw = fs.readFileSync(geojsonPath, "utf8");
  const geojson = JSON.parse(raw);
  const features = Array.isArray(geojson.features) ? geojson.features : [];
  console.log(`Loaded ${features.length} raw features.\n`);

  const runId = crypto.randomUUID();
  const skipCounts = { noCategoryMatch: 0, noOsmId: 0, noUsableGeometry: 0, outsideBangladesh: 0 };

  // Deduplicate by the true (osmType, osmId) identity, not just push every
  // normalized feature into an array. Required because osmium can emit the
  // same real element twice - see normalizeFeature's comment above. When
  // both a plain and an area-resolved version of the same element exist,
  // the area-resolved one (complete Polygon/MultiPolygon geometry) wins.
  let duplicateFeaturesCollapsed = 0;
  const byKey = new Map();

  for (const feature of features) {
    const result = normalizeFeature(feature);
    if (result.skipped) {
      skipCounts[result.skipped]++;
      continue;
    }
    if (args.categories && !args.categories.includes(result.doc.category)) continue;

    const key = `${result.doc.osmType}:${result.doc.osmId}`;
    const existing = byKey.get(key);
    if (existing) {
      duplicateFeaturesCollapsed++;
      if (result.isResolvedArea && !existing.isResolvedArea) {
        byKey.set(key, result); // prefer the more complete area geometry
      }
      continue;
    }
    byKey.set(key, result);
  }

  const docsToWrite = [];
  const byCategory = {};
  for (const result of byKey.values()) {
    result.doc.importRunId = runId;
    docsToWrite.push(result.doc);
    byCategory[result.doc.category] = (byCategory[result.doc.category] || 0) + 1;
  }

  console.log("Normalization results:");
  console.log(`  Matched a category, distinct elements: ${docsToWrite.length}`);
  console.log(`  Duplicate feature emissions collapsed: ${duplicateFeaturesCollapsed} (same OSM element exported twice by osmium - see header comment)`);
  console.log(`  Skipped - no category match:           ${skipCounts.noCategoryMatch}`);
  console.log(`  Skipped - unparsable OSM id:            ${skipCounts.noOsmId}`);
  console.log(`  Skipped - no usable geometry:            ${skipCounts.noUsableGeometry}`);
  console.log(`  Skipped - outside Bangladesh bounds:     ${skipCounts.outsideBangladesh}`);
  console.log("\nBy category:");
  for (const cat of PointOfInterest.CATEGORIES) {
    if (byCategory[cat]) console.log(`  ${cat.padEnd(18)} ${byCategory[cat]}`);
  }
  console.log("");

  if (args.dryRun) {
    console.log("DRY RUN complete: no database connection was made, no writes were performed.\n");
    return;
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected.\n");

  const stats = { upserted: 0, modified: 0, matched: 0, staleDeleted: null };

  try {
    console.log(`Writing ${docsToWrite.length} documents in batches of ${args.batchSize}...`);
    for (let i = 0; i < docsToWrite.length; i += args.batchSize) {
      const batch = docsToWrite.slice(i, i + args.batchSize);
      const ops = batch.map((doc) => ({
        updateOne: {
          filter: { osmId: doc.osmId, osmType: doc.osmType },
          update: { $set: doc },
          upsert: true,
        },
      }));
      const result = await PointOfInterest.bulkWrite(ops, { ordered: false });
      stats.upserted += result.upsertedCount || 0;
      stats.modified += result.modifiedCount || 0;
      stats.matched += result.matchedCount || 0;
      console.log(
        `  Batch ${Math.floor(i / args.batchSize) + 1}/${Math.ceil(docsToWrite.length / args.batchSize)}: ` +
          `${batch.length} docs (running totals - upserted: ${stats.upserted}, modified: ${stats.modified})`
      );
    }

    console.log("\nAll batches written successfully.");

    // ── Refresh safety ──────────────────────────────────────────────────
    // Only reached if every batch above completed without throwing. A
    // normal (non---refresh) run NEVER deletes anything - it only reaches
    // this branch check, sees args.refresh is false, and skips deletion
    // entirely. If any batch above throws, this code is never reached at
    // all (the catch block below runs instead) - a failed/interrupted
    // import cannot trigger stale deletion.
    if (args.refresh) {
      console.log(`\nRefresh mode: sweeping stale documents not touched by run ${runId}...`);
      const deleteFilter = { source: "openstreetmap", importRunId: { $ne: runId } };
      if (args.categories) deleteFilter.category = { $in: args.categories };
      const deleteResult = await PointOfInterest.deleteMany(deleteFilter);
      stats.staleDeleted = deleteResult.deletedCount;
      console.log(`  Removed ${deleteResult.deletedCount} stale document(s).`);
    } else {
      console.log("\n(Non-refresh run: nothing was deleted, only added/updated.)");
    }

    const finalCount = await PointOfInterest.countDocuments();

    console.log("\n============================================================");
    console.log(" SUMMARY");
    console.log("============================================================");
    console.log(`Upserted (new documents):        ${stats.upserted}`);
    console.log(`Modified (changed existing):      ${stats.modified}`);
    console.log(`Matched (found, changed or not):  ${stats.matched}`);
    if (args.refresh) console.log(`Stale documents deleted:          ${stats.staleDeleted}`);
    console.log(`Final collection count:           ${finalCount}`);
    console.log("------------------------------------------------------------");
    for (const cat of PointOfInterest.CATEGORIES) {
      const count = await PointOfInterest.countDocuments({ category: cat });
      if (count > 0) console.log(`  ${cat.padEnd(18)} ${count}`);
    }
    console.log("");
  } catch (err) {
    console.error("\nIMPORT FAILED:", err.message);
    console.error("No stale-deletion sweep was performed - it only runs after a fully successful import.");
    throw err;
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed.");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("\nFATAL:", err);
    process.exit(1);
  });
}

module.exports = { resolveCategory, extractRepresentativePoint, parseFeatureId, normalizeFeature };
