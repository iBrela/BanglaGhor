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
const {
  BANGLADESH_BOUNDS_BUFFERED,
  isWithinBangladesh,
} = require("../../src/shared/bangladeshGeo");

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

  // ── Autocomplete (Photon-only, see searchLocations() below) ──────────────
  // Nominatim's own usage policy explicitly prohibits autocomplete:
  // "Auto-complete search...is not yet supported by Nominatim and you must
  // not implement such a service." (operations.osmfoundation.org/policies/
  // nominatim/, verified directly before writing this). Photon is fair-use/
  // throttled but has no such prohibition and is built for this. There is
  // deliberately NO Nominatim fallback in the autocomplete path below.
  AUTOCOMPLETE_MIN_QUERY_LENGTH: 2,
  AUTOCOMPLETE_DEFAULT_LIMIT: 8,
  AUTOCOMPLETE_MAX_LIMIT: 10,
  AUTOCOMPLETE_TIMEOUT_MS: 3500,
};

// Photon's bbox param format is "minLon,minLat,maxLon,maxLat" (verified
// against docs/api-v1.md). Reuses the same canonical bounds the map itself
// uses - see src/shared/bangladeshGeo.js.
const PHOTON_BBOX_PARAM = [
  BANGLADESH_BOUNDS_BUFFERED.minLon,
  BANGLADESH_BOUNDS_BUFFERED.minLat,
  BANGLADESH_BOUNDS_BUFFERED.maxLon,
  BANGLADESH_BOUNDS_BUFFERED.maxLat,
].join(",");

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
      // llama-3.3-70b-versatile was decommissioned by Groq (model_not_found).
      // openai/gpt-oss-120b is a reasoning model - it spends completion
      // tokens on an internal "reasoning" pass before the actual answer, so
      // with the small max_tokens: 50 budget below, reasoning_effort: "low"
      // is required (confirmed live: without it, reasoning alone consumed
      // the full 50-token budget and returned an empty string).
      model: "openai/gpt-oss-120b",
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
      reasoning_effort: "low",
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
// AUTOCOMPLETE / SEARCH: searchLocations (Photon only)
// ============================================================================
// Separate from geocode() above on purpose: geocode() is the existing
// single-result RAG pipeline (Bangla AI translation + Nominatim-first +
// Photon-fallback + persistent cache) and is left completely unchanged by
// everything below. This is a new, independent, multi-result function for
// keystroke-driven autocomplete, which per Nominatim's own policy must never
// reach Nominatim - only Photon, with a controlled failure mode (never falls
// back to Nominatim, per that policy).
// ============================================================================

