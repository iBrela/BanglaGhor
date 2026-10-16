// ============================================================================
// PROPERTY DESCRIPTION SERVICE
// ============================================================================
// Automatic bilingual (English + Bangla) property description generation AND
// translation for the property create/edit flow - entirely free-tier:
//
//   GENERATION:  Groq (openai/gpt-oss-20b, low reasoning)
//                -> Gemini (gemini-flash-lite-latest)
//                -> deterministic local template
//
//   TRANSLATION: Gemini (gemini-flash-lite-latest)
//                -> Groq (openai/gpt-oss-20b, low reasoning)
//                -> preserve source-language text, leave the other field empty
//
// No Google Cloud Translation dependency (removed - it was returning 403 and
// isn't free). Every function here is designed to NEVER throw - a listing
// must always be able to save even if every external provider is
// unreachable.
//
// Not related to and does not touch the chatbot/RAG (ragService.js,
// intentService.js) or aiController.js's chatbot endpoint.
// ============================================================================

const axios = require("axios");
const poiService = require("./poiService");

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent";

const getSafe = (obj, path, def = null) => {
  const v = obj?.[path];
  return v === undefined || v === null || v === "" ? def : v;
};

// ============================================================================
// NEARBY POI ENRICHMENT
// ============================================================================
// Reuses the existing poiService.findNearbyPOIs (server/services/poiService.js
// - the same real, imported-from-OpenStreetMap dataset already used by
// server/controllers/poiController.js) rather than inventing a second
// location-data path. Only ever runs for properties with a genuinely
// geocoded position - locationAccuracy "precise" or "approximate" - never
// for "district-level"/"unknown" fallback coordinates, since those aren't
// the property's real location and any "nearby" claim built from them would
// itself be an invented fact.
// ============================================================================
const POI_ENRICHMENT_RADIUS_METERS = 1200; // genuinely walkable "nearby", not just same-district
const POI_CATEGORY_LABELS = {
  school: "School",
  college: "College",
  university: "University",
  hospital: "Hospital",
  clinic: "Clinic",
  pharmacy: "Pharmacy",
  marketplace: "Market",
  place_of_worship: "Place of worship",
  park: "Park",
  bus_station: "Bus station",
  railway_station: "Railway station",
  bank: "Bank",
  atm: "ATM",
};
// Priority order for which categories are worth mentioning in a listing
// (drops less relevant categories like fire_station/police/ferry_terminal
// from the description even if present nearby).
const POI_PRIORITY = [
  "school",
  "hospital",
  "marketplace",
  "place_of_worship",
  "park",
  "clinic",
  "college",
  "university",
  "pharmacy",
  "bus_station",
  "railway_station",
  "bank",
  "atm",
];

async function getNearbyPOIHighlights(property) {
  const accuracy = property?.locationAccuracy;
  const lat = Number(property?.latitude);
  const lng = Number(property?.longitude);
  if (
    (accuracy !== "precise" && accuracy !== "approximate") ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return [];
  }

  try {
    const results = await poiService.findNearbyPOIs({
      lat,
      lng,
      maxDistance: POI_ENRICHMENT_RADIUS_METERS,
      limit: 40,
    });

    // Closest POI per category, kept only for categories worth mentioning.
    const closestByCategory = {};
    for (const poi of results) {
      if (!POI_CATEGORY_LABELS[poi.category]) continue;
      const existing = closestByCategory[poi.category];
      if (!existing || poi.distanceMeters < existing.distanceMeters) {
        closestByCategory[poi.category] = poi;
      }
    }

    return POI_PRIORITY.filter((cat) => closestByCategory[cat])
      .slice(0, 5) // at most 5 highlights - keeps the prompt/description focused
      .map((cat) => {
        const poi = closestByCategory[cat];
        const name = poi.name || poi.nameEn || POI_CATEGORY_LABELS[cat];
        return {
          category: cat,
          label: POI_CATEGORY_LABELS[cat],
          name,
          distanceMeters: poi.distanceMeters,
        };
      });
  } catch (error) {
    // Read-only enrichment - never let a POI lookup failure block
    // description generation. error.message only, same convention as the
    // AI provider calls below.
    console.error("[PropertyDescription] Nearby POI lookup error:", error.message);
    return [];
  }
}

function formatNearbyHighlightsForPrompt(highlights) {
  if (!highlights || highlights.length === 0) return null;
  return highlights
    .map((h) => `- ${h.label}: ${h.name} (~${h.distanceMeters}m away)`)
    .join("\n");
}

// ============================================================================
// LANGUAGE DETECTION
// ============================================================================
// Deterministic, no external API. Counts Bengali-script letters (Unicode
// block ঀ-৿, which covers the base consonants/vowels, matras, and
// conjunct marks used in written Bangla) against Latin letters (A-Za-z),
// ignoring digits/punctuation/whitespace entirely so a price like "45,000"
// or a bare number never skews the result. Whichever script has the larger
// letter count is the dominant language - this deliberately does NOT
// classify text as Bangla just because it contains a single short Bangla
// place name inside an otherwise-English sentence (that fragment's letter
// count is usually small relative to the surrounding English words).
// Defaults to English when there are no letters of either script at all,
// matching this app's i18n fallbackLng.
// ============================================================================
function detectLanguage(text) {
  if (!text) return "en";
  const bengaliCount = (text.match(/[ঀ-৿]/g) || []).length;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;
  if (bengaliCount === 0 && latinCount === 0) return "en";
  return bengaliCount > latinCount ? "bn" : "en";
}

