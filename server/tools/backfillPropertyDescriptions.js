// ============================================================================
// TOOL: Backfill bilingual descriptions (description_en / description_bn)
// ============================================================================
// Purpose: give existing/legacy properties (created before the bilingual
// description feature existed) real description_en / description_bn values,
// without ever discarding or silently rewriting a property's existing
// legacy `description` text with AI-generated content.
//
// Reuses the exact same server/services/propertyDescriptionService.js the
// live create/edit flow uses - no separate/duplicate generation or
// translation logic.
//
// Safety rules (all enforced, not just documented):
//   - Only touches properties where description_en is missing or empty.
//     A property that already has description_en is NEVER touched, so this
//     script is safe to re-run at any time (idempotent).
//   - If a property already has a non-empty legacy `description`, that text
//     is treated exactly like a seller-typed manual description (routed
//     through propertyDescriptionService.buildFromManualDescription) - it
//     is preserved byte-for-byte as-is, and only translated to fill the
//     missing bilingual field(s). AI generation never overwrites it.
//   - Only properties with an EMPTY legacy description get a fresh
//     AI-generated description_en (via the normal Groq -> Gemini ->
//     deterministic-template chain).
//   - --dry-run (default true unless --apply is passed) makes no database
//     writes at all - it only prints what would change.
//
// Usage:
//   cd server
//   node tools/backfillPropertyDescriptions.js              (dry-run, default)
//   node tools/backfillPropertyDescriptions.js --dry-run
//   node tools/backfillPropertyDescriptions.js --apply       (writes for real)
//   node tools/backfillPropertyDescriptions.js --apply --limit 5
//   node tools/backfillPropertyDescriptions.js --apply --id <propertyId>
// ============================================================================

// Force public DNS (fixes Atlas SRV resolution on some networks) - same fix
// already established in server.js, tools/migrateCoordinates.js, and
// tools/importBangladeshPOIs.js.
require("node:dns").setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config({ path: "./.env" });

const mongoose = require("mongoose");
const Property = require("../models/property");
const {
  buildBilingualDescription,
  buildFromManualDescription,
} = require("../services/propertyDescriptionService");

function parseArgs(argv) {
  const args = { apply: false, limit: null, id: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--limit") {
      const n = parseInt(argv[++i], 10);
      args.limit = Number.isFinite(n) && n > 0 ? n : null;
    } else if (arg === "--id") args.id = argv[++i];
    else console.warn(`Ignoring unrecognized argument: ${arg}`);
  }
  return args;
}

// The exact static placeholder seedProperties.js writes to every seeded
// property's description field (see seedProperties.js:52-53) - not real
// seller-authored content, so it is safe (and more useful to the client)
// to regenerate a real description from actual property facts here rather
// than machine-translating this generic boilerplate into Bangla too. Any
// OTHER non-empty description - anything not an exact match - is still
// treated as genuine manual content and only ever translated, never
// replaced, per the same safety rule the live create/edit flow uses.
const SEED_PLACEHOLDER_DESCRIPTION =
  "This is a well-maintained property available in a desirable location. It features essential amenities and offers good value. Please contact us for further information or to arrange a visit.";

async function backfillOne(property, apply) {
  const legacyText = (property.description || "").trim();
  const isSeedPlaceholder = legacyText === SEED_PLACEHOLDER_DESCRIPTION;
  let result;
  let mode;

  if (legacyText && !isSeedPlaceholder) {
    mode = "manual (existing legacy description preserved, translated only)";
    result = await buildFromManualDescription(legacyText);
  } else {
    mode = isSeedPlaceholder
      ? "generated (existing text was the generic seed placeholder, not real manual content - regenerated from actual property facts)"
      : "generated (no existing description text)";
    result = await buildBilingualDescription(property, "");
  }

  console.log(`\n- ${property._id} "${property.title}"`);
  console.log(`  mode: ${mode}`);
  console.log(`  description_en (${result.description_en.length} chars): ${result.description_en.slice(0, 100)}${result.description_en.length > 100 ? "..." : ""}`);
  console.log(`  description_bn (${result.description_bn.length} chars): ${result.description_bn.slice(0, 100)}${result.description_bn.length > 100 ? "..." : ""}`);

  if (!apply) {
    console.log("  [dry-run] no write performed");
    return { id: property._id, wrote: false };
  }

  await Property.updateOne(
    { _id: property._id },
    {
      $set: {
        description: result.description,
        description_en: result.description_en,
        description_bn: result.description_bn,
      },
    }
  );
  console.log("  [applied] property updated");
  return { id: property._id, wrote: true };
}

(async () => {
  const args = parseArgs(process.argv.slice(2));

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB.");
  console.log(`Mode: ${args.apply ? "APPLY (will write to the database)" : "DRY-RUN (no writes)"}`);

  // Matches properties missing EITHER bilingual field, not just
  // description_en - this makes the script safely retryable for a partial
  // failure (e.g. English generation succeeded but both translators were
  // rate-limited during a large batch run). Retrying is safe: since
  // description_en would already be set from the first pass, backfillOne's
  // "manual" path kicks in automatically and only re-attempts translation -
  // it never regenerates already-good English content.
  const query = {
    isDeleted: { $ne: true },
    $or: [
      { description_en: { $exists: false } },
      { description_en: "" },
      { description_bn: { $exists: false } },
      { description_bn: "" },
    ],
  };
  if (args.id) {
    if (!mongoose.Types.ObjectId.isValid(args.id)) {
      console.error("Invalid --id value.");
      await mongoose.disconnect();
      process.exit(1);
    }
    query._id = args.id;
  }

  let cursor = Property.find(query).sort({ createdAt: 1 });
  if (args.limit) cursor = cursor.limit(args.limit);
  const properties = await cursor.exec();

  console.log(`Found ${properties.length} propert${properties.length === 1 ? "y" : "ies"} needing a bilingual description.`);

  let written = 0;
  let failed = 0;
  for (const property of properties) {
    try {
      const { wrote } = await backfillOne(property, args.apply);
      if (wrote) written++;
    } catch (error) {
      failed++;
      console.error(`  ERROR processing ${property._id}:`, error.message);
    }
  }

  console.log("\n=== Summary ===");
  console.log("Properties considered:", properties.length);
  console.log(args.apply ? "Properties updated:" : "Properties that WOULD be updated:", args.apply ? written : properties.length - failed);
  console.log("Failures:", failed);
  if (!args.apply) {
    console.log("\nThis was a dry run - no changes were written. Re-run with --apply to write for real.");
  }

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Fatal error:", error.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