// Normalizes one real Photon GeoJSON feature into the app's provider-
// independent shape. Built from actual Photon responses captured during
// development (photon.komoot.io/api/?q=Gulshan&bbox=...&countrycode=bd),
// not a remembered/assumed schema. Real fields seen: osm_type, osm_id,
// osm_key, osm_value, type (Photon's own normalized layer - "city", "state",
// "county", "district", "locality", "street", "house"), name, city, county,
// state, country, countrycode, postcode, street, district, locality, extent.
//
// Caveat discovered during real testing: Photon's "district"/"county" fields
// are NOT consistently Bangladesh's administrative Zila (district) level -
// "county" is sometimes an Upazila ("সিংগাইর উপজেলা"), sometimes a
// metropolitan area ("Dhaka Metropolitan"), sometimes an actual district
// ("চট্টগ্রাম জেলা"); "district" is sometimes used for a city sub-area
// instead (e.g. "Gulshan" as the district of the locality "Gulshan 2").
// context.district below is therefore a best-effort label, not a guaranteed
// exact administrative match - documented here rather than overclaimed.
function normalizePhotonFeature(feature) {
  const props = feature?.properties || {};
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;

  const [lng, lat] = coords;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const name = props.name;
  if (!name) return null;

  const contextParts = [props.city, props.county, props.state].filter(Boolean);
  const displayName =
    contextParts.length > 0 ? `${name}, ${contextParts.join(", ")}` : name;

  return {
    id: `photon:${props.osm_type || "?"}:${props.osm_id || `${lat},${lng}`}`,
    displayName,
    shortName: name,
    lat,
    lng,
    type: props.type || props.osm_value || "location",
    countryCode: (props.countrycode || "").toLowerCase(),
    context: {
      district: props.county || props.district || null,
      division: props.state || null,
    },
    // Additive, optional fields for callers that need to pre-fill a
    // structured address form (e.g. the property-listing address
    // autocomplete) rather than just a map search label. Only ever the raw
    // value Photon itself returned for this exact feature, or null - never
    // fabricated/derived. Existing consumers (map search, home search) don't
    // read these and are unaffected.
    postcode: props.postcode || null,
    street: props.street || null,
    city: props.city || null,
    // Additive: Photon returns this for some house/road-level results (not
    // for area/place-level ones like a neighbourhood name) - raw passthrough
    // only, null when absent. Never fabricated when missing.
    houseNumber: props.housenumber || null,
    // Additive: best-effort Upazila/Thana signal. Confirmed by live-testing
    // real Dhaka/Chattogram/Khulna addresses - Bangladesh's Upazila/Thana
    // tier doesn't map onto any single dedicated OSM/Photon admin field, but
    // when props.district is present AND distinct from props.county (the
    // field context.district above already uses for the app's "District"
    // field), it reliably holds the thana-level neighbourhood name for
    // address-level results (e.g. "Gulshan", "Dhanmondi", "Kolabagan" for
    // Dhaka Metropolitan addresses - verified against Photon's live API).
    // When district is absent, or equals county (no distinct info), this is
    // null rather than guessed - callers must treat null as "Photon has no
    // trustworthy Upazila/Thana for this result" and leave it for the seller
    // to fill in manually, never fabricating a value.
    upazila: props.district && props.district !== props.county ? props.district : null,
    provider: "photon",
  };
}