// ─── Shared fact-gathering (used by both full-generation and the seller-text
// enhancement prompt below) - only ever includes a fact when the field
// actually has a value, never invents/defaults one. ──────────────────────────
function buildFactLines(property) {
  const featureLines = [];
  const f = property.features || {};
  if (f.furnished && f.furnished !== "no")
    featureLines.push(`- Furnished: ${f.furnished}`);
  if (f.parking) featureLines.push("- Parking available");
  if (f.garden) featureLines.push("- Garden");
  if (f.airConditioning) featureLines.push("- Air conditioning");
  if (f.pool) featureLines.push("- Pool");

  const bd = property.bangladeshDetails || {};
  const bdFieldsToInclude = [
    ["proximityToMainRoad", "Proximity to main road"],
    ["roadWidth", "Road width"],
    ["naturalLight", "Natural light"],
    ["balcony", "Balcony", "yes"],
    ["rooftopAccess", "Rooftop access", "yes"],
    ["waterSource", "Water source"],
    ["gasSource", "Gas source"],
    ["backupPower", "Backup power", (v) => v && v !== "none"],
    ["propertyCondition", "Property condition"],
    ["ownershipPapers", "Ownership papers", (v) => v && v !== "unknown"],
    ["nearbySchools", "Nearby schools"],
    ["nearbyHospitals", "Nearby hospitals"],
    ["nearbyMarkets", "Nearby markets"],
    ["nearbyReligiousPlaces", "Nearby religious places"],
    ["nearbyOthers", "Other nearby facilities"],
  ];
  for (const [key, label, cond] of bdFieldsToInclude) {
    const v = bd[key];
    if (!v) continue;
    if (typeof cond === "function" && !cond(v)) continue;
    if (typeof cond === "string" && v !== cond) continue;
    featureLines.push(`- ${label}: ${v}`);
  }
  if (Array.isArray(bd.securityFeatures) && bd.securityFeatures.length > 0) {
    featureLines.push(`- Security: ${bd.securityFeatures.join(", ")}`);
  }

  const locationParts = [
    property.addressLine1,
    property.upazila,
    property.cityTown,
    property.district,
  ].filter(Boolean);

  return { featureLines, locationParts };
}

// Shared structure/length guidance for BOTH the full-generation prompt and
// the enhancement prompt below - ensures the two code paths produce the
// same quality/depth target. Added after live-testing against the real
// Groq/Gemini APIs showed the enhancement prompt's old vague "concise,
// 1-3 short paragraphs" guidance collapsed everything into one dense,
// semicolon-packed ~70-word paragraph instead of the two well-organized
// paragraphs a reader would expect.
const DESCRIPTION_STRUCTURE_RULES = `- Write approximately TWO paragraphs, separated by a blank line (two newline characters) - natural flowing prose, never a comma/semicolon-separated list of facts strung into one run-on paragraph.
- Paragraph 1: the property itself - type, size, bedrooms/bathrooms, condition, furnishing, and the other confirmed property features supplied below.
- Paragraph 2: location, access, and nearby information - using only the location/road/light/nearby-place facts actually supplied below. If little or no such information is supplied, keep this paragraph short and factual, or fold the little that exists into paragraph 1 - never pad an empty-feeling second paragraph with filler.
- Target length: approximately 140-220 words total. This is a guideline, not a strict rule - a listing with limited supplied information should produce a shorter, still fully factual description rather than being padded with generic sentences just to reach this length.`;

// Shared, strict no-hallucination guidance - added to the generation prompt
// after live-testing found it fabricating content ("growing infrastructure",
// "capitalize on the expanding urban landscape", "ready to build - no
// existing structures") for a sparse land listing with almost no supplied
// fields, apparently padding to reach the length target above. This makes
// explicit that a short, honest description always wins over a longer
// invented one - the generation prompt previously only had a single weak
// "no exaggerated claims" line with no sparse-data guidance at all.
const DESCRIPTION_NO_HALLUCINATION_RULES = `- Never invent anything not present in the supplied facts below: no nearby facilities, distances, transport links, room counts, parking, furnishing, balcony, rooftop access, utilities, security, property condition, renovations, road width, natural light, views, investment potential, development opportunity, or neighbourhood claims that aren't actually supported by the data given.
- Avoid unsupported marketing phrases such as "luxury", "premium", "prime location", "perfect investment", "walking distance", "excellent connectivity", or "ideal for families/professionals" unless the supplied facts genuinely justify that specific claim.
- For land/plot listings specifically: do not describe it as a "blank canvas", "ready for development", "great investment opportunity", "capitalize on growth", "access to the city's/region's expanding infrastructure", "within local zoning regulations", or similar - these are unsupported investment/development/infrastructure claims unless the supplied data explicitly states zoning, permitted use, infrastructure access, or development plans. A sparse land listing with only type/price/size/location should simply state those facts plainly and stop - it does not need a closing sentence about the land's potential.
- If only a little information is supplied, write a SHORT, fully factual description instead - even as few as 40-80 words is fine. A short truthful description is always better than a longer one padded with generic filler about development potential, future opportunity, growing infrastructure, or investment value.`;

