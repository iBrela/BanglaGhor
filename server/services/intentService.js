// ============================================================================
// INTENT SERVICE - AI Brain for User Messages
// ============================================================================
// Purpose: Extract structured information from natural language user messages.
//
// Uses Groq (Llama 3.3 70B) to understand:
//   - What the user wants (search, info, greeting, etc.)
//   - Location/landmark they mentioned
//   - Property filters (type, bedrooms, price range)
//   - Language they're using (English / Bangla / Banglish)
//
// Example:
//   Input:  "ami DU er kache 3 bedroom flat khujchi 40 lakh er moddhe"
//   Output: {
//     intent: "search_property",
//     location: { landmark: "Dhaka University", radius_km: 5 },
//     filters: { propertyType: "apartment", bedrooms: 3, maxPrice: 4000000 },
//     language: "bn"
//   }
// ============================================================================

const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  // llama-3.3-70b-versatile was decommissioned by Groq (model_not_found).
  // openai/gpt-oss-120b is a reasoning model - it spends completion tokens
  // on an internal "reasoning" pass before the actual answer, so
  // reasoning_effort: "low" below is required, not optional, to leave
  // enough of MAX_TOKENS for the real JSON output (same fix already used
  // for openai/gpt-oss-20b in propertyDescriptionService.js).
  MODEL: "openai/gpt-oss-120b",
  TEMPERATURE: 0.1,        // Low temp = consistent structured output
  MAX_TOKENS: 500,
  RESPONSE_FORMAT: { type: "json_object" }, // Force JSON output
};

