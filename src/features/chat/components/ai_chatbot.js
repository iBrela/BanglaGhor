// ============================================================================
// AI CHATBOT - BanglaGhor Smart Property Assistant (Final Production)
// ============================================================================
// Features:
//   - Material-UI based (matches website design)
//   - Theme-aware (light/dark auto-switch)
//   - Match quality labels (very close / close / nearby / regional)
//   - Property cards matching website's PropertyCard style
//   - English / Bangla / Banglish support
//   - Real database images with S3 support
//   - Conversation memory (localStorage)
// ============================================================================

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  IconButton,
  Paper,
  Typography,
  TextField,
  Avatar,
  Chip,
  Divider,
  useTheme,
  alpha,
  Fade,
  Tooltip,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

// Icons
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import BedIcon from "@mui/icons-material/Bed";
import BathtubIcon from "@mui/icons-material/Bathtub";
import SquareFootIcon from "@mui/icons-material/SquareFoot";
import HomeWorkIcon from "@mui/icons-material/HomeWork";
import NearMeIcon from "@mui/icons-material/NearMe";
import RefreshIcon from "@mui/icons-material/Refresh";

// ============================================================================
// CONSTANTS
// ============================================================================
const API_ENDPOINT = "/api/ai/chatbot";
const MAX_HISTORY_MESSAGES = 10;
const LOCAL_STORAGE_KEY = "banglaghor_chat_history";

const TRANSLATIONS = {
  en: {
    title: "BanglaGhor AI",
    subtitle: "Smart property assistant",
    welcome:
      "Hello! I'm your BanglaGhor AI assistant. Tell me what kind of property you're looking for — I'll find the best matches from across Bangladesh.",
    placeholder: "Type your question...",
    sending: "Thinking",
    error: "Sorry, something went wrong. Please try again.",
    retry: "Retry",
    clearChat: "Clear conversation",
    confirmClear: "Clear conversation history?",
    aboutAway: "away",
    bedsLabel: "Beds",
    bathsLabel: "Baths",
    sqftLabel: "sqft",
    rentSuffix: "/mo",
    // Section labels
    sectionVeryClose: "Near",
    sectionClose: "Close to",
    sectionNearby: "In the area",
    sectionRegional: "In the surrounding region",
    withinKm: "within",
    km: "km",
  },
  bn: {
    title: "BanglaGhor AI",
    subtitle: "স্মার্ট প্রপার্টি সহকারী",
    welcome:
      "আসসালামু আলাইকুম! আমি আপনার BanglaGhor AI সহকারী। আপনি কেমন বাড়ি খুঁজছেন বলুন — আমি বাংলাদেশের সেরা অপশনগুলো খুঁজে দেব।",
    placeholder: "আপনার প্রশ্ন লিখুন...",
    sending: "ভাবছি",
    error: "দুঃখিত, কিছু সমস্যা হয়েছে। আবার চেষ্টা করুন।",
    retry: "আবার",
    clearChat: "চ্যাট মুছুন",
    confirmClear: "চ্যাট হিস্ট্রি মুছে ফেলতে চান?",
    aboutAway: "দূরে",
    bedsLabel: "বেড",
    bathsLabel: "বাথ",
    sqftLabel: "বর্গফুট",
    rentSuffix: "/মাস",
    sectionVeryClose: "এর কাছে",
    sectionClose: "এর কাছাকাছি",
    sectionNearby: "এলাকায়",
    sectionRegional: "আশেপাশের এলাকায়",
    withinKm: "মধ্যে",
    km: "কিমি",
  },
};

// ============================================================================
// HELPER: Resolve image source (matches PropertyCard logic)
// ============================================================================
function resolveImageSrc(property) {
  var placeholderImg = "/pictures/placeholder.png";
  if (!property || !Array.isArray(property.images) || property.images.length === 0) {
    return placeholderImg;
  }
  var firstImage = property.images[0];
  if (!firstImage) return placeholderImg;
  if (firstImage.startsWith("http://") || firstImage.startsWith("https://")) {
    return firstImage;
  }
  return placeholderImg;
}