// ─── Generation prompt (shared by Groq and Gemini) ─────────────────────────
function buildGenerationPrompt(property, nearbyHighlights) {
  const { featureLines, locationParts } = buildFactLines(property);

  const isLandOrCommercial =
    property.propertyType === "land" || property.propertyType === "commercial";

  const nearbySection = formatNearbyHighlightsForPrompt(nearbyHighlights);

  return `You are an expert real estate copywriter for a Bangladesh property portal. Write an attractive, informative, professional property description using ONLY the facts supplied below. This should read like a real listing a buyer/renter would want to read, not a generic template: explain the property's concrete details (space, features, condition, location) in natural, varied language rather than a feature dump.

Rules:
- Identify property type and rent/sale status early on.
- Summarize the location, preserving any Bangla-script place names exactly as given (do not translate them).
${isLandOrCommercial ? "" : "- Include bedrooms/bathrooms if present.\n"}- Include area if present, price naturally if present (not just a bare list - weave these into the prose).
- Mention supplied features naturally (furnishing, parking, balcony, security, etc. when present).
${DESCRIPTION_NO_HALLUCINATION_RULES}
${DESCRIPTION_STRUCTURE_RULES}
- No markdown, no headings, no bullet points in the output - flowing prose only.

Property Details:
- Title: ${getSafe(property, "title", "N/A")}
- Property Type: ${getSafe(property, "propertyType", "N/A")}
- Listing Type: For ${getSafe(property, "listingType", "N/A")}
- Price: ${
    property.price ? Number(property.price).toLocaleString() : "N/A"
  } BDT${property.listingType === "rent" ? " /month" : ""}
- Size: ${getSafe(property, "area", "N/A")} sqft
${
  isLandOrCommercial
    ? ""
    : `- Bedrooms: ${getSafe(property, "bedrooms", "N/A")}\n- Bathrooms: ${getSafe(
        property,
        "bathrooms",
        "N/A"
      )}\n`
}
Location: ${locationParts.length > 0 ? locationParts.join(", ") : "N/A"}

Key Features:
${featureLines.length > 0 ? featureLines.join("\n") : "N/A"}

Verified Nearby Places: ${nearbySection ? "the ONLY nearby places you are allowed to mention, each at most once, using exactly this name and distance:" : "NONE SUPPLIED."}
${nearbySection || "Do not mention proximity to ANY school, hospital, market, mosque/place of worship, park, station, bazaar, or other amenity anywhere in the description - there is no verified nearby-places data for this property."}

STRICT OUTPUT CONSTRAINT (read this last, it overrides anything above): the "Verified Nearby Places" list above is the complete and only set of nearby places that exist for this task. Do not name, hint at, or invent any other nearby place, amenity, distance, or travel time under any name (no "Hospital A/B/C", no "a local bazaar", no "a nearby mosque", no "a park nearby") beyond exactly what is listed there. If that list is empty, the description must contain zero references to nearby places, distances, or travel times of any kind.`;
}