// ============================================================================
// SYSTEM PROMPT - The instruction that teaches the AI what to extract
// ============================================================================
const SYSTEM_PROMPT = `You are an intent extraction AI for a Bangladeshi real estate chatbot called BanglaGhor.

Your job: Read the user's message and extract structured search information as JSON.

The user may write in English, Bangla, or Banglish (Bangla in English letters).

Return a JSON object with these fields (use null if not mentioned):

{
  "intent": "search_property" | "greeting" | "general_question" | "refine_search" | "show_more" | "unknown",
  "location": {
    "landmark": string or null,        // e.g., "Dhaka University", "Square Hospital", "Mirpur 10"
    "district": string or null,        // e.g., "Dhaka", "Chittagong"
    "area": string or null,            // e.g., "Gulshan", "Dhanmondi"
    "radius_km": number                // default 5 if not specified
  },
  "filters": {
    "propertyType": "apartment" | "house" | "condo" | "land" | "commercial" | null,
    "listingType": "rent" | "buy" | null,
    "bedrooms": number or null,
    "bathrooms": number or null,
    "minPrice": number or null,        // in BDT
    "maxPrice": number or null,        // in BDT (convert "50 lakh" to 5000000, "1 crore" to 10000000)
    "minArea": number or null,         // in sqft
    "maxArea": number or null,
    "features": {                      // boolean flags, only include if user mentioned
      "parking": boolean or null,
      "furnished": boolean or null,
      "airConditioning": boolean or null,
      "garden": boolean or null,
      "pool": boolean or null
    }
  },
  "amenities": [                       // nearby places the user wants the property close to
    {
      "category": string,              // MUST be one of the CANONICAL AMENITY CATEGORIES below - never invent one
      "maxDistance_km": number or null // positive number if user gave a distance, else null (means "near", no specific distance)
    }
  ],
  "language": "en" | "bn" | "banglish",
  "confidence": number                 // 0.0 to 1.0, how confident you are
}

CANONICAL AMENITY CATEGORIES (use ONLY these values for "category" - never invent a new one):
hospital, clinic, pharmacy, school, college, university, park, marketplace,
place_of_worship, police, fire_station, bus_station, railway_station,
ferry_terminal, bank, atm

AMENITY MAPPING RULES:
- "hospital" → hospital
- "clinic" → clinic
- "pharmacy" / "medicine shop" → pharmacy
- "school" → school
- "college" → college
- "university" → university
- "park" → park
- "market", "shopping", "bazar", "বাজার" → marketplace
- "mosque", "masjid", "temple", "mandir", "church", "place of worship" → place_of_worship
- "police", "police station" → police
- "fire station" → fire_station
- "bus stop", "bus station" → bus_station
- "train station", "railway station" → railway_station
- "ferry", "ferry terminal", "launch ghat" → ferry_terminal
- "bank" → bank
- "atm" → atm
- "public transport" (no specific mode mentioned) → output BOTH bus_station AND railway_station as
  two separate amenity entries, since there is no single "public transport" category
- If the user mentions multiple amenities (e.g. "near schools and parks"), output one entry per
  amenity, each with its own category and its own maxDistance_km (usually null unless a distance
  was given for that specific one).
- If the user gives one distance that clearly applies to all mentioned amenities (e.g. "within 2 km
  of a university"), apply that maxDistance_km to that amenity's entry.
- If no amenity is mentioned at all, "amenities" MUST be an empty array [].
- Never output a category outside the canonical list above - if a requested amenity has no
  reasonable canonical match, omit that entry entirely rather than inventing a category.

CRITICAL RULES:
1. Return ONLY valid JSON. No markdown, no explanation, no extra text.
2. Convert Bangladeshi price words to numbers:
   - "lakh" or "লাখ" = 100000  (so "50 lakh" = 5000000)
   - "crore" or "কোটি" = 10000000 (so "1 crore" = 10000000)
   - "hazar" or "হাজার" = 1000
3. For "rent", look for words: "rent", "ভাড়া", "vara", "monthly"
4. For "buy", look for words: "buy", "kinbo", "কিনব", "purchase", "sale"
5. Property type mapping:
   - "flat", "apartment", "ফ্ল্যাট" → "apartment"
   - "house", "bashbari", "বাড়ি" → "house"
   - "land", "jomi", "জমি" → "land"
   - "shop", "office", "দোকান" → "commercial"
6. Distance words:
   - "near", "kache", "কাছে", "pashe" → radius_km: 2
   - "around", "ashe pashe", "আশেপাশে" → radius_km: 5
   - "within X km" → radius_km: X
7. If user just says "hi", "hello", "salam", "আসসালামু আলাইকুম" → intent: "greeting"
8. If user asks general question like "what is the price in Gulshan?" → intent: "general_question"
9. If user says "show more", "aro dekhao", "আরো দেখাও" → intent: "show_more"
10. For amenity/POI requests ("near a hospital", "within 2 km of a university", "near schools and
    parks"), see AMENITY MAPPING RULES above and populate the "amenities" array accordingly. Only
    include amenities the user actually asked for - never add one they didn't mention.

EXAMPLES:

Input: "Show me 3 bedroom apartments near Dhaka University under 50 lakh for buy"
Output: {
  "intent": "search_property",
  "location": { "landmark": "Dhaka University", "district": null, "area": null, "radius_km": 2 },
  "filters": {
    "propertyType": "apartment", "listingType": "buy",
    "bedrooms": 3, "bathrooms": null,
    "minPrice": null, "maxPrice": 5000000,
    "minArea": null, "maxArea": null,
    "features": {}
  },
  "amenities": [],
  "language": "en",
  "confidence": 0.95
}

Input: "DU er kache 3 bedroom flat 40 lakh er moddhe"
Output: {
  "intent": "search_property",
  "location": { "landmark": "Dhaka University", "district": null, "area": null, "radius_km": 2 },
  "filters": {
    "propertyType": "apartment", "listingType": null,
    "bedrooms": 3, "bathrooms": null,
    "minPrice": null, "maxPrice": 4000000,
    "minArea": null, "maxArea": null,
    "features": {}
  },
  "amenities": [],
  "language": "banglish",
  "confidence": 0.9
}

Input: "ধানমন্ডিতে ভাড়ার জন্য ৩ বেডরুমের ফ্ল্যাট চাই, ৩০ হাজার টাকার মধ্যে"
Output: {
  "intent": "search_property",
  "location": { "landmark": null, "district": null, "area": "Dhanmondi", "radius_km": 5 },
  "filters": {
    "propertyType": "apartment", "listingType": "rent",
    "bedrooms": 3, "bathrooms": null,
    "minPrice": null, "maxPrice": 30000,
    "minArea": null, "maxArea": null,
    "features": {}
  },
  "amenities": [],
  "language": "bn",
  "confidence": 0.95
}

Input: "Hello"
Output: {
  "intent": "greeting",
  "location": { "landmark": null, "district": null, "area": null, "radius_km": 5 },
  "filters": { "propertyType": null, "listingType": null, "bedrooms": null, "bathrooms": null, "minPrice": null, "maxPrice": null, "minArea": null, "maxArea": null, "features": {} },
  "amenities": [],
  "language": "en",
  "confidence": 1.0
}

Input: "Find apartments in Banani near a hospital"
Output: {
  "intent": "search_property",
  "location": { "landmark": null, "district": null, "area": "Banani", "radius_km": 5 },
  "filters": {
    "propertyType": "apartment", "listingType": null,
    "bedrooms": null, "bathrooms": null,
    "minPrice": null, "maxPrice": null,
    "minArea": null, "maxArea": null,
    "features": {}
  },
  "amenities": [ { "category": "hospital", "maxDistance_km": null } ],
  "language": "en",
  "confidence": 0.9
}

Input: "Show properties within 2 km of a university"
Output: {
  "intent": "search_property",
  "location": { "landmark": null, "district": null, "area": null, "radius_km": 5 },
  "filters": {
    "propertyType": null, "listingType": null,
    "bedrooms": null, "bathrooms": null,
    "minPrice": null, "maxPrice": null,
    "minArea": null, "maxArea": null,
    "features": {}
  },
  "amenities": [ { "category": "university", "maxDistance_km": 2 } ],
  "language": "en",
  "confidence": 0.9
}

Input: "Find a family apartment near schools and parks"
Output: {
  "intent": "search_property",
  "location": { "landmark": null, "district": null, "area": null, "radius_km": 5 },
  "filters": {
    "propertyType": "apartment", "listingType": null,
    "bedrooms": null, "bathrooms": null,
    "minPrice": null, "maxPrice": null,
    "minArea": null, "maxArea": null,
    "features": {}
  },
  "amenities": [
    { "category": "school", "maxDistance_km": null },
    { "category": "park", "maxDistance_km": null }
  ],
  "language": "en",
  "confidence": 0.85
}

Input: "Find properties near a mosque"
Output: {
  "intent": "search_property",
  "location": { "landmark": null, "district": null, "area": null, "radius_km": 5 },
  "filters": {
    "propertyType": null, "listingType": null,
    "bedrooms": null, "bathrooms": null,
    "minPrice": null, "maxPrice": null,
    "minArea": null, "maxArea": null,
    "features": {}
  },
  "amenities": [ { "category": "place_of_worship", "maxDistance_km": null } ],
  "language": "en",
  "confidence": 0.9
}

Input: "Find apartments near public transport"
Output: {
  "intent": "search_property",
  "location": { "landmark": null, "district": null, "area": null, "radius_km": 5 },
  "filters": {
    "propertyType": "apartment", "listingType": null,
    "bedrooms": null, "bathrooms": null,
    "minPrice": null, "maxPrice": null,
    "minArea": null, "maxArea": null,
    "features": {}
  },
  "amenities": [
    { "category": "bus_station", "maxDistance_km": null },
    { "category": "railway_station", "maxDistance_km": null }
  ],
  "language": "en",
  "confidence": 0.85
}`;