// ============================================================================
// MINI PROPERTY CARD COMPONENT
// ============================================================================
function MiniPropertyCard(props) {
  var property = props.property;
  var t = props.t;
  var theme = useTheme();

  if (!property || !property._id) return null;

  var imgSrc = resolveImageSrc(property);
  var placeholderImg = "/pictures/placeholder.png";

  function handleImageError(e) {
    e.target.onerror = null;
    e.target.src = placeholderImg;
  }

  var displayPrice;
  if (property.price !== null && property.price !== undefined) {
    var suffix = property.listingType === "rent" ? t("rentSuffix") : "";
    displayPrice = "৳ " + Number(property.price).toLocaleString() + suffix;
  } else {
    displayPrice = "Price N/A";
  }

  var locationParts = [];
  if (property.cityTown) locationParts.push(property.cityTown);
  if (property.district) locationParts.push(property.district);
  var locationString = locationParts.join(", ") || "Location N/A";

  var detailUrl = "/properties/details/" + property._id;
  var isLandOrCommercial =
    property.propertyType === "land" || property.propertyType === "commercial";

  var listingTypeBg =
    property.listingType === "rent"
      ? alpha(theme.palette.secondary.main, 0.9)
      : alpha(theme.palette.primary.main, 0.9);

  var distanceText = null;
  if (property._distanceKm !== null && property._distanceKm !== undefined) {
    distanceText = property._distanceKm.toFixed(1) + " km " + t("aboutAway");
  }

  return (
    <Paper
      component={RouterLink}
      to={detailUrl}
      target="_blank"
      elevation={0}
      sx={{
        display: "block",
        textDecoration: "none",
        borderRadius: "12px",
        overflow: "hidden",
        border: "1px solid " + theme.palette.divider,
        backgroundColor: "background.paper",
        transition: "all 0.2s ease",
        "&:hover": {
          borderColor: theme.palette.primary.main,
          transform: "translateY(-2px)",
          boxShadow: "0 8px 24px " + alpha(theme.palette.primary.main, 0.15),
        },
      }}
    >
      {/* Image area */}
      <Box sx={{ position: "relative", width: "100%", height: 110, overflow: "hidden" }}>
        <Box
          component="img"
          src={imgSrc}
          alt={property.title || "Property"}
          onError={handleImageError}
          sx={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />

        {property.listingType && (
          <Chip
            label={property.listingType.charAt(0).toUpperCase() + property.listingType.slice(1)}
            size="small"
            sx={{
              position: "absolute",
              top: 8,
              left: 8,
              bgcolor: listingTypeBg,
              color: "#fff",
              fontWeight: 700,
              fontSize: "0.65rem",
              height: 22,
              borderRadius: "6px",
              backdropFilter: "blur(4px)",
            }}
          />
        )}

        {distanceText && (
          <Chip
            icon={<NearMeIcon sx={{ fontSize: "0.85rem !important", color: "#fff !important" }} />}
            label={distanceText}
            size="small"
            sx={{
              position: "absolute",
              bottom: 8,
              left: 8,
              bgcolor: alpha("#000", 0.7),
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.65rem",
              height: 22,
              borderRadius: "6px",
              backdropFilter: "blur(4px)",
              "& .MuiChip-icon": { ml: "4px" },
            }}
          />
        )}
      </Box>

      {/* Body */}
      <Box sx={{ p: 1.5 }}>
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 700,
            fontSize: "0.85rem",
            color: "text.primary",
            mb: 0.5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {property.title || "Untitled"}
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
          <LocationOnIcon sx={{ fontSize: "0.85rem", color: "primary.main" }} />
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontSize: "0.7rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {locationString}
          </Typography>
        </Box>

        {!isLandOrCommercial ? (
          <Box sx={{ display: "flex", gap: 1.2, mb: 1, flexWrap: "wrap" }}>
            {property.bedrooms ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.3 }}>
                <BedIcon sx={{ fontSize: "0.85rem", color: theme.palette.info.main }} />
                <Typography variant="caption" sx={{ fontSize: "0.7rem", color: "text.secondary" }}>
                  {property.bedrooms} {t("bedsLabel")}
                </Typography>
              </Box>
            ) : null}
            {property.bathrooms ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.3 }}>
                <BathtubIcon sx={{ fontSize: "0.85rem", color: theme.palette.primary.main }} />
                <Typography variant="caption" sx={{ fontSize: "0.7rem", color: "text.secondary" }}>
                  {property.bathrooms} {t("bathsLabel")}
                </Typography>
              </Box>
            ) : null}
            {property.area ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.3 }}>
                <SquareFootIcon sx={{ fontSize: "0.85rem", color: theme.palette.warning.main }} />
                <Typography variant="caption" sx={{ fontSize: "0.7rem", color: "text.secondary" }}>
                  {property.area} {t("sqftLabel")}
                </Typography>
              </Box>
            ) : null}
          </Box>
        ) : null}

        <Divider sx={{ my: 0.5 }} />

        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 0.5 }}>
          <Typography
            variant="subtitle1"
            sx={{
              color: "primary.main",
              fontWeight: 800,
              fontSize: "0.9rem",
            }}
          >
            {displayPrice}
          </Typography>
          {property.propertyType && (
            <Chip
              icon={<HomeWorkIcon sx={{ fontSize: "0.7rem !important" }} />}
              label={property.propertyType.charAt(0).toUpperCase() + property.propertyType.slice(1)}
              size="small"
              color="primary"
              sx={{
                fontWeight: 600,
                fontSize: "0.62rem",
                height: 20,
                borderRadius: "6px",
              }}
            />
          )}
        </Box>
      </Box>
    </Paper>
  );
}