// ─── Enhancement prompt: merge the seller's own draft with confirmed listing
// data into ONE polished description - see enhanceDescription() below for
// the full "seller text is primary source of truth, no hallucination" rules
// this implements. ────────────────────────────────────────────────────────
function buildEnhancementPrompt(sellerText, property, nearbyHighlights, lang) {
  const { featureLines, locationParts } = buildFactLines(property);
  const isLandOrCommercial =
    property.propertyType === "land" || property.propertyType === "commercial";
  const nearbySection = formatNearbyHighlightsForPrompt(nearbyHighlights);
  const languageLabel = lang === "bn" ? "Bengali (Bangla script)" : "English";

  return `You are an expert real estate copywriter for a Bangladesh property portal. A seller has written their own property description below, and your job is to improve and EXPAND it into ONE coherent, richer, professional description written in ${languageLabel} - genuinely merged and rewritten throughout, never the seller's original unchanged text with a separate AI-written paragraph simply appended after it.

SELLER'S OWN DESCRIPTION (the primary source of truth - every fact stated here must remain represented in your output, though you may reword it for grammar and flow):
"""
${sellerText}
"""

You may ALSO draw on the confirmed listing data below, but only to add a fact that is missing from the seller's text and clearly true - never to contradict or replace what the seller wrote.

Confirmed Listing Data:
- Property Type: ${getSafe(property, "propertyType", "N/A")}
- Listing Type: For ${getSafe(property, "listingType", "N/A")}
- Price: ${
    property.price ? Number(property.price).toLocaleString() : "N/A"
  } BDT${property.listingType === "rent" ? " /month" : ""}
- Size: ${getSafe(property, "area", "N/A")} sqft
${
  isLandOrCommercial
    ? ""
    : `- Bedrooms: ${getSafe(property, "bedrooms", "N/A")}\n- Bathrooms: ${getSafe(
        property,
        "bathrooms",
        "N/A"
      )}\n`
}
Location: ${locationParts.length > 0 ? locationParts.join(", ") : "N/A"}

Key Features:
${featureLines.length > 0 ? featureLines.join("\n") : "N/A"}

Verified Nearby Places: ${nearbySection ? "the ONLY nearby places you are allowed to mention, each at most once, using exactly this name and distance:" : "NONE SUPPLIED."}
${nearbySection || "Do not mention proximity to ANY school, hospital, market, mosque/place of worship, park, station, bazaar, or other amenity anywhere in the description - there is no verified nearby-places data for this property."}

STRICT RULES (these override everything above):
- Output ONE coherent, genuinely rewritten description, in ${languageLabel} only - never the seller's original sentences left untouched with a separate AI paragraph stuck on afterward, and never a bare list. Writing it as two natural paragraphs (see structure below) is correct and expected - that is NOT the "stitched together" anti-pattern this rule forbids.
- Preserve every concrete fact the seller stated (room counts, condition, location references, amenities they named). Do not drop or contradict any of them.
- Expand on the seller's draft using the Confirmed Listing Data and Key Features above wherever they add a real, missing detail - do not just lightly reword the seller's own sentence and stop there if more confirmed, relevant facts are available.
- Never invent anything not present in the seller's text or the Confirmed Listing Data above - no features, room counts, parking, furnishing, nearby facilities, distances, condition, renovations, views, security, transport access, road conditions, utilities, development opportunity, or investment claims that aren't actually supported.
- Do not use words like "luxury", "premium", "perfect investment", "prime location", "excellent transport connectivity", or "walking distance" unless the supplied facts genuinely support that specific claim.
- If the seller's text and the Confirmed Listing Data together still amount to very little, keep the result SHORT and factual (even as few as 40-80 words) rather than padding it with generic filler to reach the target length below - a short truthful description is always better than a longer invented one.
- Sound professional and natural, not exaggerated. Fix grammar and remove repetition from the seller's draft.
${DESCRIPTION_STRUCTURE_RULES}
- Output ONLY the final description text - no preamble, no explanation, no quotation marks, no markdown.`;
}

// Minimal sanity check on enhancement output - not a translation (same
// language in and out), so isValidTranslation's cross-script checks don't
// apply here; this only guards against an empty/garbled/truncated response.
function isValidEnhancementOutput(text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.includes("�")) return false;
  if (trimmed.length < 15) return false;
  return true;
}

// ─── "Enhance with AI" entry point (seller-triggered, pre-submission) ──────
// Takes the seller's current draft text plus whatever confirmed form data
// has been entered so far (NOT a saved Property document - this runs before
// the listing is created) and returns ONE merged, polished description, or
// null if every provider failed/returned something unusable. Callers MUST
// treat null as "keep the seller's existing text unchanged" - this function
// never throws and never fabricates a placeholder description.
async function enhanceDescription(sellerText, property) {
  const trimmed = (sellerText || "").trim();
  if (!trimmed) return null;

  const lang = detectLanguage(trimmed);
  const nearbyHighlights = await getNearbyPOIHighlights(property);
  const prompt = buildEnhancementPrompt(trimmed, property, nearbyHighlights, lang);

  let text = await callGroq(prompt, 700);
  if (!text || !isValidEnhancementOutput(text)) {
    text = await callGemini(prompt);
  }
  if (!text || !isValidEnhancementOutput(text)) return null;
  return text.trim();
}

// ─── "Enhance with AI" / blank-generate entry point (seller-triggered,
// pre-submission) - the single function the frontend's Enhance-with-AI
// button and its auto-generate-before-Continue fallback both call (see
// useListingForm.js). Branches on whether the seller has written anything:
//   - non-blank sellerText -> merges it with confirmed listing data via
//     enhanceDescription() above (seller's facts remain the source of
//     truth; can return null on provider failure - caller must then
//     preserve the seller's original text untouched).
//   - blank sellerText -> generates a fresh, grounded description straight
//     from confirmed listing data using the SAME chain already used
//     server-side at listing creation when no manual description was
//     given (generateEnglishDescription - Groq -> Gemini -> deterministic
//     template; never throws, always resolves to a non-empty, factual
//     string, so this branch is guaranteed non-null). `lang` ("en"/"bn",
//     the app's current UI language) only matters for this branch, since
//     there's no seller text to detect a language from - translated via
//     the existing translate() chain, falling back to the English draft
//     (still real, grounded text) if translation itself fails.
// ============================================================================
async function enhanceOrGenerateDescription(sellerText, property, lang) {
  const trimmed = (sellerText || "").trim();
  if (trimmed) {
    return enhanceDescription(trimmed, property);
  }

  const generated = await generateEnglishDescription(property);
  if (lang === "bn") {
    const translated = await translate(generated.text, "bn");
    if (translated) return translated;
  }
  return generated.text;
}