// ============================================================================
// MAIN FUNCTION: Extract intent from user message
// ============================================================================
/**
 * Extract structured search intent from a natural language user message.
 *
 * @param {string} userMessage - What the user typed
 * @param {Array} conversationHistory - Optional: last few messages for context
 * @returns {Promise<Object>} Structured intent object
 */
async function extractIntent(userMessage, conversationHistory = []) {
  if (!userMessage || typeof userMessage !== "string") {
    return getEmptyIntent();
  }

  try {
    // Build context from conversation history (last 3 exchanges)
    const recentHistory = conversationHistory.slice(-6);

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      // Add recent conversation context if available
      ...recentHistory.map((msg) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content,
      })),
      { role: "user", content: userMessage },
    ];

    console.log(`[IntentService] Extracting intent from: "${userMessage}"`);

    const completion = await groq.chat.completions.create({
      model: CONFIG.MODEL,
      messages: messages,
      temperature: CONFIG.TEMPERATURE,
      max_tokens: CONFIG.MAX_TOKENS,
      response_format: CONFIG.RESPONSE_FORMAT,
      reasoning_effort: "low",
    });

    const rawResponse = completion.choices[0]?.message?.content;
    if (!rawResponse) {
      console.error("[IntentService] Empty response from Groq");
      return getEmptyIntent();
    }

    // Parse JSON response
    const intent = JSON.parse(rawResponse);

    // Validate and normalize the response
    const validated = validateIntent(intent);

    console.log(`[IntentService] Extracted intent:`, JSON.stringify(validated, null, 2));
    return validated;
  } catch (error) {
    console.error("[IntentService] Error extracting intent:", error.message);
    return getEmptyIntent();
  }
}