// Collapses same-name/same-type entries (confirmed a real, common occurrence
// in Photon's Bangladesh results during testing - e.g. "Khulna City Bypass"
// appearing 3x with different osm_ids for the same road, "Mymensingh"
// appearing 2x as separate near-identical house-level entries). Keeps the
// first occurrence, preserving Photon's own relevance ordering.
function dedupeResults(results) {
  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    const key = `${r.shortName.trim().toLowerCase()}|${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  return deduped;
}

// Maps a resolved language ("en"/"bn") to Photon's `lang` request param.
// Verified with real requests during development, not assumed:
//   - Photon's `lang` param controls which language the ENTIRE response
//     (name, city, county, state - all of them together) comes back in.
//   - lang=bn is REJECTED by the public Photon instance (HTTP 400) - Bengali
//     is not one of its explicitly supported lang values.
//   - lang=default (or omitting lang) returns each feature's local/native
//     OSM name, which for Bangladesh is Bangla - confirmed directly:
//     "Chattogram" -> "চট্টগ্রাম", "Chattogram District" -> "চট্টগ্রাম জেলা".
//   - There is no single response containing both an English AND a Bangla
//     name side by side (no name:en/name:bn field pair like the basemap's
//     OpenMapTiles tiles have) - it's one name per request, chosen by lang.
function photonLangFor(lang) {
  return lang === "bn" ? "default" : "en";
}

// Detects which language to actually request from Photon for a given query,
// with the QUERY'S OWN SCRIPT taking priority over the app's UI language -
// confirmed necessary because Photon's response language does NOT follow the
// query's script on its own: typing "চট্টগ্রাম" with lang=en still returns
// "Chattogram", and typing "Chattogram" with lang=default still returns
// "চট্টগ্রাম" (see photonLangFor above). So if we always sent the UI
// language, a Bangla query typed in an English-language UI would silently
// come back in English - the exact bug this fixes.
//
// Reuses containsBangla() (defined above, already used by geocode()'s
// Bangla-detection for its own unrelated Groq-translation step) - a plain
// Unicode Bengali-block regex test, no AI/translation involved here either.
//
// Rule: Bengali characters present -> "bn" (regardless of any Latin mixed
// in, e.g. house/road numbers). Else, any Latin letters present -> "en".
// Else (pure digits/punctuation/symbols, or empty) -> null, meaning
// "ambiguous" - the caller falls back to the app's UI language for that case
// only.
function detectQueryScript(query) {
  if (containsBangla(query)) return "bn";
  if (/[A-Za-z]/.test(query)) return "en";
  return null;
}

/**
 * Autocomplete/multi-result location search, Photon-only (never Nominatim -
 * see policy note above). Used for keystroke-driven search UIs.
 *
 * @param {string} query
 * @param {{ limit?: number, lang?: "en"|"bn" }} [options] options.lang is the
 *   app's UI language, used ONLY as the fallback when the query's own script
 *   is ambiguous (see detectQueryScript above) - the query's script wins
 *   whenever it's detectable.
 * @returns {Promise<{ results: Array, provider: "photon", status: "ok"|"unavailable" }>}
 */
async function searchLocations(query, options = {}) {
  const trimmed = (query || "").trim();
  if (trimmed.length < CONFIG.AUTOCOMPLETE_MIN_QUERY_LENGTH) {
    return { results: [], provider: "photon", status: "ok" };
  }

  const limit = Math.min(
    options.limit || CONFIG.AUTOCOMPLETE_DEFAULT_LIMIT,
    CONFIG.AUTOCOMPLETE_MAX_LIMIT
  );
  // Query script takes priority over the UI language; UI language is only
  // consulted when the query itself is ambiguous (numbers/punctuation only).
  const effectiveLang = detectQueryScript(trimmed) || options.lang;
  const photonLang = photonLangFor(effectiveLang);

  // Language is part of the cache key, keyed by the EFFECTIVE (query-script-
  // resolved) language rather than the raw UI language - Photon returns a
  // DIFFERENT `name` (and city/county/state) per lang param for the exact
  // same place, so a Bangla-resolved entry must never serve an
  // English-resolved one or vice versa, regardless of which UI language
  // happened to request it.
  const cacheKey = `autocomplete:${normalizeQuery(trimmed)}:${limit}:${photonLang}`;
  const cached = getFromMemoryCache(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get("https://photon.komoot.io/api/", {
      params: {
        q: trimmed,
        // Fetch extra candidates since defensive filtering + dedupe below
        // can remove some - real testing showed this is worth doing (see
        // M2 audit report for the Khulna/Mymensingh duplicate examples).
        limit: Math.min(limit * 2, 20),
        lang: photonLang,
        bbox: PHOTON_BBOX_PARAM,
        countrycode: CONFIG.COUNTRY_CODE,
      },
      headers: { "User-Agent": CONFIG.USER_AGENT },
      timeout: CONFIG.AUTOCOMPLETE_TIMEOUT_MS,
    });

    const features = response.data?.features || [];
    const normalized = features
      .map(normalizePhotonFeature)
      .filter(Boolean)
      // Defensive: bbox/countrycode are Photon's own hard filters, but a
      // rectangular bbox can't perfectly match Bangladesh's real border, and
      // countrycode depends on the underlying OSM tag being correct/present.
      // Re-checking against the same buffered bounds the map itself trusts
      // catches any edge-case leak rather than assuming the provider is
      // airtight.
      .filter((r) => isWithinBangladesh(r.lat, r.lng));

    const deduped = dedupeResults(normalized).slice(0, limit);
    const result = { results: deduped, provider: "photon", status: "ok" };

    saveToMemoryCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error(
      "[LocationService] Photon autocomplete error:",
      error.code || error.message
    );
    // Controlled failure - never falls back to Nominatim (policy), never
    // throws to the caller.
    return { results: [], provider: "photon", status: "unavailable" };
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
  searchLocations,
  getDistanceKm,
  getCacheStats,
  clearMemoryCache,
  findNearbyCached,
};