// ─── Translation prompt (shared by Groq and Gemini) ─────────────────────────
// Deliberately framed as translation-only, not rewriting - see rules below.
function buildTranslationPrompt(text, targetLang) {
  const targetLabel =
    targetLang === "bn"
      ? "natural Bangla suitable for Bangladesh property listing users"
      : "natural, professional English suitable for a real-estate listing";

  return `Translate the following real estate property description into ${targetLabel}.

Rules:
- Translate only - do not rewrite, summarize, embellish, or add commentary.
- Preserve the meaning exactly: add no new facts, remove no facts.
- Preserve all numbers exactly: prices, bedroom/bathroom counts, sqft/area values.
- Preserve addresses and proper place names sensibly - keep recognizable Bangladeshi place names in a form local property users would recognize; preserve Bangla place names as-is where appropriate rather than inventing a translation for them.
- Output ONLY the translated description text. No explanation, no markdown, no quotation marks.

Text to translate:
${text}`;
}

// ─── Primary generation: Groq (openai/gpt-oss-20b, low reasoning) ──────────
async function tryGroqGenerate(property, nearbyHighlights) {
  // 900: the target output grew from ~140 to ~260 words (professional,
  // multi-paragraph listing copy) plus low-reasoning-effort overhead.
  return callGroq(buildGenerationPrompt(property, nearbyHighlights), 900);
}

// ─── Fallback generation: Gemini (gemini-flash-lite-latest) ────────────────
async function tryGeminiGenerate(property, nearbyHighlights) {
  return callGemini(buildGenerationPrompt(property, nearbyHighlights));
}

// ============================================================================
// TRANSLATION OUTPUT QUALITY VALIDATOR
// ============================================================================
// Rare live-testing observations showed occasional malformed LLM translation
// output: a stray Unicode replacement character (U+FFFD, from a botched
// multi-byte sequence), or a single word that's part-Bengali/part-Latin with
// no separator (e.g. "ভাড়aya", "Dhanmondি") - a garbled token, not a
// legitimate bilingual phrase. This must never reach MongoDB, so both
// translation call sites are gated behind this before their result is
// accepted - a rejection here is treated exactly like a provider failure
// (falls through to the next provider in the chain).
//
// Deliberately conservative: normal bilingual sentences (separate English
// and Bangla words/tokens side by side, e.g. "Dhaka, ঢাকা" or "3 bedroom
// apartment in ধানমন্ডি") are always valid - only a single TOKEN mixing
// both scripts with no separator is rejected, and the target-language check
// only requires *some* meaningful script presence (not purity), so
// preserved proper nouns/addresses in the other script never trigger it.
//
// sourceText (optional): when supplied, also rejects a "fact-losing"
// translation - one where a number from the source (price, bedroom/
// bathroom count, sqft) doesn't appear anywhere in the output. Bengali and
// Latin digits are normalized before comparing, so "৪৫,০০০" correctly
// matches "45,000". Small counts (0-20) spelled as words in either language
// ("four-bedroom" / "চার-বেডরুম") are also recognized as equivalent to their
// digit form - see extractNumberWords below - since spelling out a small
// number is normal, fact-preserving prose, not a lost fact. Skipped
// entirely when sourceText isn't passed, so existing callers/tests that
// only check output validity are unaffected.
// ============================================================================
const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";
function normalizeDigits(text) {
  return text.replace(/[০-৯]/g, (d) => String(BENGALI_DIGITS.indexOf(d)));
}

// Small-count number words - 0-20 covers every realistic bedroom/bathroom/
// floor count in a listing. Recognized ONLY for the fact-comparison check
// below; the description text itself is never rewritten or normalized.
const EN_NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};
const BN_NUMBER_WORDS = {
  "শূন্য": 0,
  "এক": 1,
  "দুই": 2, "দুটি": 2,
  "তিন": 3,
  "চার": 4,
  "পাঁচ": 5,
  "ছয়": 6,
  "সাত": 7,
  "আট": 8,
  "নয়": 9,
  "দশ": 10,
  "এগারো": 11, "এগার": 11,
  "বারো": 12,
  "তেরো": 13, "তের": 13,
  "চৌদ্দ": 14,
  "পনেরো": 15, "পনের": 15,
  "ষোলো": 16, "ষোল": 16,
  "সতেরো": 17, "সতের": 17,
  "আঠারো": 18, "আঠার": 18,
  "উনিশ": 19,
  "বিশ": 20,
};
// Splits on the same whitespace/punctuation/hyphen boundaries as the
// mixed-script token check below, so hyphenated listing phrasing
// ("four-bedroom", "চার-বেডরুম") isolates the number word correctly.
// Whole-token match only (not substring), so e.g. "sixteen" never matches
// "six".
function extractNumberWords(text) {
  const tokens = text.split(/[\s,.।!?;:()'"“”–—-]+/).filter(Boolean);
  const found = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(EN_NUMBER_WORDS, lower)) {
      found.push(String(EN_NUMBER_WORDS[lower]));
    } else if (Object.prototype.hasOwnProperty.call(BN_NUMBER_WORDS, token)) {
      found.push(String(BN_NUMBER_WORDS[token]));
    }
  }
  return found;
}

