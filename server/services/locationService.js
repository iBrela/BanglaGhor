// ============================================================================
// LOCATION SERVICE — Pure Digital, Production Grade
// ============================================================================
// Purpose: Convert any place name in Bangladesh into GPS coordinates.
//
// NO HARDCODED DATA. Fully dynamic. Scales to millions of locations.
//
// Architecture (4-tier fallback):
//
//   1. In-Memory Cache (NodeCache)      → 0.001 sec (RAM)
//        ↓ miss
//   2. MongoDB Persistent Cache         → 10-50 ms  (survives restart)
//        ↓ miss
//   3. AI Translation (Groq, if Bangla) → 500 ms    (normalize query)
//        ↓
//   4. Nominatim API (primary)          → 1-3 sec   (free, unlimited)
//        ↓ fail
//   5. Photon API (backup)              → 1-2 sec   (free, faster)
//        ↓
//   → Save to BOTH caches → return result
//
// Features:
//   • Supports Bangla, English, Banglish (AI normalizes)
//   • Rate limiting (Nominatim policy: max 1 req/sec)
//   • Cache hit tracking (analytics)
//   • Multi-provider fallback (resilience)
//   • Persistent cache (smarter over time)
//   • Haversine distance calculation
// ============================================================================

const axios = require("axios");
const NodeCache = require("node-cache");
const Groq = require("groq-sdk");
const GeocodeCache = require("../models/GeocodeCache");

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  // In-memory cache TTL (seconds). 1 hour = enough for most sessions.
  MEMORY_CACHE_TTL: 3600,

  // How old (in days) a DB cache entry can be before we refresh from API
  DB_CACHE_REFRESH_DAYS: 90,

  // Minimum delay between Nominatim calls (their policy: 1 req/sec).
  // 1100 ms gives us safety buffer.
  NOMINATIM_RATE_LIMIT_MS: 1100,

  // API timeouts
  API_TIMEOUT_MS: 6000,

  // User agent (required by Nominatim policy)
  USER_AGENT: "BanglaGhor-RealEstate/1.0 (university-project)",

  // Bangladesh country code (filter results to Bangladesh only)
  COUNTRY_CODE: "bd",
};

// ============================================================================
// IN-MEMORY CACHE (fastest tier)
// ============================================================================
const memoryCache = new NodeCache({
  stdTTL: CONFIG.MEMORY_CACHE_TTL,
  checkperiod: 600,
  useClones: false,
});

// ============================================================================
// GROQ CLIENT (for AI-powered Bangla → English translation)
// ============================================================================
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ============================================================================
// RATE LIMITER (for Nominatim API)
// ============================================================================
let lastNominatimCallTime = 0;

async function enforceNominatimRateLimit() {
  const now = Date.now();
  const elapsed = now - lastNominatimCallTime;
  if (elapsed < CONFIG.NOMINATIM_RATE_LIMIT_MS) {
    const waitTime = CONFIG.NOMINATIM_RATE_LIMIT_MS - elapsed;
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
  lastNominatimCallTime = Date.now();
}

// ============================================================================
// HELPER: Normalize a query string for consistent cache keys
// ============================================================================
function normalizeQuery(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .trim()
    .replace(/[।.,!?]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(near\s+|kache\s+|er\s+pashe\s+)/i, "");
}

// ============================================================================
// HELPER: Detect if a string contains Bangla characters
// ============================================================================
function containsBangla(str) {
  return /[\u0980-\u09FF]/.test(str);
}

// ============================================================================
// AI TRANSLATION: Use Groq to translate Bangla place names to English
// ============================================================================
// This is much more reliable than a hardcoded transliteration map because
// it understands context, slang, and any variation a user might type.
// ============================================================================
async function translateBanglaToEnglish(banglaQuery) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are a transliteration assistant for Bangladesh place names. " +
            "Convert the given Bangla text to its standard English spelling " +
            "used in maps and addresses. Return ONLY the English name, no " +
            "explanation, no quotes, no extra text. Examples:\n" +
            "Input: ঢাকা বিশ্ববিদ্যালয় → Output: Dhaka University\n" +
            "Input: সিঙ্গাইর → Output: Singair\n" +
            "Input: কুমিল্লা ভিক্টোরিয়া কলেজ → Output: Cumilla Victoria College",
        },
        {
          role: "user",
          content: banglaQuery,
        },
      ],
      temperature: 0,
      max_tokens: 50,
    });

    const translated = completion.choices[0]?.message?.content?.trim();
    return translated || banglaQuery;
  } catch (error) {
    console.error("[LocationService] Bangla translation error:", error.message);
    return banglaQuery; // Fallback to original
  }
}