// ============================================================================
// HELPER: Build section label based on match quality
// ============================================================================
function buildSectionLabel(matchedLabel, locationName, language, t) {
  if (!matchedLabel || matchedLabel === "no_location" || matchedLabel === "no_match") {
    return null;
  }

  // Bangla labels (different word order)
  if (language === "bn") {
    if (matchedLabel === "very_close") return "📍 " + locationName + " " + t("sectionVeryClose");
    if (matchedLabel === "close") return "📍 " + locationName + " " + t("sectionClose") + " (২৫ " + t("km") + " " + t("withinKm") + ")";
    if (matchedLabel === "nearby") return "📍 " + locationName + " " + t("sectionNearby") + " (৫০ " + t("km") + " " + t("withinKm") + ")";
    if (matchedLabel === "regional") return "📍 " + t("sectionRegional") + " (১০০ " + t("km") + " " + t("withinKm") + ")";
  }

  // English / Banglish labels
  if (matchedLabel === "very_close") return "📍 " + t("sectionVeryClose") + " " + locationName;
  if (matchedLabel === "close") return "📍 " + t("sectionClose") + " " + locationName + " (within 25 km)";
  if (matchedLabel === "nearby") return "📍 " + t("sectionNearby") + " (within 50 km)";
  if (matchedLabel === "regional") return "📍 " + t("sectionRegional") + " (within 100 km)";

  return null;
}

