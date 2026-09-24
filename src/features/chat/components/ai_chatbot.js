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
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { getPropertyCoordinates } from "../../../shared/propertyLocation";

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
import MapIcon from "@mui/icons-material/Map";
// Amenity-category icons (Part 2 of the property-card "near your
// preferences" section) - all from the already-installed @mui/icons-material
// package, no new icon library added.
import LocalHospitalIcon from "@mui/icons-material/LocalHospital";
import LocalPharmacyIcon from "@mui/icons-material/LocalPharmacy";
import SchoolIcon from "@mui/icons-material/School";
import ParkIcon from "@mui/icons-material/Park";
import StorefrontIcon from "@mui/icons-material/Storefront";
import PlaceIcon from "@mui/icons-material/Place";
import LocalPoliceIcon from "@mui/icons-material/LocalPolice";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import DirectionsBusIcon from "@mui/icons-material/DirectionsBus";
import TrainIcon from "@mui/icons-material/Train";
import DirectionsBoatIcon from "@mui/icons-material/DirectionsBoat";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import LocalAtmIcon from "@mui/icons-material/LocalAtm";
import DirectionsCarIcon from "@mui/icons-material/DirectionsCar";
import DirectionsWalkIcon from "@mui/icons-material/DirectionsWalk";
import DirectionsBikeIcon from "@mui/icons-material/DirectionsBike";

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
    fromLocation: "from",
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
    m: "m",
    viewOnMap: "View on map",
    viewAllOnMap: "View all on map",
    nearYourPreferences: "Near your preferences",
    minLabel: "min",
    travelModeDriving: "drive",
    travelModeWalking: "walk",
    travelModeCycling: "cycle",
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
    fromLocation: "থেকে",
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
    m: "মি",
    viewOnMap: "ম্যাপে দেখুন",
    viewAllOnMap: "সবগুলো ম্যাপে দেখুন",
    nearYourPreferences: "আপনার পছন্দের কাছাকাছি",
    minLabel: "মিনিট",
    travelModeDriving: "গাড়িতে",
    travelModeWalking: "হেঁটে",
    travelModeCycling: "সাইকেলে",
  },
};

