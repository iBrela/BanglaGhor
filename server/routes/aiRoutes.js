// ============================================================================
// AI ROUTES
// ============================================================================
// All AI-related endpoints. Mounted at /api/ai in server.js.
//
// Endpoints:
//   POST /api/ai/chatbot → Smart property search chatbot
//   GET  /api/ai/health  → Service health check (debugging)
//
// POST /api/ai/generate-description (NVIDIA-based) was removed - confirmed
// zero remaining callers (the listing form generates bilingual descriptions
// automatically server-side now, via server/services/propertyDescriptionService.js).
// ============================================================================

const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");

// ─── Chatbot endpoint (main RAG-powered chatbot) ──────────────────────────
// Body: { message: string, conversationHistory: array, language: string }
// Used by: src/features/chat/components/ai_chatbot.js
router.post("/chatbot", aiController.chatbot);

// ─── Health check (optional, useful for monitoring) ───────────────────────
// Returns: { status, checks: { groqConfigured, mongodbConfigured, ... } }
router.get("/health", aiController.healthCheck);

module.exports = router;