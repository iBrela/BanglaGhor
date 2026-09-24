// ============================================================================
// RAG SERVICE - BanglaGhor (Geographic Relevance Engine)
// ============================================================================
// Approach: Find properties CLOSEST to user's requested location.
// Progressive radius expansion: 10 km → 25 km → 50 km → 100 km
// Only shows properties that are geographically relevant (same region).
// Never jumps to a different part of Bangladesh.
// ============================================================================

const Groq = require("groq-sdk");
const Property = require("../models/property");
const locationService = require("./locationService");
const recommendationService = require("./recommendationService");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const CONFIG = {
  // llama-3.3-70b-versatile was decommissioned by Groq (model_not_found).
  // openai/gpt-oss-120b is a reasoning model - it spends completion tokens
  // on an internal "reasoning" pass before the actual reply text, so
  // reasoning_effort: "low" below is required, not optional, to leave
  // enough of MAX_TOKENS for the real reply.
  MODEL: "openai/gpt-oss-120b",
  TEMPERATURE: 0.3,
  MAX_TOKENS: 500,

  // Progressive radius tiers (km)
  RADIUS_TIERS: [
    { km: 10, label: "very_close" },    // "near" your location
    { km: 25, label: "close" },          // "close to" your location
    { km: 50, label: "nearby" },         // "in the area"
    { km: 100, label: "regional" },      // "in the surrounding region"
  ],

  MAX_RESULTS: 5,
  MIN_ACCEPTABLE_RESULTS: 1,  // If we get at least this many at a tier, stop expanding
};

// ============================================================================
// QUERY BUILDER
// ============================================================================
function buildBaseQuery(intent) {
  var query = {
    listingStatus: { $in: ["available"] },
    isHidden: { $ne: true },
    isDeleted: { $ne: true },
  };

  var filters = intent.filters || {};

  if (filters.propertyType) query.propertyType = filters.propertyType;
  if (filters.listingType) query.listingType = filters.listingType;

  if (filters.bedrooms !== null && filters.bedrooms !== undefined) {
    query.bedrooms = { $gte: filters.bedrooms };
  }
  if (filters.bathrooms !== null && filters.bathrooms !== undefined) {
    query.bathrooms = { $gte: filters.bathrooms };
  }

  var priceFilter = {};
  if (filters.minPrice !== null && filters.minPrice !== undefined) {
    priceFilter.$gte = filters.minPrice;
  }
  if (filters.maxPrice !== null && filters.maxPrice !== undefined) {
    priceFilter.$lte = filters.maxPrice;
  }
  if (Object.keys(priceFilter).length > 0) {
    query.price = priceFilter;
  }

  return query;
}

// ============================================================================
// SEARCH: Within a specific radius
// ============================================================================
async function searchWithinRadius(intent, centerCoords, radiusKm, withFilters) {
  var query = withFilters
    ? buildBaseQuery(intent)
    : { listingStatus: { $in: ["available"] }, isHidden: { $ne: true }, isDeleted: { $ne: true } };

  // Only keep listingType when relaxing
  if (!withFilters && intent.filters && intent.filters.listingType) {
    query.listingType = intent.filters.listingType;
  }

  query.geoLocation = {
    $near: {
      $geometry: { type: "Point", coordinates: centerCoords },
      $maxDistance: radiusKm * 1000,
    },
  };

  var results = await Property.find(query).limit(CONFIG.MAX_RESULTS).lean();
  return results;
}

// ============================================================================
// SEARCH: Progressive expansion (10 → 25 → 50 → 100 km)
// ============================================================================
async function searchProgressively(intent, centerCoords) {
  // ─── Try each radius tier WITH filters first ─────────────────────
  for (var i = 0; i < CONFIG.RADIUS_TIERS.length; i++) {
    var tier = CONFIG.RADIUS_TIERS[i];
    console.log("[RAG] Trying radius " + tier.km + " km WITH filters");
    var results = await searchWithinRadius(intent, centerCoords, tier.km, true);
    console.log("[RAG] -> Found " + results.length + " properties");

    if (results.length >= CONFIG.MIN_ACCEPTABLE_RESULTS) {
      return { properties: results, matchedRadius: tier.km, matchedLabel: tier.label, filtersUsed: true };
    }
  }

  // ─── If filters yielded nothing, retry tiers WITHOUT strict filters ──
  for (var j = 0; j < CONFIG.RADIUS_TIERS.length; j++) {
    var tier2 = CONFIG.RADIUS_TIERS[j];
    console.log("[RAG] Trying radius " + tier2.km + " km WITHOUT filters (relaxed)");
    var results2 = await searchWithinRadius(intent, centerCoords, tier2.km, false);
    console.log("[RAG] -> Found " + results2.length + " properties");

    if (results2.length >= CONFIG.MIN_ACCEPTABLE_RESULTS) {
      return { properties: results2, matchedRadius: tier2.km, matchedLabel: tier2.label, filtersUsed: false };
    }
  }

  // ─── Nothing found anywhere in 100 km ─────────────────────────────
  return { properties: [], matchedRadius: null, matchedLabel: "no_match", filtersUsed: false };
}

