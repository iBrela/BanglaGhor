// ============================================================================
// S3 PROVIDER MANAGER
// ============================================================================
// Single source of truth for "which S3 backend is active" - real AWS S3, or
// Floci (a local, S3-API-compatible emulator used for local development).
// Controllers never construct an S3Client or decide a provider themselves;
// they call getGovtIdS3Client()/getPropertyImagesS3Client() here, which
// return whichever provider this process locked in.
//
// Modes (S3_MODE env var):
//   "aws"    - always AWS, never checked/tried against Floci.
//   "floci"  - always Floci, AWS is never checked or used.
//   "auto"   - (default) AWS preferred. At first use, checks AWS config +
//              does a lightweight live availability check; if that passes,
//              AWS is selected, otherwise Floci is selected.
//
// Whatever provider is selected (in any mode) is LOCKED for the lifetime of
// this process - selection happens at most once (memoized), and a later
// operational failure (timeout, permission error, bad bucket, outage, etc.)
// never causes a runtime switch to the other provider. The only way to
// reconsider is a process restart (a fresh `require` of this module).
// ============================================================================

const {
  S3Client,
  HeadBucketCommand,
} = require("@aws-sdk/client-s3");

const VALID_MODES = ["aws", "floci", "auto"];
const rawMode = (process.env.S3_MODE || "auto").trim().toLowerCase();
const S3_MODE = VALID_MODES.includes(rawMode) ? rawMode : "auto";
if (process.env.S3_MODE && !VALID_MODES.includes(rawMode)) {
  console.warn(
    `[S3] Unrecognized S3_MODE "${process.env.S3_MODE}" - defaulting to "auto".`
  );
}

// How long the startup AWS availability check waits per bucket before
// treating AWS as unavailable. Kept short: this only ever runs once, but it
// must not hang server startup if AWS is unreachable.
const AWS_HEALTH_CHECK_TIMEOUT_MS = 3000;