// ============================================================================
// HELPER: Build a trustworthy locality label for the compact card
// ============================================================================
// No shared property/location display helper existed for locality TEXT
// (src/shared/propertyLocation.js only handles coordinates); the other
// three components that build a location string (PropertyCard.js,
// PropertyInfoPanel.js, PropertyDetailPage.js) each do it inline and are
// out of scope for this change - so this is a small, local helper, scoped
// to this file only.
//
// Prefers `upazila` over `cityTown`: a read-only data-quality audit of the
// live property collection found cityTown inconsistent with
// upazila/geocodedAddress in 26/60 (43%) of records, while upazila was
// reliably corroborated by the real geocoded address in every case checked
// (e.g. "Apartment for buy #22": cityTown="Motijheel" is wrong,
// upazila="Gulshan" is correct). Never invents a locality - only ever
// picks among the property's own already-stored fields.
function buildLocalityLabel(property) {
  if (!property) return null;
  var primary = property.upazila || property.cityTown || null;
  var district = property.district || null;

  var parts = [];
  if (primary) parts.push(primary);
  // Avoid duplicate output like "Dhaka, Dhaka" or "Banani, Banani".
  if (
    district &&
    (!primary || district.trim().toLowerCase() !== primary.trim().toLowerCase())
  ) {
    parts.push(district);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

// ============================================================================
// HELPER: Amenity category -> icon (all 16 categories intentService.js can
// extract - see server/services/intentService.js's AMENITY MAPPING RULES).
// PlaceIcon is the "suitable neutral place icon" fallback for any category
// not explicitly mapped (currently only place_of_worship, deliberately kept
// neutral since it can mean mosque, temple, or church).
// ============================================================================
var AMENITY_ICON_MAP = {
  hospital: LocalHospitalIcon,
  clinic: LocalHospitalIcon,
  pharmacy: LocalPharmacyIcon,
  school: SchoolIcon,
  college: SchoolIcon,
  university: SchoolIcon,
  park: ParkIcon,
  marketplace: StorefrontIcon,
  place_of_worship: PlaceIcon,
  police: LocalPoliceIcon,
  fire_station: LocalFireDepartmentIcon,
  bus_station: DirectionsBusIcon,
  railway_station: TrainIcon,
  ferry_terminal: DirectionsBoatIcon,
  bank: AccountBalanceIcon,
  atm: LocalAtmIcon,
};

var TRAVEL_ICON_MAP = {
  driving: DirectionsCarIcon,
  walking: DirectionsWalkIcon,
  cycling: DirectionsBikeIcon,
};

// ============================================================================
// HELPER: Format a POI distance (property -> requested amenity, i.e.
// nearestPOI.distanceMeters - a real backend geospatial value, never
// invented or derived here). Deliberately separate from property._distanceKm
// (searched location -> property, shown in the distance badge/reply text) -
// the two are different measurements and must never be conflated.
// ============================================================================
function formatDistanceMeters(distanceMeters, t) {
  if (typeof distanceMeters !== "number" || !isFinite(distanceMeters)) return null;
  if (distanceMeters < 1000) {
    return Math.round(distanceMeters) + " " + t("m");
  }
  return (distanceMeters / 1000).toFixed(1) + " " + t("km");
}

// ============================================================================
// HELPER: Format a Valhalla-backed travel-time label (e.g. "1.1 min drive" /
// "গাড়িতে ১.১ মিনিট"). Only ever renders backend-provided
// match.travel.durationMinutes - never estimates or calculates travel time
// on the frontend. Returns null (renders nothing) whenever travel is null,
// which callers must treat as a normal, non-error state (see
// recommendationService.js's enrichWithTravelTime: a Valhalla failure or an
// unsolved matrix cell just leaves travel as null, by design).
// ============================================================================
function formatTravelText(travel, language, t) {
  if (!travel || typeof travel.durationMinutes !== "number" || !isFinite(travel.durationMinutes)) {
    return null;
  }
  var duration = travel.durationMinutes;
  var durationStr = duration < 10 ? duration.toFixed(1) : String(Math.round(duration));
  var modeKey =
    travel.mode === "walking"
      ? "travelModeWalking"
      : travel.mode === "cycling"
      ? "travelModeCycling"
      : "travelModeDriving";
  var modeWord = t(modeKey);
  if (language === "bn") {
    return modeWord + " " + durationStr + " " + t("minLabel");
  }
  return durationStr + " " + t("minLabel") + " " + modeWord;
}

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
  var language = props.language;
  // The searched location's own human-readable name (e.g. "Banani",
  // "Gulshan") - reused as-is from the backend's existing
  // metadata.geocodedLocation.name (see ragService.js's runRAG, already
  // returned by POST /api/ai/chatbot). Never re-parsed or re-geocoded here.
  var searchLocationName = props.locationName;
  // The chatbot response's own metadata.geocodedLocation object (not just
  // its name) - carried through unchanged to the property-level "View on
  // map" navigation, exactly like the existing message-level
  // handleViewOnMap's recommendationLocation. Never re-geocoded here.
  var recommendationLocation = props.recommendationLocation || null;
  var theme = useTheme();
  var navigate = useNavigate();

  if (!property || !property._id) return null;

  var imgSrc = resolveImageSrc(property);
  var placeholderImg = "/pictures/placeholder.png";

  function handleImageError(e) {
    e.target.onerror = null;
    e.target.src = placeholderImg;
  }

  // PART 1: only backend-verified, requested amenity matches - never a
  // generic/unmatched POI, never independently re-sorted (preserves the
  // order _amenityMatches already arrives in).
  var verifiedAmenities = Array.isArray(property._amenityMatches)
    ? property._amenityMatches.filter(function (m) {
        return !!(m && m.matched === true && m.nearestPOI);
      })
    : [];

  // PART 5: same double-check as MapPage's recommendationData / the
  // message-level button above - locationAccuracy must be precise/
  // approximate (a district-level property's geoLocation already holds a
  // real-looking but generic backend-fallback centroid, which
  // getPropertyCoordinates() alone can't distinguish from a genuine
  // geocode) AND getPropertyCoordinates() must return a real coordinate.
  var isVerifiableAccuracy =
    property.locationAccuracy === "precise" || property.locationAccuracy === "approximate";
  var showPropertyMapButton = isVerifiableAccuracy && !!getPropertyCoordinates(property);

  function handlePropertyViewOnMap(e) {
    // Card is a RouterLink to the property details page - stop that
    // navigation (and its own click bubbling) so this button's click
    // exclusively triggers the map navigation below.
    e.preventDefault();
    e.stopPropagation();
    navigate("/map", {
      state: {
        recommendedProperties: [property],
        recommendationLocation: recommendationLocation,
      },
    });
  }

  var displayPrice;
  if (property.price !== null && property.price !== undefined) {
    var suffix = property.listingType === "rent" ? t("rentSuffix") : "";
    displayPrice = "৳ " + Number(property.price).toLocaleString() + suffix;
  } else {
    displayPrice = "Price N/A";
  }

  var locationString = buildLocalityLabel(property) || "Location N/A";

  var detailUrl = "/properties/details/" + property._id;
  var isLandOrCommercial =
    property.propertyType === "land" || property.propertyType === "commercial";

  var listingTypeBg =
    property.listingType === "rent"
      ? alpha(theme.palette.secondary.main, 0.9)
      : alpha(theme.palette.primary.main, 0.9);

  // This badge is ALWAYS "searched location -> property" distance
  // (property._distanceKm, computed by ragService.js's addDistanceInfo) -
  // never a POI/amenity distance, which is a separate value shown only in
  // the chat reply text (see recommendationService.js / generateReply()).
  //
  // Same locationAccuracy gate as the preference section / property-level
  // map button above: a district-level property's coordinate is a generic
  // backend-fallback centroid, not a real geocode, so a distance measured
  // from it ("2.3 km from Banani") would misrepresent how close the
  // property actually is. _distanceKm itself is untouched - this only
  // controls whether the badge is presented.
  var distanceText = null;
  if (
    isVerifiableAccuracy &&
    property._distanceKm !== null &&
    property._distanceKm !== undefined
  ) {
    var kmStr = property._distanceKm.toFixed(1);
    if (searchLocationName) {
      // "0.6 km from Banani" (en) / "বনানী থেকে ০.৬ কিমি" (bn - location
      // first, matching this file's existing bn word-order convention, see
      // buildSectionLabel above).
      distanceText = language === "bn"
        ? searchLocationName + " " + t("fromLocation") + " " + kmStr + " " + t("km")
        : kmStr + " km " + t("fromLocation") + " " + searchLocationName;
    } else {
      // Graceful fallback when no reliable searched-location label is
      // available - never invents one.
      distanceText = kmStr + " km " + t("aboutAway");
    }
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

        {verifiedAmenities.length > 0 && (
          <Box sx={{ mb: 1 }}>
            <Typography
              variant="caption"
              sx={{
                display: "block",
                fontWeight: 700,
                fontSize: "0.62rem",
                color: "text.secondary",
                textTransform: "uppercase",
                letterSpacing: 0.4,
                mb: 0.5,
              }}
            >
              {t("nearYourPreferences")}
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              {verifiedAmenities.map(function (m, mi) {
                var IconComp = AMENITY_ICON_MAP[m.category] || PlaceIcon;
                var distanceLabel = formatDistanceMeters(m.nearestPOI.distanceMeters, t);
                var travelText = formatTravelText(m.travel, language, t);
                var TravelIconComp = (m.travel && TRAVEL_ICON_MAP[m.travel.mode]) || DirectionsCarIcon;
                return (
                  <Box key={(m.category || "amenity") + "-" + mi} sx={{ display: "flex", flexDirection: "column" }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0.5 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.4, overflow: "hidden" }}>
                        <IconComp sx={{ fontSize: "0.8rem", color: theme.palette.primary.main, flexShrink: 0 }} />
                        <Typography
                          variant="caption"
                          title={m.nearestPOI.name || ""}
                          sx={{
                            fontSize: "0.68rem",
                            color: "text.primary",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {m.nearestPOI.name || ""}
                        </Typography>
                      </Box>
                      {distanceLabel && (
                        <Typography
                          variant="caption"
                          sx={{ fontSize: "0.68rem", color: "text.secondary", fontWeight: 600, flexShrink: 0 }}
                        >
                          {distanceLabel}
                        </Typography>
                      )}
                    </Box>
                    {travelText && (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.4, pl: 2.2 }}>
                        <TravelIconComp sx={{ fontSize: "0.68rem", color: "text.secondary" }} />
                        <Typography variant="caption" sx={{ fontSize: "0.63rem", color: "text.secondary" }}>
                          {travelText}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

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

        {showPropertyMapButton && (
          <Chip
            icon={<MapIcon sx={{ fontSize: "0.85rem !important" }} />}
            label={t("viewOnMap")}
            size="small"
            onClick={handlePropertyViewOnMap}
            clickable
            sx={{
              mt: 1,
              fontWeight: 600,
              fontSize: "0.65rem",
              height: 22,
              borderRadius: "8px",
              color: theme.palette.primary.main,
              borderColor: theme.palette.primary.main,
              bgcolor: alpha(theme.palette.primary.main, 0.08),
            }}
            variant="outlined"
          />
        )}
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
  var navigate = useNavigate();

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

  // "View on map" - navigates to the existing /map page, carrying this
  // message's already-fetched property objects (with their _amenityMatches/
  // nearestPOI evidence intact) via React Router's own navigation state.
  // No re-fetch, no re-parsing of the user's message, no POIs sent
  // separately - MapPage derives verified POI markers from
  // recommendedProperties itself (see MapPage.js's recommendationData).
  function handleViewOnMap(msg) {
    navigate("/map", {
      state: {
        recommendedProperties: msg.properties,
        recommendationLocation: (msg.metadata && msg.metadata.geocodedLocation) || null,
      },
    });
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
                // Reuses the backend's existing geocoded search-location
                // name (already returned by POST /api/ai/chatbot as
                // metadata.geocodedLocation.name - see ragService.js) -
                // never re-parsed or re-geocoded on the frontend. Absent
                // whenever _distanceKm is also absent (both are gated on
                // the same successful-geocode condition in runRAG), and the
                // card gracefully falls back to the plain "X km away" label
                // when it's missing for any other reason.
                var searchLocationName =
                  msg.metadata && msg.metadata.geocodedLocation
                    ? msg.metadata.geocodedLocation.name
                    : null;
                return (
                  <MiniPropertyCard
                    key={property._id || i}
                    property={property}
                    t={t}
                    language={language}
                    locationName={searchLocationName}
                    recommendationLocation={(msg.metadata && msg.metadata.geocodedLocation) || null}
                  />
                );
              })}
              {msg.properties.some(function (p) {
                // Mirrors MapPage's recommendationData gate exactly: a
                // district-level property's geoLocation already holds a
                // real-looking (but generic, backend-fallback) coordinate,
                // so getPropertyCoordinates() alone can't tell that apart
                // from a genuine precise/approximate geocode. Without this
                // locationAccuracy check the button could appear for a
                // message whose only property MapPage would then correctly
                // refuse to plot, leading to an empty recommendation map.
                var isVerifiableAccuracy =
                  p.locationAccuracy === "precise" || p.locationAccuracy === "approximate";
                return isVerifiableAccuracy && !!getPropertyCoordinates(p);
              }) && (
                // "View all on map" - sends the full recommendedProperties
                // array (unlike each card's own property-level button, which
                // sends only that single property). Same navigation target/
                // shape and the same MapPage-side filtering/dedup as before -
                // only this label changed.
                <Chip
                  icon={<MapIcon sx={{ fontSize: "0.9rem !important" }} />}
                  label={t("viewAllOnMap")}
                  size="small"
                  onClick={function () { handleViewOnMap(msg); }}
                  clickable
                  sx={{
                    alignSelf: "flex-start",
                    mt: 0.5,
                    fontWeight: 600,
                    fontSize: "0.7rem",
                    borderRadius: "8px",
                    color: theme.palette.primary.main,
                    borderColor: theme.palette.primary.main,
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                  }}
                  variant="outlined"
                />
              )}
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