// ============================================================================
// ADD DISTANCE INFO TO PROPERTIES
// ============================================================================
function addDistanceInfo(properties, centerCoords) {
  if (!properties || properties.length === 0) return [];
  return properties.map(function (prop) {
    var distanceKm = null;
    if (centerCoords && prop.geoLocation && prop.geoLocation.coordinates) {
      distanceKm = locationService.getDistanceKm(centerCoords, prop.geoLocation.coordinates);
    }
    return Object.assign({}, prop, {
      _distanceKm: distanceKm !== null ? parseFloat(distanceKm.toFixed(2)) : null,
    });
  });
}

// ============================================================================
// AI REPLY GENERATION
// ============================================================================
async function generateReply(params) {
  var userMessage = params.userMessage;
  var locationName = params.locationName;
  var properties = params.properties || [];
  var matchedRadius = params.matchedRadius;
  var matchedLabel = params.matchedLabel;
  var filtersUsed = params.filtersUsed;
  var language = params.language;
  // Only present when the user actually requested amenities (see runRAG) -
  // when absent/empty, every amenity-specific line below is skipped, so the
  // prompt text is byte-identical to before this feature existed.
  var amenities = params.amenities || [];
  var amenitiesRequested = amenities.length > 0;

  var hasResults = properties.length > 0;

  // ─── Language instruction ───────────────────────────────────────
  var langInstruction;
  if (language === "bn") {
    langInstruction =
      "CRITICAL: Respond ENTIRELY in Bangla (Bengali script). " +
      "Use natural conversational Bangla. Use ৳ for currency.";
  } else if (language === "banglish") {
    langInstruction =
      "CRITICAL: Respond in Banglish (Bangla written using English letters). " +
      "Keep it casual and friendly.";
  } else {
    langInstruction =
      "Respond in clear, professional English. Do NOT mix Bangla or Banglish.";
  }

  // ─── Match context ──────────────────────────────────────────────
  var matchContext;
  if (!hasResults) {
    matchContext = "NO PROPERTIES were found within 100 km of " + locationName + ".";
  } else if (matchedLabel === "very_close") {
    matchContext = "Found " + properties.length + " properties WITHIN 10 KM of " + locationName + ". These are very close.";
  } else if (matchedLabel === "close") {
    matchContext = "Found " + properties.length + " properties WITHIN 25 KM of " + locationName + ". Not super close, but in the area.";
  } else if (matchedLabel === "nearby") {
    matchContext = "Found " + properties.length + " properties WITHIN 50 KM of " + locationName + ". A bit far but in the surrounding area.";
  } else if (matchedLabel === "regional") {
    matchContext = "Found " + properties.length + " properties WITHIN 100 KM of " + locationName + ". Same region.";
  }

  if (!filtersUsed && hasResults) {
    matchContext += " Note: Some of the user's filters were relaxed to find matches.";
  }

  // ─── Build property context (no IDs!) ───────────────────────────
  var contextLines = [];
  properties.forEach(function (p, idx) {
    var line = (idx + 1) + ". " + p.title;
    var locParts = [p.cityTown, p.district].filter(Boolean).join(", ");
    if (locParts) line += " — " + locParts;
    var priceStr = "৳" + (p.price ? p.price.toLocaleString() : "N/A");
    if (p.listingType === "rent") priceStr += "/month";
    line += " — " + priceStr;
    if (p.bedrooms) line += " — " + p.bedrooms + " bedroom";
    if (p._distanceKm !== null && p._distanceKm !== undefined) {
      line += " — " + p._distanceKm.toFixed(1) + " km from " + locationName;
    }
    contextLines.push(line);

    // Amenity evidence lines - ONLY real, backend-computed facts (see
    // recommendationService.js). Never invents a POI or a distance: a
    // requested category with no real nearby match is listed as NOT
    // VERIFIED, never silently omitted or guessed at.
    if (amenitiesRequested && Array.isArray(p._amenityMatches)) {
      if (p._hasVerifiableLocation === false) {
        contextLines.push("   (this property's location is not precise enough to verify nearby amenities)");
      }
      p._amenityMatches.forEach(function (m) {
        if (m.matched) {
          var poiName = m.nearestPOI.name || ("a nearby " + m.category.replace(/_/g, " "));
          // Geospatial (straight-line) distance is always shown - the only
          // fact ragService itself guarantees for every match. Travel time
          // is appended ONLY when recommendationService's Valhalla
          // enrichment actually succeeded for this exact POI - never
          // estimated, never derived from the straight-line figure.
          var line = "   - " + m.category + ": VERIFIED nearby — " + poiName +
            " (" + m.nearestPOI.distanceMeters + "m away geographically";
          if (m.travel && typeof m.travel.durationMinutes === "number") {
            line += ", ~" + m.travel.durationMinutes + " min " + m.travel.mode + " per routing service";
          }
          line += ")";
          contextLines.push(line);
        } else {
          var withinNote = m.requestedMaxDistanceKm
            ? " within " + m.requestedMaxDistanceKm + " km"
            : "";
          contextLines.push(
            "   - " + m.category + ": NOT VERIFIED nearby" + withinNote + " (no matching real data found)"
          );
        }
      });
    }
  });

  var propertyContext = contextLines.length > 0
    ? contextLines.join("\n")
    : "(No properties available to show)";

  // ─── System prompt ──────────────────────────────────────────────
  var systemPrompt = [
    "You are BanglaGhor AI, a real estate assistant for Bangladesh.",
    "",
    "TONE: Warm, honest, professional. Like a trusted local friend.",
    "",
    "LANGUAGE: " + langInstruction,
    "",
    "ABSOLUTE RULES (NEVER VIOLATE):",
    "1. NEVER mention MongoDB IDs, property codes, or strings like '69e891c414e1...'.",
    "2. Refer to properties ONLY by location and type (e.g., 'the apartment in Gulshan').",
    "3. Be HONEST about distance. If properties are far, say so naturally.",
    "4. Keep reply SHORT — maximum 3 sentences.",
    "5. Format prices: '৳45,000/month' — never raw numbers.",
  ].concat(
    amenitiesRequested
      ? [
          "6. Only mention a nearby amenity/POI if its line above says VERIFIED nearby - never invent or assume one.",
          "7. Only state the exact distance given next to a VERIFIED amenity (e.g. '420m away') - never estimate.",
          "8. If an amenity is marked NOT VERIFIED nearby, honestly tell the user it could not be confirmed near that property - never imply it matched.",
          "9. The properties above are already ranked by how well they match the requested amenities - present them in that order; do not re-rank or reorder them yourself.",
          "10. Only mention a travel time (e.g. '~5 min driving') if it appears explicitly next to a VERIFIED amenity above - never estimate one, and never convert the geographic meters distance into a travel time yourself. If no travel time is shown, only mention the geographic distance.",
        ]
      : []
  ).concat([
    "",
    "SITUATION:",
    matchContext,
    "",
    "REPLY GUIDELINES:",
    hasResults
      ? (matchedLabel === "very_close"
          ? "- Acknowledge what user wanted near " + locationName + ".\n" +
            "- Highlight the top property by area/type.\n" +
            "- Close with a brief helpful question."
          : "- Be HONEST: say you couldn't find very close matches but found some in the area.\n" +
            "- Briefly mention 1 of the closest properties.\n" +
            "- Close with a question.")
      : "- Be HONEST: say no properties were found within 100 km of " + locationName + ".\n" +
        "- Suggest the user try a major city or adjust their budget.",
  ]).join("\n");

  var userPrompt =
    "USER MESSAGE: \"" + userMessage + "\"\n" +
    "SEARCH LOCATION: " + locationName + "\n\n" +
    "PROPERTIES FOUND:\n" + propertyContext + "\n\n" +
    "Respond honestly and concisely.";

  try {
    var completion = await groq.chat.completions.create({
      model: CONFIG.MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: CONFIG.TEMPERATURE,
      max_tokens: CONFIG.MAX_TOKENS,
      reasoning_effort: "low",
    });

    var reply = completion.choices[0] && completion.choices[0].message
      ? completion.choices[0].message.content.trim()
      : null;

    return reply || buildFallbackReply(hasResults, matchedLabel, locationName, language);
  } catch (error) {
    console.error("[RAG] Generation error:", error.message);
    return buildFallbackReply(hasResults, matchedLabel, locationName, language);
  }
}

