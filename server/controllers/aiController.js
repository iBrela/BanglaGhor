// ============================================================================
// AI CONTROLLER - Main Entry Point for AI Features
// ============================================================================
// Handles the chatbot endpoint and a general health check.
//
//   1. POST /api/ai/chatbot
//      → Smart conversational property search (RAG architecture)
//      → Used by AIChatbot.js on the frontend
//      → Orchestrates: intentService → ragService → response
//
//   2. GET /api/ai/health
//      → Service health check
//
// The NVIDIA-based property-description generator that previously lived here
// (POST /api/ai/generate-description) was removed - the listing form no
// longer has a manual "Generate with AI" button, and automatic bilingual
// description generation now runs server-side in
// server/services/propertyDescriptionService.js (Groq -> Gemini ->
// deterministic template, translated via Gemini -> Groq). Confirmed zero
// remaining callers of the old endpoint/function before removal.
// ============================================================================

// ─── Services ─────────────────────────────────────────────────────────────
const intentService = require("../services/intentService");
const ragService = require("../services/ragService");

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

    // Property documents come back from ragService.js as .lean() reads,
    // which (confirmed live) include some fields that exist on the
    // underlying MongoDB documents but aren't part of the Mongoose schema -
    // notably a large `embedding` vector (and `semanticSearchText`), never
    // read by any backend code (grep-confirmed) and not needed by the
    // chatbot UI. Stripped here, at the HTTP boundary only: the DB query
    // itself is untouched, recommendationService's own use of these
    // objects already happened earlier in ragService.runRAG, and every
    // other property field (including the amenity-evidence fields below)
    // passes through unchanged.
    const responseProperties = (ragResult.properties || []).map((p) => {
      const { embedding, semanticSearchText, ...rest } = p;
      return rest;
    });

    return res.json({
      success: true,
      reply: ragResult.reply,
      properties: responseProperties,
      metadata: {
        intent: ragResult.metadata.intent,
        searchTier: ragResult.metadata.searchTier,
        geocodedLocation: ragResult.metadata.geocodedLocation,
        propertyCount: ragResult.metadata.propertyCount,
        language: ragResult.metadata.language,
        amenitiesRequested: ragResult.metadata.amenitiesRequested,
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
      geminiConfigured: !!process.env.GEMINI_API_KEY,
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

exports.chatbot = chatbot;
exports.healthCheck = healthCheck;