// ============================================================================
// MAIN CHATBOT COMPONENT
// ============================================================================
export default function AIChatbot() {
  var theme = useTheme();
  var isDark = theme.palette.mode === "dark";

  var openState = useState(false);
  var open = openState[0];
  var setOpen = openState[1];

  var messagesState = useState([]);
  var messages = messagesState[0];
  var setMessages = messagesState[1];

  var inputState = useState("");
  var input = inputState[0];
  var setInput = inputState[1];

  var loadingState = useState(false);
  var loading = loadingState[0];
  var setLoading = loadingState[1];

  var languageState = useState(localStorage.getItem("i18nextLng") || "en");
  var language = languageState[0];
  var setLanguage = languageState[1];

  var messagesEndRef = useRef(null);
  var inputRef = useRef(null);

  var getLanguageCode = useCallback(function () {
    if (language === "bn" || language === "bn-BD") return "bn";
    return "en";
  }, [language]);

  var t = useCallback(function (key) {
    var lang = getLanguageCode();
    return TRANSLATIONS[lang][key];
  }, [getLanguageCode]);

  // Watch for language changes
  useEffect(function () {
    var interval = setInterval(function () {
      var newLang = localStorage.getItem("i18nextLng") || "en";
      if (newLang !== language) setLanguage(newLang);
    }, 500);
    return function () { clearInterval(interval); };
  }, [language]);

  // Auto-scroll on new messages
  useEffect(function () {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading]);

  // Focus input when opened
  useEffect(function () {
    if (open && inputRef.current) {
      setTimeout(function () {
        if (inputRef.current) inputRef.current.focus();
      }, 200);
    }
  }, [open]);

  // Load saved history on mount
  useEffect(function () {
    try {
      var saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch (e) {
      console.error("Failed to load chat history:", e);
    }
  }, []);

  // Save history on changes
  useEffect(function () {
    if (messages.length > 0) {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(messages.slice(-20)));
      } catch (e) {
        console.error("Failed to save chat history:", e);
      }
    }
  }, [messages]);

  async function sendMessage(messageText) {
    if (!messageText || !messageText.trim() || loading) return;

    var userMessage = messageText.trim();
    var newMessages = messages.concat([
      { role: "user", content: userMessage, timestamp: Date.now() },
    ]);
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      var historyToSend = newMessages
        .slice(-MAX_HISTORY_MESSAGES * 2)
        .map(function (m) { return { role: m.role, content: m.content }; });

      var response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          conversationHistory: historyToSend.slice(0, -1),
          language: getLanguageCode(),
        }),
      });

      var data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Request failed");
      }

      setMessages(function (prev) {
        return prev.concat([{
          role: "assistant",
          content: data.reply,
          properties: data.properties || [],
          metadata: data.metadata,
          timestamp: Date.now(),
        }]);
      });
    } catch (error) {
      console.error("[Chatbot]", error);
      setMessages(function (prev) {
        return prev.concat([{
          role: "assistant",
          content: t("error"),
          isError: true,
          retryMessage: userMessage,
          timestamp: Date.now(),
        }]);
      });
    } finally {
      setLoading(false);
    }
  }

  function handleSend() { sendMessage(input); }

  function handleKeyPress(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleClearChat() {
    if (window.confirm(t("confirmClear"))) {
      setMessages([]);
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }

  // ============================================================
  // RENDER
  // ============================================================
  var sendDisabled = loading || !input.trim();

  var userBubbleBg = theme.palette.primary.main;
  var assistantBubbleBg = isDark
    ? alpha(theme.palette.background.paper, 0.6)
    : alpha(theme.palette.grey[100], 0.95);
  var errorBubbleBg = alpha(theme.palette.error.main, 0.15);

  function renderMessage(msg, idx) {
    var isUser = msg.role === "user";

    var bubbleSx = {
      maxWidth: "85%",
      px: 1.5,
      py: 1.2,
      borderRadius: "14px",
      bgcolor: msg.isError ? errorBubbleBg : (isUser ? userBubbleBg : assistantBubbleBg),
      color: isUser ? "#fff" : "text.primary",
      borderBottomRightRadius: isUser ? "4px" : "14px",
      borderBottomLeftRadius: isUser ? "14px" : "4px",
      border: msg.isError ? "1px solid " + alpha(theme.palette.error.main, 0.4) : "none",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    };

    // Build section label for properties
    var sectionLabel = null;
    var sectionColor = "primary.main";

    if (msg.properties && msg.properties.length > 0 && msg.metadata) {
      var locName = msg.metadata.locationName || "your area";
      var matchedLabel = msg.metadata.matchedLabel;
      sectionLabel = buildSectionLabel(matchedLabel, locName, language, t);

      if (matchedLabel === "very_close") sectionColor = "success.main";
      else if (matchedLabel === "close") sectionColor = "primary.main";
      else if (matchedLabel === "nearby" || matchedLabel === "regional") sectionColor = "warning.main";
    }

    return (
      <Box
        key={idx}
        sx={{
          display: "flex",
          justifyContent: isUser ? "flex-end" : "flex-start",
          mb: 1.5,
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", maxWidth: "90%" }}>
          {!isUser && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5, pl: 0.5 }}>
              <Avatar sx={{ bgcolor: theme.palette.primary.main, width: 22, height: 22 }}>
                <SmartToyIcon sx={{ fontSize: "0.85rem" }} />
              </Avatar>
              <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem", fontWeight: 600 }}>
                BanglaGhor AI
              </Typography>
            </Box>
          )}

          <Paper elevation={0} sx={bubbleSx}>
            <Typography variant="body2" sx={{ fontSize: "0.88rem", lineHeight: 1.55 }}>
              {msg.content}
            </Typography>

            {msg.isError && msg.retryMessage && (
              <Chip
                icon={<RefreshIcon />}
                label={t("retry")}
                size="small"
                onClick={function () { sendMessage(msg.retryMessage); }}
                sx={{
                  mt: 1,
                  color: theme.palette.error.main,
                  borderColor: theme.palette.error.main,
                  cursor: "pointer",
                }}
                variant="outlined"
              />
            )}
          </Paper>

          {msg.properties && msg.properties.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1 }}>
              {sectionLabel && (
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 700,
                    color: sectionColor,
                    fontSize: "0.72rem",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    mt: 0.5,
                    px: 0.5,
                  }}
                >
                  {sectionLabel}
                </Typography>
              )}
              {msg.properties.slice(0, 5).map(function (property, i) {
                return <MiniPropertyCard key={property._id || i} property={property} t={t} />;
              })}
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  function renderWelcome() {
    return (
      <Box sx={{ textAlign: "center", py: 4, px: 2 }}>
        <Avatar
          sx={{
            bgcolor: theme.palette.primary.main,
            width: 56,
            height: 56,
            mx: "auto",
            mb: 2,
          }}
        >
          <SmartToyIcon sx={{ fontSize: "1.8rem" }} />
        </Avatar>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1, color: "text.primary" }}>
          {t("title")}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.6, fontSize: "0.85rem" }}>
          {t("welcome")}
        </Typography>
      </Box>
    );
  }

  function renderTyping() {
    return (
      <Box sx={{ display: "flex", justifyContent: "flex-start", mb: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Avatar sx={{ bgcolor: theme.palette.primary.main, width: 22, height: 22 }}>
            <SmartToyIcon sx={{ fontSize: "0.85rem" }} />
          </Avatar>
          <Paper
            elevation={0}
            sx={{
              px: 1.5,
              py: 1,
              borderRadius: "14px",
              borderBottomLeftRadius: "4px",
              bgcolor: assistantBubbleBg,
              display: "flex",
              alignItems: "center",
              gap: 0.5,
            }}
          >
            <Box sx={{ display: "flex", gap: 0.3 }}>
              {[0, 1, 2].map(function (i) {
                return (
                  <Box
                    key={i}
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      bgcolor: theme.palette.primary.main,
                      animation: "ai-chat-bounce 1.4s infinite ease-in-out both",
                      animationDelay: (i * 0.16) + "s",
                    }}
                  />
                );
              })}
            </Box>
            <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.75rem", ml: 0.5 }}>
              {t("sending")}...
            </Typography>
          </Paper>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ position: "fixed", bottom: 24, right: 24, zIndex: 1300 }}>
      {/* Chat Window */}
      <Fade in={open}>
        <Paper
          elevation={12}
          sx={{
            display: open ? "flex" : "none",
            position: "absolute",
            bottom: 76,
            right: 0,
            width: { xs: "calc(100vw - 48px)", sm: 400 },
            maxWidth: 400,
            height: { xs: "calc(100vh - 140px)", sm: 600 },
            maxHeight: 600,
            flexDirection: "column",
            borderRadius: "16px",
            overflow: "hidden",
            bgcolor: "background.default",
            border: "1px solid " + theme.palette.divider,
          }}
        >
          {/* Header */}
          <Box
            sx={{
              px: 2,
              py: 1.5,
              background: "linear-gradient(135deg, " + theme.palette.primary.main + " 0%, " + theme.palette.primary.dark + " 100%)",
              color: "#fff",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.2 }}>
              <Avatar sx={{ bgcolor: alpha("#fff", 0.2), width: 36, height: 36 }}>
                <SmartToyIcon />
              </Avatar>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2, color: "#fff" }}>
                  {t("title")}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.85, fontSize: "0.7rem", color: "#fff" }}>
                  {t("subtitle")}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: "flex", gap: 0.5 }}>
              {messages.length > 0 && (
                <Tooltip title={t("clearChat")}>
                  <IconButton
                    size="small"
                    onClick={handleClearChat}
                    sx={{ color: "#fff", "&:hover": { bgcolor: alpha("#fff", 0.15) } }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <IconButton
                size="small"
                onClick={function () { setOpen(false); }}
                sx={{ color: "#fff", "&:hover": { bgcolor: alpha("#fff", 0.15) } }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>

          {/* Messages */}
          <Box
            sx={{
              flex: 1,
              overflowY: "auto",
              px: 1.5,
              py: 1.5,
              bgcolor: "background.default",
              "&::-webkit-scrollbar": { width: 6 },
              "&::-webkit-scrollbar-thumb": {
                bgcolor: theme.palette.divider,
                borderRadius: 3,
              },
            }}
          >
            {messages.length === 0 ? renderWelcome() : messages.map(renderMessage)}
            {loading && renderTyping()}
            <div ref={messagesEndRef} />
          </Box>

          {/* Input */}
          <Box
            sx={{
              p: 1.5,
              borderTop: "1px solid " + theme.palette.divider,
              bgcolor: "background.paper",
              display: "flex",
              gap: 1,
              alignItems: "center",
            }}
          >
            <TextField
              inputRef={inputRef}
              fullWidth
              size="small"
              value={input}
              onChange={function (e) { setInput(e.target.value); }}
              onKeyDown={handleKeyPress}
              placeholder={t("placeholder")}
              disabled={loading}
              sx={{
                "& .MuiOutlinedInput-root": {
                  borderRadius: "12px",
                  fontSize: "0.88rem",
                },
              }}
            />
            <IconButton
              color="primary"
              onClick={handleSend}
              disabled={sendDisabled}
              sx={{
                bgcolor: theme.palette.primary.main,
                color: "#fff",
                width: 40,
                height: 40,
                "&:hover": { bgcolor: theme.palette.primary.dark },
                "&.Mui-disabled": {
                  bgcolor: alpha(theme.palette.primary.main, 0.3),
                  color: alpha("#fff", 0.6),
                },
              }}
            >
              <SendIcon sx={{ fontSize: "1.1rem" }} />
            </IconButton>
          </Box>
        </Paper>
      </Fade>

      {/* Floating Button */}
      <Tooltip title={open ? "" : t("title")} placement="left">
        <IconButton
          onClick={function () { setOpen(!open); }}
          sx={{
            width: 60,
            height: 60,
            background: "linear-gradient(135deg, " + theme.palette.primary.main + " 0%, " + theme.palette.primary.dark + " 100%)",
            color: "#fff",
            boxShadow: "0 4px 20px " + alpha(theme.palette.primary.main, 0.5),
            "&:hover": {
              background: "linear-gradient(135deg, " + theme.palette.primary.dark + " 0%, " + theme.palette.primary.main + " 100%)",
              transform: "scale(1.05)",
            },
            transition: "all 0.2s ease",
          }}
        >
          {open ? <CloseIcon /> : <ChatBubbleOutlineIcon />}
        </IconButton>
      </Tooltip>

      {/* Typing animation keyframes */}
      <style>{`
        @keyframes ai-chat-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </Box>
  );
}