function extractNumbers(text) {
  const normalized = normalizeDigits(text);
  // The decimal-point group requires at least one digit after the dot, so a
  // sentence-ending period right after a number (e.g. "...45,000. The...")
  // is never swallowed into the match.
  const matches = normalized.match(/\d[\d,]*(?:\.\d+)?/g) || [];
  const digitNumbers = matches
    .map((m) => m.replace(/,/g, ""))
    .filter((m) => m.length > 0);
  return digitNumbers.concat(extractNumberWords(text));
}
function preservesSourceNumbers(sourceText, translatedText) {
  const sourceNumbers = extractNumbers(sourceText);
  if (sourceNumbers.length === 0) return true; // nothing numeric to check
  const targetNumbers = new Set(extractNumbers(translatedText));
  return sourceNumbers.every((n) => targetNumbers.has(n));
}

function isValidTranslation(text, targetLang, sourceText) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false; // empty/whitespace-only

  if (trimmed.includes("�")) return false; // Unicode replacement character

  // Reject any single token (split on whitespace/punctuation) that mixes
  // Bengali-script and Latin-alphabet letters with no separator between them.
  const tokens = trimmed.split(/[\s,.।!?;:()'"“”–—-]+/).filter(Boolean);
  for (const token of tokens) {
    const hasBengali = /[ঀ-৿]/.test(token);
    const hasLatin = /[A-Za-z]/.test(token);
    if (hasBengali && hasLatin) return false;
  }

  // Conservative target-language sanity check: the output must contain at
  // least some script matching the requested target language. This only
  // catches a hard failure (e.g. Bangla requested but the response came
  // back in pure English) - it does not require purity, so preserved
  // English proper nouns inside a Bangla translation (or vice versa) never
  // fail this check on their own.
  const hasBengaliScript = /[ঀ-৿]/.test(trimmed);
  const hasLatinScript = /[A-Za-z]/.test(trimmed);
  if (targetLang === "bn" && !hasBengaliScript) return false;
  if (targetLang === "en" && !hasLatinScript) return false;

  if (typeof sourceText === "string" && !preservesSourceNumbers(sourceText, trimmed)) {
    return false;
  }

  return true;
}

// ─── Primary translation: Gemini ────────────────────────────────────────────
async function tryGeminiTranslate(text, targetLang) {
  const result = await callGemini(buildTranslationPrompt(text, targetLang));
  if (result && isValidTranslation(result, targetLang, text)) return result;
  if (result) {
    console.warn(
      "[PropertyDescription] Rejected malformed Gemini translation output (quality validator)."
    );
  }
  return null;
}

// ─── Fallback translation: Groq ─────────────────────────────────────────────
async function tryGroqTranslate(text, targetLang) {
  const result = await callGroq(buildTranslationPrompt(text, targetLang), 900);
  if (result && isValidTranslation(result, targetLang, text)) return result;
  if (result) {
    console.warn(
      "[PropertyDescription] Rejected malformed Groq translation output (quality validator)."
    );
  }
  return null;
}

// ─── Shared low-level Groq caller (generation and translation both use it) ─
async function callGroq(prompt, maxTokens) {
  if (!GROQ_API_KEY) return null;
  const payload = {
    model: "openai/gpt-oss-20b",
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    // 0.4: lowered from 0.7 after live testing showed the higher value let
    // the model invent extra nearby places/amenities beyond the verified
    // POI list even with explicit prompt instructions not to - a lower
    // temperature measurably reduces that tendency while still producing
    // natural-sounding prose (translation quality also benefits, since
    // "translate only, don't embellish" wants less creative sampling too).
    temperature: 0.4,
    reasoning_effort: "low",
  };
  const headers = {
    Authorization: `Bearer ${GROQ_API_KEY}`,
    "Content-Type": "application/json",
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await axios.post(GROQ_API_URL, payload, {
        headers,
        timeout: 15000,
      });
      const content = res.data?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.trim()) {
        return content.trim();
      }
      return null; // Empty/invalid content = treat provider as failed, no retry.
    } catch (error) {
      const status = error.response?.status;
      const isRetryable = status === 429 || (status >= 500 && status < 600);
      if (isRetryable && attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      // error.message only - never log the full error object, which would
      // embed the Authorization: Bearer <GROQ_API_KEY> header on failure.
      console.error("[PropertyDescription] Groq error:", error.message);
      return null;
    }
  }
  return null;
}

// ─── Shared low-level Gemini caller (generation and translation both use it) ─
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) return null;
  try {
    const res = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        // Matches Groq's temperature (see callGroq) - lower sampling
        // temperature measurably reduced invented nearby-place mentions
        // during live testing, for both providers.
        generationConfig: { temperature: 0.4 },
      },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );
    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text === "string" && text.trim()) {
      return text.trim();
    }
    return null;
  } catch (error) {
    // error.message only - the request URL includes the Gemini key as a
    // query parameter, so the full error object must never be logged.
    console.error("[PropertyDescription] Gemini error:", error.message);
    return null;
  }
}

