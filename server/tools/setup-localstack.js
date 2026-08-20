// ============================================================================
// LocalStack S3 Setup Script
// ============================================================================
// Creates BOTH S3 buckets (govt IDs + property images) in LocalStack with
// proper CORS configuration. Run ONCE after starting LocalStack container.
//
// Usage:  cd server && node tools/setup-localstack.js
// ============================================================================

const {
  S3Client,
  CreateBucketCommand,
  PutBucketCorsCommand,
  HeadBucketCommand,
} = require("@aws-sdk/client-s3");

// ─── Both bucket names from production ────────────────────────────────────
const BUCKETS = [
  "banglaghar-govt-id1011",
  "banglaghar-property-images-bucket1",
];

const LOCALSTACK_ENDPOINT = "http://localhost:4566";
const REGION = "ap-south-1";

// LocalStack accepts any credentials (convention: "test"/"test")
const s3 = new S3Client({
  endpoint: LOCALSTACK_ENDPOINT,
  region: REGION,
  credentials: {
    accessKeyId: "test",
    secretAccessKey: "test",
  },
  forcePathStyle: true,
});

async function bucketExists(name) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: name }));
    return true;
  } catch {
    return false;
  }
}

async function createBucket(name) {
  console.log(`  Creating bucket: ${name}`);
  await s3.send(
    new CreateBucketCommand({
      Bucket: name,
      // For non-us-east-1 regions, location constraint is required
      CreateBucketConfiguration: { LocationConstraint: REGION },
    })
  );
  console.log(`  ✅ Bucket created: ${name}`);
}

async function setupCors(name) {
  console.log(`  Setting up CORS: ${name}`);
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: name,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
            AllowedOrigins: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    })
  );
  console.log(`  ✅ CORS configured: ${name}`);
}

async function setupSingleBucket(name) {
  console.log(`\n📦 Processing: ${name}`);
  const exists = await bucketExists(name);
  if (exists) {
    console.log(`  ℹ️  Bucket already exists`);
  } else {
    await createBucket(name);
  }
  await setupCors(name);
}

async function main() {
  console.log("🚀 LocalStack S3 Setup");
  console.log(`   Endpoint: ${LOCALSTACK_ENDPOINT}`);
  console.log(`   Region:   ${REGION}`);
  console.log(`   Buckets:  ${BUCKETS.length}`);

  for (const bucket of BUCKETS) {
    await setupSingleBucket(bucket);
  }

  console.log("\n✅ All buckets ready!");
  console.log("\nAccess URLs (browser-friendly):");
  for (const bucket of BUCKETS) {
    console.log(`  http://localhost:4566/${bucket}/<filename>`);
  }
}

main().catch((err) => {
  console.error("\n❌ Setup failed:", err.message);
  process.exit(1);
});