// ============================================================================
// CACHE LAYER 1: In-Memory Lookup
// ============================================================================
function getFromMemoryCache(queryKey) {
  const cached = memoryCache.get(queryKey);
  if (cached) {
    console.log(`[LocationService] Memory cache HIT: ${queryKey}`);
    return cached;
  }
  return null;
}

function saveToMemoryCache(queryKey, data) {
  memoryCache.set(queryKey, data);
}

// ============================================================================
// CACHE LAYER 2: MongoDB Persistent Lookup
// ============================================================================
async function getFromDBCache(queryKey) {
  try {
    const entry = await GeocodeCache.findOne({ queryKey });
    if (!entry) return null;

    // Check if entry is stale (older than refresh threshold)
    const ageInDays =
      (Date.now() - entry.updatedAt.getTime()) / (1000 * 60 * 60 * 24);

    if (ageInDays > CONFIG.DB_CACHE_REFRESH_DAYS) {
      console.log(
        `[LocationService] DB cache STALE for: ${queryKey} (will refresh)`
      );
      return null; // Force refresh from API
    }

    // Update hit count and last accessed time (fire-and-forget)
    GeocodeCache.updateOne(
      { _id: entry._id },
      {
        $inc: { hitCount: 1 },
        $set: { lastAccessedAt: new Date() },
      }
    ).catch((err) => console.error("[LocationService] Hit update failed:", err));

    console.log(`[LocationService] DB cache HIT: ${queryKey}`);
    return {
      coords: entry.location.coordinates,
      name: entry.displayName,
      type: entry.placeType,
      addressDetails: entry.addressDetails,
      source: `${entry.source}_cached`,
    };
  } catch (error) {
    console.error("[LocationService] DB cache read error:", error.message);
    return null;
  }
}

async function saveToDBCache(queryKey, originalQuery, result) {
  try {
    await GeocodeCache.findOneAndUpdate(
      { queryKey },
      {
        queryKey,
        originalQuery,
        location: {
          type: "Point",
          coordinates: result.coords,
        },
        displayName: result.name,
        placeType: result.type || "location",
        addressDetails: result.addressDetails || {},
        source: result.source,
        $inc: { hitCount: 1 },
        lastAccessedAt: new Date(),
      },
      { upsert: true, new: true }
    );
    console.log(`[LocationService] Saved to DB cache: ${queryKey}`);
  } catch (error) {
    console.error("[LocationService] DB cache save error:", error.message);
  }
}

// ============================================================================
// API LAYER 1: Nominatim (primary, OpenStreetMap)
// ============================================================================
async function callNominatim(query) {
  await enforceNominatimRateLimit();

  try {
    const response = await axios.get(
      "https://nominatim.openstreetmap.org/search",
      {
        params: {
          q: `${query}, Bangladesh`,
          format: "json",
          limit: 1,
          countrycodes: CONFIG.COUNTRY_CODE,
          addressdetails: 1,
          "accept-language": "en",
        },
        headers: {
          "User-Agent": CONFIG.USER_AGENT,
        },
        timeout: CONFIG.API_TIMEOUT_MS,
      }
    );

    if (!response.data || response.data.length === 0) return null;

    const result = response.data[0];
    const addr = result.address || {};

    return {
      coords: [parseFloat(result.lon), parseFloat(result.lat)],
      name: result.display_name.split(",")[0].trim(),
      type: result.type || result.class || "location",
      addressDetails: {
        country: addr.country,
        state: addr.state || addr.division,
        district: addr.district || addr.county,
        city: addr.city || addr.town || addr.village,
        suburb: addr.suburb,
        neighbourhood: addr.neighbourhood,
        road: addr.road,
        postcode: addr.postcode,
      },
      source: "nominatim",
    };
  } catch (error) {
    console.error(
      "[LocationService] Nominatim API error:",
      error.code || error.message
    );
    return null;
  }
}

// ============================================================================
// API LAYER 2: Photon (backup, also OpenStreetMap-based but faster)
// ============================================================================
async function callPhoton(query) {
  try {
    const response = await axios.get("https://photon.komoot.io/api/", {
      params: {
        q: `${query} Bangladesh`,
        limit: 1,
        lang: "en",
      },
      timeout: CONFIG.API_TIMEOUT_MS,
    });

    if (
      !response.data ||
      !response.data.features ||
      response.data.features.length === 0
    ) {
      return null;
    }

    const feature = response.data.features[0];
    const coords = feature.geometry.coordinates; // [lng, lat]
    const props = feature.properties || {};

    // Verify the result is actually in Bangladesh
    if (props.countrycode && props.countrycode.toLowerCase() !== "bd") {
      return null;
    }

    return {
      coords: [coords[0], coords[1]],
      name: props.name || query,
      type: props.osm_value || props.type || "location",
      addressDetails: {
        country: props.country,
        state: props.state,
        district: props.county,
        city: props.city,
        suburb: props.district,
        road: props.street,
        postcode: props.postcode,
      },
      source: "photon",
    };
  } catch (error) {
    console.error(
      "[LocationService] Photon API error:",
      error.code || error.message
    );
    return null;
  }
}