// ============================================================================
// Client construction (unchanged real-AWS shape/credentials/env vars)
// ============================================================================
function buildAwsClient(accessKeyId, secretAccessKey) {
  return new S3Client({
    region: process.env.APP_AWS_REGION,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function buildFlociClient() {
  // Floci is a local S3-API-compatible emulator (Floci never receives real
  // AWS credentials - dummy values only, same convention LocalStack used).
  return new S3Client({
    region: process.env.APP_AWS_REGION || "us-east-1",
    endpoint: process.env.FLOCI_ENDPOINT || "http://localhost:4566",
    forcePathStyle: true,
    credentials: { accessKeyId: "floci", secretAccessKey: "floci" },
  });
}

const awsGovtIdClient = buildAwsClient(
  process.env.APP_AWS_ACCESS_KEY_ID,
  process.env.APP_AWS_SECRET_ACCESS_KEY
);
const awsPropertyImagesClient = buildAwsClient(
  process.env.PROPERTY_IMAGES_ACCESS_KEY,
  process.env.PROPERTY_IMAGES_SECRET_KEY
);
const flociGovtIdClient = buildFlociClient();
const flociPropertyImagesClient = buildFlociClient();

const GOVT_ID_BUCKET = process.env.S3_BUCKET_NAME;
const PROPERTY_IMAGES_BUCKET = process.env.APP_S3_BUCKET_PROPERTY_IMAGES;

// ============================================================================
// Provider selection (memoized - runs at most once per process)
// ============================================================================
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function hasCompleteAwsConfig() {
  return Boolean(
    process.env.APP_AWS_REGION &&
      process.env.APP_AWS_ACCESS_KEY_ID &&
      process.env.APP_AWS_SECRET_ACCESS_KEY &&
      process.env.PROPERTY_IMAGES_ACCESS_KEY &&
      process.env.PROPERTY_IMAGES_SECRET_KEY &&
      GOVT_ID_BUCKET &&
      PROPERTY_IMAGES_BUCKET
  );
}

// Lightweight availability check: HeadBucket against both real buckets
// (each credential pair is scoped to a different bucket, so both must be
// reachable for AWS to be considered healthy). Any auth/network/timeout
// failure on either bucket is treated as "AWS unavailable" for startup
// selection purposes only - this check never runs again after startup.
async function checkAwsAvailable() {
  if (!hasCompleteAwsConfig()) {
    console.log(
      "[S3] AWS not configured/unavailable at startup - using Floci S3"
    );
    return false;
  }

  try {
    await Promise.all([
      withTimeout(
        awsGovtIdClient.send(new HeadBucketCommand({ Bucket: GOVT_ID_BUCKET })),
        AWS_HEALTH_CHECK_TIMEOUT_MS
      ),
      withTimeout(
        awsPropertyImagesClient.send(
          new HeadBucketCommand({ Bucket: PROPERTY_IMAGES_BUCKET })
        ),
        AWS_HEALTH_CHECK_TIMEOUT_MS
      ),
    ]);
    console.log("[S3] AWS available — using AWS S3");
    return true;
  } catch (error) {
    // error.name/message only - never log credentials or full error objects.
    console.log(
      `[S3] AWS not configured/unavailable at startup — using Floci S3 (${error.name || "Error"}: ${error.message})`
    );
    return false;
  }
}

let readyPromise = null;

function ensureS3ProviderReady() {
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    if (S3_MODE === "aws") {
      console.log("[S3] Mode: aws — using AWS S3");
      return "aws";
    }
    if (S3_MODE === "floci") {
      console.log("[S3] Mode: floci — using Floci S3");
      return "floci";
    }
    // auto
    console.log("[S3] Mode: auto");
    const awsHealthy = await checkAwsAvailable();
    return awsHealthy ? "aws" : "floci";
  })();

  return readyPromise;
}

// Fire off the check as soon as this module is first required (mirrors the
// existing connectToDatabase() fire-and-forget startup pattern in
// server.js), so the provider is normally already locked before the first
// request arrives. Every S3-touching controller function still awaits
// ensureS3ProviderReady() itself before using a client, so a request that
// races the very first startup check correctly waits on this same promise
// instead of triggering a second check or using an undecided provider.
ensureS3ProviderReady().catch((error) => {
  console.error("[S3] Unexpected error during provider selection:", error.message);
});

// ============================================================================
// Client accessors - call ONLY after ensureS3ProviderReady() has resolved.
// ============================================================================
function getActiveProviderSync() {
  // Only meaningful after ensureS3ProviderReady() has resolved; controllers
  // always await that first, so by the time these run the promise is settled.
  return readyPromise;
}

async function getGovtIdS3Client() {
  const provider = await ensureS3ProviderReady();
  return provider === "aws" ? awsGovtIdClient : flociGovtIdClient;
}

async function getPropertyImagesS3Client() {
  const provider = await ensureS3ProviderReady();
  return provider === "aws" ? awsPropertyImagesClient : flociPropertyImagesClient;
}

// ============================================================================
// Helper: Build S3 object URL for the active provider
// ============================================================================
async function buildS3ObjectUrl(bucket, key) {
  const provider = await ensureS3ProviderReady();
  if (provider === "floci") {
    const endpoint = process.env.FLOCI_ENDPOINT || "http://localhost:4566";
    return `${endpoint}/${bucket}/${key}`;
  }
  return `https://${bucket}.s3.${process.env.APP_AWS_REGION}.amazonaws.com/${key}`;
}

// ============================================================================
// Helper: Extract S3 key from a stored URL - handles both real AWS
// (virtual-hosted-style) and Floci (path-style, at the configured
// FLOCI_ENDPOINT) URL shapes, regardless of which provider is currently
// active. This matters because a URL stored in MongoDB may have been
// produced by whichever provider was active at upload time, which is not
// necessarily the provider active "now" (the provider only changes on a
// server restart, but the data can outlive that).
// ============================================================================
function extractS3KeyFromUrl(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.endsWith("amazonaws.com")) {
      return decodeURIComponent(urlObj.pathname.substring(1));
    }
    let flociHost = null;
    try {
      flociHost = new URL(process.env.FLOCI_ENDPOINT || "http://localhost:4566").host;
    } catch {
      flociHost = null;
    }
    if (flociHost && urlObj.host === flociHost) {
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      pathParts.shift(); // remove bucket name (first path segment)
      return decodeURIComponent(pathParts.join("/"));
    }
    return null;
  } catch (e) {
    // Not a parseable absolute URL (e.g. legacy/seed data like "house1.png").
    return null;
  }
}

module.exports = {
  S3_MODE,
  GOVT_ID_BUCKET,
  PROPERTY_IMAGES_BUCKET,
  ensureS3ProviderReady,
  getActiveProviderSync,
  getGovtIdS3Client,
  getPropertyImagesS3Client,
  buildS3ObjectUrl,
  extractS3KeyFromUrl,
};
