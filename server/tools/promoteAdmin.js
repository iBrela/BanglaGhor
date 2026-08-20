// ============================================================================
// TOOL: Promote a user to admin (first-admin bootstrap)
// ============================================================================
// Purpose: Set isAdmin = true on an EXISTING UserProfile, identified by exact
//          email match. This is the only supported way to create the very
//          first admin account — there is no in-app signup/promotion path for
//          that by design (see server/middleware/isAdminMiddleware.js).
//
// This script does NOT:
//   - create or upsert any UserProfile
//   - touch Cognito, auth routes, or any middleware
//   - change any field other than isAdmin
//   - expose any network/API surface (it's a standalone CLI script)
//
// Usage:
//   node tools/promoteAdmin.js <email>              # Dry run (default) — no changes made
//   node tools/promoteAdmin.js <email> --confirm    # Actually promote the user
// ============================================================================

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const UserProfile = require("../models/UserProfile");

const CONFIG = {
  CONFIRM: process.argv.includes("--confirm"),
};

async function main() {
  const emailArg = process.argv[2];

  if (!emailArg || emailArg.startsWith("--")) {
    console.error("Usage: node tools/promoteAdmin.js <email> [--confirm]");
    console.error("  (no --confirm)  => dry run, shows what would happen, changes nothing");
    console.error("  (with --confirm) => actually promotes the user to admin");
    process.exitCode = 1;
    return;
  }

  const email = emailArg.trim().toLowerCase();

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ No MONGO_URI found in ENV. Check server/.env.");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(uri);

  try {
    console.log(`🔍 Looking up user: ${email}`);
    const userProfile = await UserProfile.findOne({ email });

    if (!userProfile) {
      console.error(`❌ FAILED: No UserProfile found for "${email}".`);
      console.error(
        "   This user must sign up and log in at least once before they can be promoted."
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `✅ Found UserProfile (id: ${userProfile._id}, current isAdmin: ${userProfile.isAdmin})`
    );

    if (userProfile.isAdmin) {
      console.log(`ℹ️  ${email} is already an admin. No changes made.`);
      return;
    }

    if (!CONFIG.CONFIRM) {
      console.log(
        `⚠️  DRY RUN: would set isAdmin to true for ${email}. No changes made.`
      );
      console.log("   Re-run with --confirm to actually promote this user.");
      return;
    }

    console.log("🔐 Promoting to admin...");
    userProfile.isAdmin = true;
    await userProfile.save();

    console.log(`✅ SUCCESS: ${email} is now an admin (isAdmin: true).`);
    console.log("   They must log out and log back in for the change to take effect.");
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log("🔌 MongoDB connection closed.");
  }
}

main();