// ============================================================================
// FALLBACK REPLY (if AI fails)
// ============================================================================
function buildFallbackReply(hasResults, matchedLabel, locationName, language) {
  if (language === "bn") {
    if (!hasResults) return locationName + " এর ১০০ কিমির মধ্যে কোনো প্রপার্টি পাইনি। বড় শহর চেষ্টা করুন।";
    if (matchedLabel === "very_close") return locationName + " এর কাছে কিছু প্রপার্টি পেয়েছি।";
    return locationName + " এর কাছে নেই, তবে আশেপাশের এলাকায় কিছু পেয়েছি।";
  }
  if (language === "banglish") {
    if (!hasResults) return locationName + " er 100 km er moddhe kono property pai nai. Boro shohor try korun.";
    if (matchedLabel === "very_close") return locationName + " er kache kichu property pelam.";
    return locationName + " er kache nai, kintu ashe pashe kichu pelam.";
  }
  if (!hasResults) return "I couldn't find any properties within 100 km of " + locationName + ". Try searching a major city.";
  if (matchedLabel === "very_close") return "Found some properties near " + locationName + ". Take a look below.";
  return "Couldn't find anything very close to " + locationName + ", but here are some in the surrounding area.";
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================
async function runRAG(params) {
  var userMessage = params.userMessage;
  var intent = params.intent;

  console.log("\n[RAG] ═══ Starting RAG Pipeline ═══");
  console.log("[RAG] User message: \"" + userMessage + "\"");
  console.log("[RAG] Language: " + intent.language);

  // ─── GREETING ───────────────────────────────────────────────────
  if (intent.intent === "greeting") {
    var greeting;
    if (intent.language === "bn") {
      greeting = "আসসালামু আলাইকুম! আমি BanglaGhor AI। আপনি কেমন বাড়ি খুঁজছেন? এলাকা, বাজেট, বা বেডরুম সংখ্যা বলুন।";
    } else if (intent.language === "banglish") {
      greeting = "Assalamu Alaikum! Ami BanglaGhor AI. Apnar kemon basha lagbe? Area, budget, ba bedroom number bolun.";
    } else {
      greeting = "Hello! I'm BanglaGhor AI. What kind of property are you looking for? Tell me the area, budget, or bedroom count.";
    }
    return {
      reply: greeting,
      properties: [],
      metadata: { intent: "greeting", language: intent.language },
    };
  }

  // ─── STEP 1: GEOCODE ────────────────────────────────────────────
  var centerCoords = null;
  var geocodedLocation = null;
  var locationName = null;

  var rawLandmark = (intent.location && intent.location.landmark)
    || (intent.location && intent.location.area)
    || (intent.location && intent.location.district);

  if (rawLandmark) {
    console.log("[RAG] Geocoding: \"" + rawLandmark + "\"");
    geocodedLocation = await locationService.geocode(rawLandmark);
    if (geocodedLocation) {
      centerCoords = geocodedLocation.coords;
      locationName = geocodedLocation.name || rawLandmark;
      console.log("[RAG] Geocoded: \"" + locationName + "\" [" + centerCoords + "]");
    } else {
      locationName = rawLandmark;
      console.log("[RAG] Geocoding FAILED for: " + rawLandmark);
    }
  }

  // ─── STEP 2: PROGRESSIVE SEARCH ─────────────────────────────────
  var searchResult = { properties: [], matchedRadius: null, matchedLabel: "no_location", filtersUsed: true };

  if (centerCoords) {
    searchResult = await searchProgressively(intent, centerCoords);
  } else {
    // No geocoded location → just do a basic filter search anywhere
    console.log("[RAG] No coordinates available. Doing basic filter search.");
    var basicQuery = buildBaseQuery(intent);
    var basicResults = await Property.find(basicQuery).limit(CONFIG.MAX_RESULTS).lean();
    if (basicResults.length === 0) {
      basicResults = await Property.find({
        listingStatus: { $in: ["available"] },
        isHidden: { $ne: true },
        isDeleted: { $ne: true },
      }).limit(CONFIG.MAX_RESULTS).lean();
    }
    searchResult = {
      properties: basicResults,
      matchedRadius: null,
      matchedLabel: basicResults.length > 0 ? "regional" : "no_match",
      filtersUsed: true,
    };
  }

  // ─── STEP 3: ADD DISTANCES ──────────────────────────────────────
  var properties = addDistanceInfo(searchResult.properties, centerCoords);

  // ─── STEP 3.5: AMENITY-AWARE ANALYSIS + DETERMINISTIC RANKING ──────
  // Only runs when the user actually requested amenities - a normal search
  // never pays this cost and the reply prompt below stays byte-identical to
  // before. Ranking is computed entirely from real property/POI data here
  // (recommendationService.js) - the LLM below only ever explains it.
  var amenities = (intent.amenities && intent.amenities.length > 0) ? intent.amenities : [];
  if (amenities.length > 0 && properties.length > 0) {
    var evidenceList = await recommendationService.analyzeCandidates(properties, amenities);
    // Travel-time refinement (Valhalla) - optional, additive, non-fatal.
    // Only routes to amenities that already matched geospatially above;
    // never changes matched/unmatched; a Valhalla failure just leaves
    // every amenityMatches[].travel as null (see recommendationService.js's
    // enrichWithTravelTime for the full failure-handling rationale). Must
    // run BEFORE ranking, since rankEvidence uses travel data as a tie-break.
    evidenceList = await recommendationService.enrichWithTravelTime(evidenceList);
    var ranked = recommendationService.rankEvidence(evidenceList);
    // Reorder `properties` to the deterministic ranking and attach each
    // property's evidence directly onto it (same underscore-prefixed
    // convention as _distanceKm/_matchType below), so the existing response
    // shape/contract is unchanged - old consumers ignoring these fields see
    // no difference, and the existing frontend property cards keep working.
    properties = ranked.map(function (ev) {
      return Object.assign({}, ev.property, {
        _amenityMatches: ev.amenityMatches,
        _matchedAmenityCount: ev.matchedAmenityCount,
        _requestedAmenityCount: ev.requestedAmenityCount,
        _hasVerifiableLocation: ev.hasVerifiableLocation,
      });
    });
  }

  // ─── STEP 4: GENERATE REPLY ─────────────────────────────────────
  var reply = await generateReply({
    userMessage: userMessage,
    locationName: locationName || "your area",
    properties: properties,
    matchedRadius: searchResult.matchedRadius,
    matchedLabel: searchResult.matchedLabel,
    filtersUsed: searchResult.filtersUsed,
    language: intent.language,
    amenities: amenities,
  });

  // ─── STEP 5: TAG PROPERTIES BY MATCH QUALITY ────────────────────
  var taggedProperties = properties.map(function (p) {
    var matchType = "regional";
    if (p._distanceKm !== null && p._distanceKm !== undefined) {
      if (p._distanceKm <= 10) matchType = "very_close";
      else if (p._distanceKm <= 25) matchType = "close";
      else if (p._distanceKm <= 50) matchType = "nearby";
      else matchType = "regional";
    }
    return Object.assign({}, p, { _matchType: matchType });
  });

  console.log("[RAG] Final: " + taggedProperties.length + " properties, matched radius: " + searchResult.matchedRadius + " km");
  console.log("[RAG] ═══ Pipeline Complete ═══\n");

  return {
    reply: reply,
    properties: taggedProperties,
    metadata: {
      intent: intent.intent,
      language: intent.language,
      locationName: locationName,
      geocodedLocation: geocodedLocation
        ? { name: geocodedLocation.name, coords: geocodedLocation.coords }
        : null,
      matchedRadius: searchResult.matchedRadius,
      matchedLabel: searchResult.matchedLabel,
      filtersUsed: searchResult.filtersUsed,
      propertyCount: taggedProperties.length,
      // Backward-compatible addition: existing consumers that ignore this
      // (and the per-property _amenityMatches/_matchedAmenityCount fields
      // above) see no change at all.
      amenitiesRequested: amenities.length > 0,
    },
  };
}

module.exports = {
  runRAG: runRAG,
};