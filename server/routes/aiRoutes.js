// ============================================================================
// AI ROUTES
// ============================================================================
// All AI-related endpoints. Mounted at /api/ai in server.js.
//
// Endpoints:
//   POST /api/ai/chatbot              → Smart property search chatbot
//   POST /api/ai/generate-description → AI property description (listing form)
//   GET  /api/ai/health               → Service health check (debugging)
// ============================================================================

const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");

// ─── Chatbot endpoint (main RAG-powered chatbot) ──────────────────────────
// Body: { message: string, conversationHistory: array, language: string }
// Used by: src/features/chat/components/ai_chatbot.js
router.post("/chatbot", aiController.chatbot);

// ─── Property description generator (NVIDIA) ──────────────────────────────
// Body: { propertyData: object, language: string }
// Used by: listing form (Step 4 Images / Step 5 Review)
router.post("/generate-description", aiController.generateDescription);

// ─── Health check (optional, useful for monitoring) ───────────────────────
// Returns: { status, checks: { groqConfigured, mongodbConfigured, ... } }
router.get("/health", aiController.healthCheck);

module.exports = router;