// ─── Last-resort fallback: deterministic local template ────────────────────
// Zero external services. Only uses fields that are actually present -
// never prints "undefined"/"null"/empty commas/invented facts.
// Zero-AI fallback (Groq and Gemini both unreachable) - still follows the
// same two-paragraph structure as the AI prompts (DESCRIPTION_STRUCTURE_RULES
// above): paragraph 1 is the property itself, paragraph 2 is location/
// access/nearby. Deliberately template-based, not AI-written, so it only
// ever states a fact when the corresponding field is actually present -
// never invents anything, same guarantee as before this was expanded.
function buildDeterministicDescription(property, nearbyHighlights) {
  const isLandOrCommercial =
    property.propertyType === "land" || property.propertyType === "commercial";
  const listingWord = property.listingType === "rent" ? "rent" : "sale";
  const typeLabel = property.propertyType || "property";
  const bd = property.bangladeshDetails || {};
  const f = property.features || {};

  // ── Paragraph 1: the property itself ──────────────────────────────────
  const p1 = [];

  const locationParts = [
    property.upazila,
    property.cityTown,
    property.district,
  ].filter(Boolean);
  const locationStr = locationParts.length > 0 ? locationParts.join(", ") : "";

  let opening = `This ${typeLabel} is available for ${listingWord}`;
  if (locationStr) opening += ` in ${locationStr}`;
  opening += ".";
  p1.push(opening);

  const sizeDetails = [];
  if (!isLandOrCommercial && property.bedrooms) {
    sizeDetails.push(
      `${property.bedrooms} bedroom${property.bedrooms > 1 ? "s" : ""}`
    );
  }
  if (!isLandOrCommercial && property.bathrooms) {
    sizeDetails.push(
      `${property.bathrooms} bathroom${property.bathrooms > 1 ? "s" : ""}`
    );
  }
  if (property.area) {
    sizeDetails.push(`${property.area} sqft`);
  }
  if (sizeDetails.length > 0) {
    p1.push(`It offers ${sizeDetails.join(", ")}.`);
  }

  if (property.price) {
    const priceStr = Number(property.price).toLocaleString();
    p1.push(
      `Priced at ${priceStr} BDT${
        property.listingType === "rent" ? " per month" : ""
      }.`
    );
  }

  if (bd.propertyCondition) {
    const conditionLabel = {
      new: "newly built",
      under_construction: "under construction",
      resale: "a resale",
    }[bd.propertyCondition];
    if (conditionLabel) p1.push(`It is ${conditionLabel}.`);
  }

  const featureNames = [];
  if (f.furnished && f.furnished !== "no")
    featureNames.push(`${f.furnished === "full" ? "fully" : "semi"} furnished`);
  if (f.parking) featureNames.push("parking");
  if (f.garden) featureNames.push("a garden");
  if (f.airConditioning) featureNames.push("air conditioning");
  if (f.pool) featureNames.push("a pool");
  if (bd.balcony === "yes") featureNames.push("a balcony");
  if (bd.rooftopAccess === "yes") featureNames.push("rooftop access");
  if (featureNames.length > 0) {
    p1.push(`The property includes ${featureNames.join(", ")}.`);
  }

  const utilityNames = [];
  if (bd.waterSource) {
    const waterLabel = { wasa: "WASA water", deep_tube_well: "a deep tube well", both: "WASA and a deep tube well", other: "a water supply" }[bd.waterSource];
    if (waterLabel) utilityNames.push(waterLabel);
  }
  if (bd.gasSource && bd.gasSource !== "none") {
    const gasLabel = { piped: "piped gas", cylinder: "cylinder gas" }[bd.gasSource];
    if (gasLabel) utilityNames.push(gasLabel);
  }
  if (bd.backupPower && bd.backupPower !== "none") {
    const powerLabel = { ips: "IPS backup power", generator: "generator backup power", solar: "solar backup power" }[bd.backupPower];
    if (powerLabel) utilityNames.push(powerLabel);
  }
  if (utilityNames.length > 0) {
    p1.push(`Utilities include ${utilityNames.join(", ")}.`);
  }

  if (Array.isArray(bd.securityFeatures) && bd.securityFeatures.length > 0) {
    const securityLabel = { gated: "a gated community", guards: "security guards", cctv: "CCTV" };
    const names = bd.securityFeatures.map((s) => securityLabel[s]).filter(Boolean);
    if (names.length > 0) p1.push(`Security includes ${names.join(", ")}.`);
  }

  if (bd.ownershipPapers === "clear") {
    p1.push("Ownership papers are clear.");
  }

  // ── Paragraph 2: location, access, and nearby information ─────────────
  const p2 = [];

  if (property.addressLine1) {
    p2.push(`The property is located at ${property.addressLine1}.`);
  }

  const accessDetails = [];
  if (bd.proximityToMainRoad) accessDetails.push(bd.proximityToMainRoad);
  if (bd.roadWidth) accessDetails.push(`a ${bd.roadWidth} wide road`);
  if (accessDetails.length > 0) {
    p2.push(`It has ${accessDetails.join(" and ")}.`);
  }

  if (bd.naturalLight) {
    p2.push(`Natural light/ventilation is described as ${bd.naturalLight}.`);
  }

  const nearby = [
    bd.nearbySchools && `schools (${bd.nearbySchools})`,
    bd.nearbyHospitals && `hospitals (${bd.nearbyHospitals})`,
    bd.nearbyMarkets && `markets (${bd.nearbyMarkets})`,
    bd.nearbyReligiousPlaces && `religious places (${bd.nearbyReligiousPlaces})`,
    bd.nearbyOthers && `other amenities (${bd.nearbyOthers})`,
  ].filter(Boolean);
  if (nearby.length > 0) {
    p2.push(`Nearby: ${nearby.join(", ")}.`);
  }

  // Verified real nearby places (poiService, see getNearbyPOIHighlights) -
  // separate sentence from the seller-supplied bd.nearby* fields above,
  // since these come from a different, independently-verified source.
  if (Array.isArray(nearbyHighlights) && nearbyHighlights.length > 0) {
    const poiPhrases = nearbyHighlights.map(
      (h) => `${h.name} (${h.label.toLowerCase()}, ~${h.distanceMeters}m away)`
    );
    p2.push(`Also close by: ${poiPhrases.join(", ")}.`);
  }

  const paragraphs = [p1.join(" "), p2.join(" ")].filter((p) => p.trim());
  return paragraphs.join("\n\n");
}

