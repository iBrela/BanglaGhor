// ============================================================================
// AI CONTROLLER - Main Entry Point for AI Features
// ============================================================================
// Handles two AI-powered endpoints:
//
//   1. POST /api/ai/generate-description
//      → AI-generated property descriptions (NVIDIA + Google Translate)
//      → Used by listing form
//
//   2. POST /api/ai/chatbot
//      → Smart conversational property search (RAG architecture)
//      → Used by AIChatbot.js on the frontend
//      → Orchestrates: intentService → ragService → response
// ============================================================================

const axios = require("axios");

// ─── Services ─────────────────────────────────────────────────────────────
const intentService = require("../services/intentService");
const ragService = require("../services/ragService");

// ─── Environment Variables ────────────────────────────────────────────────
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const GOOGLE_TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY;
const GOOGLE_TRANSLATE_URL =
  "https://translation.googleapis.com/language/translate/v2";

// ============================================================================
// SECTION 1: HELPER FUNCTIONS (for property description generation)
// ============================================================================

const getSafe = (obj, path, defaultValue = "N/A") => {
  const keys = path.split(".");
  let result = obj;
  for (const key of keys) {
    if (result && typeof result === "object" && key in result) {
      result = result[key];
    } else {
      return defaultValue;
    }
  }
  return result !== null && result !== undefined && result !== ""
    ? result
    : defaultValue;
};

const formatFeaturesForPrompt = (features = {}) => {
  let featureString = "";
  if (features.parking === true) featureString += "- Parking Available\n";
  if (features.garden === true) featureString += "- Garden Area\n";
  if (features.airConditioning === true)
    featureString += "- Air Conditioning\n";
  if (features.pool === true) featureString += "- Swimming Pool\n";
  if (features.furnished && features.furnished !== "no")
    featureString += `- Furnished: ${features.furnished}\n`;
  return featureString || "N/A";
};

const formatBangladeshDetailsForPrompt = (bdDetails = {}) => {
  let detailString = "";
  if (getSafe(bdDetails, "propertyCondition") !== "N/A")
    detailString += `- Condition: ${getSafe(bdDetails, "propertyCondition")}\n`;
  if (getSafe(bdDetails, "waterSource") !== "N/A")
    detailString += `- Water Source: ${getSafe(bdDetails, "waterSource")}\n`;
  if (getSafe(bdDetails, "gasSource") !== "N/A")
    detailString += `- Gas Source: ${getSafe(bdDetails, "gasSource")} ${
      bdDetails.gasSource === "piped"
        ? `(Line Installed: ${getSafe(
            bdDetails,
            "gasLineInstalled",
            "Unknown"
          )})`
        : ""
    }\n`;
  if (
    getSafe(bdDetails, "backupPower") !== "N/A" &&
    getSafe(bdDetails, "backupPower") !== "none"
  )
    detailString += `- Backup Power: ${getSafe(bdDetails, "backupPower")}\n`;
  if (
    getSafe(bdDetails, "parkingType") !== "N/A" &&
    getSafe(bdDetails, "parkingType") !== "none"
  )
    detailString += `- Parking: ${getSafe(bdDetails, "parkingType")}\n`;
  if (
    Array.isArray(bdDetails.securityFeatures) &&
    bdDetails.securityFeatures.length > 0
  )
    detailString += `- Security: ${bdDetails.securityFeatures.join(", ")}\n`;
  if (getSafe(bdDetails, "nearbySchools") !== "N/A")
    detailString += `- Nearby Schools: ${getSafe(bdDetails, "nearbySchools")}\n`;
  if (getSafe(bdDetails, "nearbyHospitals") !== "N/A")
    detailString += `- Nearby Hospitals: ${getSafe(bdDetails, "nearbyHospitals")}\n`;
  if (getSafe(bdDetails, "nearbyMarkets") !== "N/A")
    detailString += `- Nearby Markets: ${getSafe(bdDetails, "nearbyMarkets")}\n`;
  if (getSafe(bdDetails, "balcony") === "yes")
    detailString += `- Balcony Available\n`;
  if (getSafe(bdDetails, "rooftopAccess") === "yes")
    detailString += `- Rooftop Access\n`;
  if (getSafe(bdDetails, "naturalLight") !== "N/A")
    detailString += `- Natural Light: ${getSafe(bdDetails, "naturalLight")}\n`;
  if (getSafe(bdDetails, "roadWidth") !== "N/A")
    detailString += `- Road Width: ${getSafe(bdDetails, "roadWidth")}\n`;
  return detailString || "N/A";
};

// ============================================================================
// SECTION 2: PROPERTY DESCRIPTION GENERATOR (NVIDIA)
// ============================================================================
// Used by the listing form to auto-generate property descriptions.
// This is UNCHANGED from the original implementation.
// ============================================================================