// ============================================================================
// HELPER: Validate and normalize intent object
// ============================================================================
function validateIntent(raw) {
  const validIntents = [
    "search_property",
    "greeting",
    "general_question",
    "refine_search",
    "show_more",
    "unknown",
  ];

  const validPropertyTypes = [
    "apartment",
    "house",
    "condo",
    "land",
    "commercial",
  ];

  const validListingTypes = ["rent", "buy"];
  const validLanguages = ["en", "bn", "banglish"];

  return {
    intent: validIntents.includes(raw.intent) ? raw.intent : "unknown",
    location: {
      landmark: raw.location?.landmark || null,
      district: raw.location?.district || null,
      area: raw.location?.area || null,
      radius_km: clampNumber(raw.location?.radius_km, 0.5, 50, 5),
    },
    filters: {
      propertyType: validPropertyTypes.includes(raw.filters?.propertyType)
        ? raw.filters.propertyType
        : null,
      listingType: validListingTypes.includes(raw.filters?.listingType)
        ? raw.filters.listingType
        : null,
      bedrooms: clampNumber(raw.filters?.bedrooms, 0, 20, null),
      bathrooms: clampNumber(raw.filters?.bathrooms, 0, 20, null),
      minPrice: clampNumber(raw.filters?.minPrice, 0, Infinity, null),
      maxPrice: clampNumber(raw.filters?.maxPrice, 0, Infinity, null),
      minArea: clampNumber(raw.filters?.minArea, 0, Infinity, null),
      maxArea: clampNumber(raw.filters?.maxArea, 0, Infinity, null),
      features: raw.filters?.features || {},
    },
    amenities: validateAmenities(raw.amenities),
    language: validLanguages.includes(raw.language) ? raw.language : "en",
    confidence: clampNumber(raw.confidence, 0, 1, 0.5),
  };
}

// ============================================================================
// HELPER: Safely clamp a number value
// ============================================================================
function clampNumber(value, min, max, defaultValue) {
  if (value === null || value === undefined) return defaultValue;
  const num = Number(value);
  if (isNaN(num)) return defaultValue;
  if (num < min || num > max) return defaultValue;
  return num;
}

// ============================================================================
// HELPER: Validate/normalize the amenities array
// ============================================================================
// Canonical categories must exactly match server/models/PointOfInterest.js's
// CATEGORIES export - kept as a local copy (rather than requiring the
// Mongoose model here) so this service's dependency footprint and "no
// MongoDB/POI querying" scope stay unchanged. Update both lists together if
// the POI category set ever changes.
const VALID_AMENITY_CATEGORIES = [
  "hospital",
  "clinic",
  "pharmacy",
  "school",
  "college",
  "university",
  "park",
  "marketplace",
  "place_of_worship",
  "police",
  "fire_station",
  "bus_station",
  "railway_station",
  "ferry_terminal",
  "bank",
  "atm",
];

// A maxDistance_km beyond this is treated the same as "no distance given"
// (null) rather than trusted as-is - mirrors location.radius_km's existing
// 50 km upper clamp above, so an amenity distance can't be an unbounded or
// nonsensical value either.
const MAX_AMENITY_DISTANCE_KM = 50;

function normalizeAmenityDistance(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.min(num, MAX_AMENITY_DISTANCE_KM);
}

function validateAmenities(raw) {
  if (!Array.isArray(raw)) return [];

  const result = [];
  for (const entry of raw) {
    const category = entry?.category;
    // Unsupported/invented categories are dropped entirely, not nulled -
    // an amenity entry with no valid category carries no usable signal.
    if (!VALID_AMENITY_CATEGORIES.includes(category)) continue;

    result.push({
      category,
      maxDistance_km: normalizeAmenityDistance(entry?.maxDistance_km),
    });
  }
  return result;
}

// ============================================================================
// HELPER: Return empty/default intent (fallback)
// ============================================================================
function getEmptyIntent() {
  return {
    intent: "unknown",
    location: { landmark: null, district: null, area: null, radius_km: 5 },
    filters: {
      propertyType: null,
      listingType: null,
      bedrooms: null,
      bathrooms: null,
      minPrice: null,
      maxPrice: null,
      minArea: null,
      maxArea: null,
      features: {},
    },
    amenities: [],
    language: "en",
    confidence: 0,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
  extractIntent,
};