// ─── Generation provider chain ──────────────────────────────────────────────
// Never throws. Always resolves to a non-empty string (deterministic
// template is the guaranteed floor). Fetches nearby-POI highlights once
// (read-only DB lookup, see getNearbyPOIHighlights) and reuses the same
// result across every provider attempt, so a Groq->Gemini fallback doesn't
// re-query POIs twice for the same property.
async function generateEnglishDescription(property) {
  const nearbyHighlights = await getNearbyPOIHighlights(property);

  let text = await tryGroqGenerate(property, nearbyHighlights);
  if (text) return { text, source: "groq" };

  text = await tryGeminiGenerate(property, nearbyHighlights);
  if (text) return { text, source: "gemini" };

  return {
    text: buildDeterministicDescription(property, nearbyHighlights),
    source: "deterministic",
  };
}

// ─── Translation provider chain ─────────────────────────────────────────────
// targetLang: "en" or "bn". Never throws. Returns "" (not null) on total
// failure so callers can treat it uniformly as "no translation available."
async function translate(text, targetLang) {
  if (!text) return "";

  let result = await tryGeminiTranslate(text, targetLang);
  if (result) return result;

  result = await tryGroqTranslate(text, targetLang);
  if (result) return result;

  // Both providers failed on the first pass. For a brand-new listing, this
  // call typically runs moments after generateEnglishDescription() already
  // made its own Groq call for the same request - if Groq is momentarily
  // rate-limited from that back-to-back usage (and Gemini is unavailable,
  // e.g. an invalid/expired key), both providers can fail here even though
  // either would normally succeed a moment later. One retry after a short
  // delay gives that transient collision time to clear before this
  // property permanently ends up with no Bangla (or English) translation.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  result = await tryGeminiTranslate(text, targetLang);
  if (result) return result;

  result = await tryGroqTranslate(text, targetLang);
  if (result) return result;

  return "";
}

// ─── Build all three description fields from a seller-written manual text ──
// Detects whether the seller wrote in English or Bangla and translates only
// the missing direction - the seller's own text is never altered or
// discarded, byte-for-byte (only the trim already applied by the caller).
async function buildFromManualDescription(manualText) {
  const sourceLang = detectLanguage(manualText);

  if (sourceLang === "bn") {
    const description_bn = manualText;
    const description_en = await translate(manualText, "en");
    return {
      description_en, // "" if both translators failed
      description_bn,
      // Legacy field: prefer the English translation when it succeeded;
      // if translation failed, preserve the seller's original Bangla text
      // here rather than leaving the legacy field empty/lost.
      description: description_en || description_bn,
      sourceLang,
    };
  }

  const description_en = manualText;
  const description_bn = await translate(manualText, "bn");
  return {
    description_en,
    description_bn, // "" if both translators failed
    description: description_en,
    sourceLang,
  };
}

// ─── Top-level entry point used by propertyController.js on create ────────
// manualDescription: the seller's own typed text, if any (already trimmed
// by the caller). If present, AI generation is never called to overwrite
// it - only translation runs, in whichever direction is needed. If left
// blank, the Groq -> Gemini -> deterministic-template chain generates an
// English description, which is then translated to Bangla.
async function buildBilingualDescription(property, manualDescription) {
  if (manualDescription) {
    const result = await buildFromManualDescription(manualDescription);
    return {
      description: result.description,
      description_en: result.description_en,
      description_bn: result.description_bn,
      source: result.sourceLang === "bn" ? "manual-bn" : "manual-en",
    };
  }

  const generated = await generateEnglishDescription(property);
  const description_bn = await translate(generated.text, "bn");
  return {
    description: generated.text,
    description_en: generated.text,
    description_bn,
    source: generated.source,
  };
}

module.exports = {
  detectLanguage,
  translate,
  buildBilingualDescription,
  buildFromManualDescription,
  generateEnglishDescription,
  buildDeterministicDescription,
  isValidTranslation,
  getNearbyPOIHighlights,
  enhanceDescription,
  enhanceOrGenerateDescription,
};