const generatePropertyDescription = async (req, res) => {
  try {
    console.log("[AIController] Received language:", req.body.language);
    const propertyDataFromRequest = req.body.propertyData;
    const language = req.body.language || "en";

    if (
      !propertyDataFromRequest ||
      typeof propertyDataFromRequest !== "object"
    ) {
      return res.status(400).json({ error: "Invalid property data received" });
    }

    if (!NVIDIA_API_KEY) {
      console.error("NVIDIA_API_KEY is not defined.");
      return res
        .status(500)
        .json({ error: "Server configuration error: NVIDIA_API_KEY missing." });
    }

    const basicInfo = propertyDataFromRequest.basicInfo || {};
    const location = propertyDataFromRequest.location || {};
    const features = propertyDataFromRequest.features || {};
    const bdDetails = propertyDataFromRequest.bangladeshDetails || {};
    const userPromptText = propertyDataFromRequest.userPrompt || "";

    let prompt = `You are an expert real estate copywriter with deep understanding of the Bangladeshi property market, local culture, and what appeals to buyers and renters in different segments. Write a warm, emotionally engaging, and highly appealing property description for the listing below.

**Instructions:**
- The tone should be inviting, descriptive, and story-driven—like a trusted friend or real estate advisor is narrating the experience of living in the home.
- Highlight the **unique lifestyle advantages** this property offers, not just its features.
- Emphasize **comfort, ambiance, and neighborhood character**—make the reader imagine walking through the space and feeling at home.
- Draw attention to **standout features**, such as views, balconies, natural light, peaceful surroundings, or convenient access to roads, markets, schools, mosques, hospitals, etc.—but only if included in the data provided.
- Incorporate **cultural references or habits** where appropriate, such as the value of separate dining space for family gatherings, prayer space, veranda tea time, or close-knit community living.
- Never make up facts—only use what's provided in the listing details.
- Focus on clarity, warmth, and a strong sense of place.
- Avoid sounding robotic, overly generic, or like a simple feature list.
- give response in simple txt format, no markdown or code block
- (IMPORTANT) PLEASE GIVE ME THE RESPONSE IN ENGLISH LANGUAGE. DO NOT TRANSLATE. DO NOT USE BANGLA. ONLY ENGLISH.
- avoid using like in the heart of dhaka or in the heart of dhaka city, instead use like in dhaka city or in dhaka or anything more specific.
`;

    if (userPromptText) {
      prompt += `
**User's Specific Notes (Prioritize these if relevant and sensible):**
${userPromptText}
`;
    }

    prompt += `
Length: 150–200 words (adjust if user notes imply different length needed)

**Property Details:**
- Title: ${getSafe(basicInfo, "title")}
- Property Type: ${getSafe(basicInfo, "propertyType")}
- Listing Type: For ${getSafe(basicInfo, "listingType")}
- Price: ${getSafe(basicInfo, "price")} BDT${
      basicInfo.listingType === "rent" ? " /month" : ""
    }
- Size: ${getSafe(basicInfo, "area")} sqft
- Bedrooms: ${getSafe(basicInfo, "bedrooms", "N/A (Land/Commercial)")}
- Bathrooms: ${getSafe(basicInfo, "bathrooms", "N/A (Land/Commercial)")}

**Location:**
- Address: ${getSafe(location, "addressLine1")}${
      location.addressLine2 ? `, ${location.addressLine2}` : ""
    }
- Area/Town: ${getSafe(location, "cityTown")}
- Upazila/Thana: ${getSafe(location, "upazila")}
- District: ${getSafe(location, "district")}
- Postal Code: ${getSafe(location, "postalCode")}

**Key Features & Amenities:**
${formatFeaturesForPrompt(features)}

**Local Highlights & Context:**
${formatBangladeshDetailsForPrompt(bdDetails)}`;

    // "mistralai/mistral-medium-3-instruct" returned a 404 from NVIDIA's
    // chat completions endpoint - confirmed via /v1/models that this ID
    // isn't in this key's accessible catalog at all (no "medium" tier model
    // is). Switched to the closest available flagship-tier instruct model;
    // same OpenAI-compatible request/response shape, no prompt changes.
    const payload = {
      model: "mistralai/mistral-large-2-instruct",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 512,
      temperature: 0.8,
      top_p: 1.0,
      stream: false,
    };
    const headers = {
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    // 20s: LLM completions genuinely take longer than a simple REST call
    // (unlike the 8s used for OpenCage geocoding/Google Translate below) -
    // long enough that a normal generation isn't falsely aborted, short
    // enough to bound this user-facing "generate description" button
    // rather than letting it hang indefinitely on a slow/hung upstream.
    const response = await axios.post(NVIDIA_API_URL, payload, {
      headers,
      timeout: 20000,
    });

    if (
      response.data &&
      response.data.choices &&
      response.data.choices[0] &&
      response.data.choices[0].message &&
      response.data.choices[0].message.content
    ) {
      let description = response.data.choices[0].message.content.trim();
      let normalizedLanguage = language;
      if (
        ["bangla", "bengali", "bn-BD", "bd", "bangladesh"].includes(
          language?.toLowerCase()
        )
      ) {
        normalizedLanguage = "bn";
      }
      if (normalizedLanguage !== "en") {
        if (!GOOGLE_TRANSLATE_API_KEY) {
          console.warn("GOOGLE_TRANSLATE_API_KEY is not defined. Skipping translation.");
        } else {
          try {
            const qs = require("querystring");
            const translateRes = await axios.post(
              GOOGLE_TRANSLATE_URL,
              qs.stringify({
                q: description,
                target: normalizedLanguage,
                format: "text",
                key: GOOGLE_TRANSLATE_API_KEY,
              }),
              {
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                // Matches the OpenCage geocoding convention (Fix #17) - a
                // simple text-translation REST call, not LLM inference.
                timeout: 8000,
              }
            );
            if (
              translateRes.data &&
              translateRes.data.data &&
              translateRes.data.data.translations &&
              translateRes.data.data.translations[0]
            ) {
              description =
                translateRes.data.data.translations[0].translatedText;
            }
          } catch (translateErr) {
            console.error("Translation error:", translateErr?.message);
          }
        }
      }
      res.json({ description });
    } else {
      res.status(500).json({
        error: "Failed to generate property description",
        details: "Invalid response structure from NVIDIA API",
      });
    }
  } catch (error) {
    // error.message only - axios error objects embed the full request
    // config (including the Authorization: Bearer <NVIDIA_API_KEY> header)
    // in their `config`/`request` properties, so logging the raw error
    // object here would print the API key to server logs on every
    // failure.
    console.error("AI Description Error:", error.message);
    res.status(500).json({
      error: "Failed to generate property description",
    });
  }
};

// ============================================================================
// SECTION 3: SMART CHATBOT (RAG-Powered)
// ============================================================================
// This is the main chatbot endpoint. It:
//   1. Validates the incoming request
//   2. Extracts intent from the user message (intentService)
//   3. Runs the RAG pipeline to find + generate response (ragService)
//   4. Returns a structured response to the frontend
// ============================================================================

const chatbot = async (req, res) => {
  const startTime = Date.now();

  try {
    // ─── STEP 1: Extract & validate inputs ──────────────────────────────
    const { message, conversationHistory, language: requestedLanguage } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: "Message is required",
        reply: "Please type a message to get started.",
        properties: [],
      });
    }

    const userMessage = message.trim();
    const history = Array.isArray(conversationHistory) ? conversationHistory : [];

    console.log("\n[Chatbot] ════════════════════════════════════════");
    console.log(`[Chatbot] Incoming message: "${userMessage}"`);
    console.log(`[Chatbot] History length: ${history.length}`);
    console.log(`[Chatbot] Requested language: ${requestedLanguage || "auto"}`);

    // ─── STEP 2: Extract intent using AI ────────────────────────────────
    const intent = await intentService.extractIntent(userMessage, history);

    // Override language if frontend explicitly requested one
    if (requestedLanguage && ["en", "bn", "banglish"].includes(requestedLanguage)) {
      intent.language = requestedLanguage;
    }

    // ─── STEP 3: Run RAG pipeline ───────────────────────────────────────
    const ragResult = await ragService.runRAG({
      userMessage,
      intent,
    });

    // ─── STEP 4: Build response payload ─────────────────────────────────
    const duration = Date.now() - startTime;
    console.log(`[Chatbot] Completed in ${duration}ms`);
    console.log("[Chatbot] ════════════════════════════════════════\n");

    return res.json({
      success: true,
      reply: ragResult.reply,
      properties: ragResult.properties || [],
      metadata: {
        intent: ragResult.metadata.intent,
        searchTier: ragResult.metadata.searchTier,
        geocodedLocation: ragResult.metadata.geocodedLocation,
        propertyCount: ragResult.metadata.propertyCount,
        language: ragResult.metadata.language,
        responseTimeMs: duration,
      },
    });
  } catch (error) {
    console.error("[Chatbot] Error:", error);
    const duration = Date.now() - startTime;

    return res.status(500).json({
      success: false,
      error: "Chatbot processing failed",
      reply:
        "Sorry, something went wrong. Please try again in a moment.",
      properties: [],
      metadata: {
        responseTimeMs: duration,
      },
    });
  }
};

// ============================================================================
// SECTION 4: HEALTH CHECK (optional, useful for debugging)
// ============================================================================
// Frontend or admin can hit this to verify the AI services are working.
// ============================================================================

const healthCheck = async (req, res) => {
  try {
    const checks = {
      groqConfigured: !!process.env.GROQ_API_KEY,
      nvidiaConfigured: !!process.env.NVIDIA_API_KEY,
      mongodbConfigured: !!process.env.MONGO_URI,
      timestamp: new Date().toISOString(),
    };

    const allOk = checks.groqConfigured && checks.mongodbConfigured;

    return res.status(allOk ? 200 : 503).json({
      status: allOk ? "healthy" : "degraded",
      checks,
    });
  } catch (error) {
    console.error("Health check error:", error);
    return res.status(500).json({
      status: "error",
      message: "Health check failed.",
    });
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

exports.generateDescription = generatePropertyDescription;
exports.chatbot = chatbot;
exports.healthCheck = healthCheck;