// ============================================================================
// MAIN PUBLIC FUNCTION: geocode
// ============================================================================
/**
 * Convert a place name into GPS coordinates.
 *
 * Supports:
 *   - English: "Dhaka University", "Singair Manikganj"
 *   - Bangla: "ঢাকা বিশ্ববিদ্যালয়", "সিঙ্গাইর"
 *   - Mixed/Banglish: "DU er kache", "Mirpur 10"
 *   - ANY place in Bangladesh (cities, villages, schools, hospitals, etc.)
 *
 * @param {string} query - Place name to geocode
 * @returns {Promise<Object|null>} { coords, name, type, addressDetails, source }
 */
async function geocode(query) {
  if (!query || typeof query !== "string") return null;

  const originalQuery = query.trim();
  let searchQuery = originalQuery;

  // STEP 1: If query is in Bangla, translate to English using AI
  if (containsBangla(searchQuery)) {
    console.log(`[LocationService] Bangla detected: "${searchQuery}"`);
    const translated = await translateBanglaToEnglish(searchQuery);
    console.log(`[LocationService] Translated: "${translated}"`);
    searchQuery = translated;
  }

  const queryKey = normalizeQuery(searchQuery);
  if (!queryKey) return null;

  // STEP 2: Check in-memory cache (fastest)
  const memHit = getFromMemoryCache(queryKey);
  if (memHit) return memHit;

  // STEP 3: Check MongoDB persistent cache
  const dbHit = await getFromDBCache(queryKey);
  if (dbHit) {
    saveToMemoryCache(queryKey, dbHit);
    return dbHit;
  }

  // STEP 4: Try Nominatim (primary API)
  console.log(`[LocationService] Calling Nominatim for: "${searchQuery}"`);
  let result = await callNominatim(searchQuery);

  // STEP 5: If Nominatim failed, try Photon (backup API)
  if (!result) {
    console.log(`[LocationService] Falling back to Photon for: "${searchQuery}"`);
    result = await callPhoton(searchQuery);
  }

  // STEP 6: If both APIs failed
  if (!result) {
    console.warn(`[LocationService] All APIs failed for: "${originalQuery}"`);
    return null;
  }

  // STEP 7: Save to both caches for future requests
  saveToMemoryCache(queryKey, result);
  await saveToDBCache(queryKey, originalQuery, result);

  return result;
}

// ============================================================================
// HELPER: Haversine distance (in kilometers)
// ============================================================================
/**
 * Calculate the great-circle distance between two GPS points.
 *
 * @param {[number, number]} coord1 - [longitude, latitude]
 * @param {[number, number]} coord2 - [longitude, latitude]
 * @returns {number} Distance in kilometers
 */
function getDistanceKm(coord1, coord2) {
  if (!Array.isArray(coord1) || !Array.isArray(coord2)) return Infinity;
  if (coord1.length !== 2 || coord2.length !== 2) return Infinity;

  const [lng1, lat1] = coord1;
  const [lng2, lat2] = coord2;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // Earth's radius in kilometers

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ============================================================================
// ANALYTICS / ADMIN HELPERS
// ============================================================================
/**
 * Get cache statistics (for monitoring / debugging).
 */
async function getCacheStats() {
  const memKeys = memoryCache.keys().length;
  const dbCount = await GeocodeCache.countDocuments();
  const topQueries = await GeocodeCache.find()
    .sort({ hitCount: -1 })
    .limit(10)
    .select("originalQuery hitCount source -_id");

  return {
    inMemoryEntries: memKeys,
    persistentEntries: dbCount,
    topSearchedLocations: topQueries,
  };
}

/**
 * Clear in-memory cache (DB cache persists).
 */
function clearMemoryCache() {
  memoryCache.flushAll();
  console.log("[LocationService] Memory cache cleared");
}

/**
 * Find cached locations near a given point (uses MongoDB 2dsphere index).
 *
 * @param {[number, number]} coords - [longitude, latitude]
 * @param {number} radiusKm - Search radius in km
 * @returns {Promise<Array>} Cached locations within radius
 */
async function findNearbyCached(coords, radiusKm = 5) {
  try {
    const radiusInMeters = radiusKm * 1000;
    const results = await GeocodeCache.find({
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: coords },
          $maxDistance: radiusInMeters,
        },
      },
    }).limit(20);
    return results;
  } catch (error) {
    console.error("[LocationService] Nearby search error:", error.message);
    return [];
  }
}

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
  geocode,
  getDistanceKm,
  getCacheStats,
  clearMemoryCache,
  findNearbyCached,
};