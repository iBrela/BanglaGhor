import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  useParams,
  useNavigate,
  useLocation,
} from "react-router-dom";
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Button,
  IconButton,
  Drawer,
  Divider,
  Snackbar,
  Autocomplete,
  TextField,
  ToggleButtonGroup,
  ToggleButton,
  Tooltip,
  Paper,
  InputAdornment,
  Chip,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import FilterListIcon from "@mui/icons-material/FilterList";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import InfoIcon from "@mui/icons-material/Info";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import HomeWorkIcon from "@mui/icons-material/HomeWork";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { getPropertyCoordinates } from "../../shared/propertyLocation";
import MapComponent from "./components/MapComponent";
import PropertyInfoPanel from "./components/PropertyInfoPanel";
import FilterSidebar from "../properties/components/FilterSidebar";
import useMapData from "./hooks/useMapData";
import useLocationSearch from "./hooks/useLocationSearch";
import useRouting from "./hooks/useRouting";

const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5001/api";
// The existing /api/pois/nearby endpoint's own hard cap on `limit` (see
// server/controllers/poiController.js's MAX_LIMIT) - requested explicitly so
// "show ALL matching POIs" gets as complete a result as the existing backend
// already allows, without inventing a new, unrelated cap here. No `radius`
// is ever sent when the user gave no explicit distance (see
// fetchAmenityPois below) - that leaves the backend's own existing default
// radius (poiController.js's DEFAULT_RADIUS_METERS) in effect, per the
// "reuse the backend's existing default" requirement.
const POI_FETCH_LIMIT = 50;

// Measured directly from ai_chatbot.js's own floating panel (not guessed):
// the fixed wrapper sits at `right: 24`, and the Paper itself is `width: 400`
// on the "sm" breakpoint and up (MUI's own theme.breakpoints, the same one
// used below) - so on desktop the chatbot occupies the rightmost
// ~424px of the viewport when open. On "xs" (mobile) that same panel is a
// near-fullscreen overlay (width: calc(100vw - 48px), height: calc(100vh -
// 140px)) rather than a side panel, so no right-side reservation makes sense
// there - see isDesktopChatbotWidth below.
const CHATBOT_PANEL_WIDTH = 400;
const CHATBOT_PANEL_RIGHT_OFFSET = 24;
const CHATBOT_CLEARANCE_MARGIN = 30;
const RECOMMENDATION_FIT_BASE_PADDING = 70;

// Zoom level to jump to when a place-search result is selected, keyed by
// Photon's own normalized "type" field (verified against real API responses
// during M2 development - see the M2 implementation report). Deliberately
// generic by type, not by name - no hardcoded city/place logic.
const PLACE_TYPE_ZOOM = {
  state: 8, // division
  county: 10, // district/upazila
  city: 12,
  district: 14, // city sub-area/neighbourhood (Photon's naming, e.g. "Gulshan")
  locality: 14, // quarter, e.g. "Gulshan 2"
  street: 16,
  house: 17,
};
const DEFAULT_PLACE_ZOOM = 12;
function zoomForPlaceType(type) {
  return PLACE_TYPE_ZOOM[type] || DEFAULT_PLACE_ZOOM;
}
const constructAddressString = (property) => {
  if (!property) return "Location unavailable";
  if (property.address) return property.address; 
  if (property.location) return property.location; 

  const addressParts = [
    property.addressLine1,
    property.addressLine2,
    property.upazila,
    property.cityTown,
    property.district,
    property.postalCode,
  ].filter(Boolean);
  return addressParts.length > 0
    ? addressParts.join(", ")
    : "Location details not available";
};

const MapPage = () => {
  const { propertyCode } = useParams();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  // Same "sm" breakpoint ai_chatbot.js's own panel styling switches on
  // (width: {xs: "calc(100vw - 48px)", sm: 400}) - not a separately chosen
  // number, so this stays in sync with that component's actual layout.
  const isDesktopChatbotWidth = useMediaQuery(theme.breakpoints.up("sm"));

  const [searchQuery, setSearchQuery] = useState("");
  
  const [propertyTypeFilter, setPropertyTypeFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  
  const [detailedFilters, setDetailedFilters] = useState({
    priceRange: [0, 50000000],
    bedrooms: "any",
    bathrooms: "any",
    propertyType: "any", 
  });
  const [notification, setNotification] = useState({
    open: false,
    message: "",
    severity: "info",
  });
  const [showLocationInfo, setShowLocationInfo] = useState(false);

  // ── Chatbot recommendation mode ─────────────────────────────────────────
  // Detects router state set by ai_chatbot.js's "View on map" button
  // (navigate("/map", { state: { recommendedProperties, ... } })). Derived
  // via useMemo (not copied into local state) so it always reflects exactly
  // what this navigation carried, with no separate sync effect needed - and
  // recomputes for free if this same MapPage instance is ever re-navigated
  // to with new state.
  //
  // SAFETY: uses getPropertyCoordinates() (real coordinates only, null if
  // none) - NEVER getPropertyDisplayCoordinates() (which useMapData's own
  // createStableProperty uses for normal /map browsing, and which falls
  // back to a division/district centroid for display purposes). A
  // recommended property with no real geocoded location is silently
  // excluded from the map here, never plotted at a fake centroid as if it
  // were the real recommendation.
  // NOTE: this derives the verifiable property list and the set of
  // REQUESTED amenity categories/radii only - it deliberately no longer
  // derives POI markers itself (that was the old, insufficient
  // "_amenityMatches[].nearestPOI only" approach, which could only ever show
  // ONE POI per category - see fetchAmenityPois below, which queries the
  // real /api/pois/nearby endpoint for every matching POI instead).
  const recommendationData = useMemo(() => {
    const rawProperties = routerLocation.state?.recommendedProperties;
    if (!Array.isArray(rawProperties) || rawProperties.length === 0) return null;

    const properties = [];
    rawProperties.forEach((rawProperty) => {
      // Two checks are both required, not just getPropertyCoordinates()
      // alone: a "district-level" property's geoLocation.coordinates is
      // NOT empty - the backend already wrote a generic district-centroid
      // fallback into it at creation time (see propertyController.js's
      // getDistrictCoordinates()), so getPropertyCoordinates() alone can't
      // tell a genuinely precise/approximate geocode apart from that
      // generic centroid; both look like "a real stored coordinate" to it.
      // locationAccuracy is what actually distinguishes them - the same gate
      // recommendationService.js's own getVerifiableCoordinates() already
      // uses server-side, mirrored here so the map can never plot a
      // district-level property as if it were a precise recommendation, and
      // never becomes the origin of a nearby-POI search either.
      const isVerifiableAccuracy =
        rawProperty.locationAccuracy === "precise" ||
        rawProperty.locationAccuracy === "approximate";
      const coords = isVerifiableAccuracy ? getPropertyCoordinates(rawProperty) : null;
      if (!coords) return; // no real, trustworthy coordinates - excluded, not faked
      properties.push({ ...rawProperty, position: coords });
    });

    // The requested-amenity intent (category + the user's own requested
    // radius, when they gave one) - read directly off the backend's already-
    // computed _amenityMatches (recommendationService.js's
    // findNearestAmenityMatch: { category, requestedMaxDistanceKm, ... }),
    // never re-parsed from chat text. Every candidate property was analyzed
    // against the exact same amenities list server-side (ragService.js's
    // runRAG), so this is deduped by category (first-seen wins) rather than
    // unioned per-property - there is only ever one true intent list per
    // chatbot response. Derived from ALL raw properties (not just the
    // verifiable ones above) since even a district-level candidate still
    // carries the full, correctly-shaped amenityMatches array.
    const amenityByCategory = new Map();
    rawProperties.forEach((rawProperty) => {
      if (!Array.isArray(rawProperty._amenityMatches)) return;
      rawProperty._amenityMatches.forEach((match) => {
        if (!match || !match.category || amenityByCategory.has(match.category)) return;
        amenityByCategory.set(match.category, {
          category: match.category,
          maxDistanceKm:
            typeof match.requestedMaxDistanceKm === "number" ? match.requestedMaxDistanceKm : null,
        });
      });
    });

    if (properties.length === 0) return null;
    return { properties, amenityIntent: Array.from(amenityByCategory.values()) };
  }, [routerLocation.state]);

  const [recommendationPois, setRecommendationPois] = useState([]);
  const [poisLoading, setPoisLoading] = useState(false);
  const poiFetchSeq = useRef(0);

  // Fetches ALL real POIs (not just the single nearest one per category)
  // matching every requested amenity category, around EVERY verifiable
  // recommended property, via the existing /api/pois/nearby endpoint -
  // reused as-is, no new backend endpoint. Bounded: only verifiable
  // properties × only requested categories × the endpoint's own existing
  // limit/radius caps (see POI_FETCH_LIMIT above) - for a typical chatbot
  // result (<=5 candidates, ragService.js's CONFIG.MAX_RESULTS, and
  // typically 1-3 requested categories) this is at most ~15 small indexed
  // geo queries, run concurrently. A request-sequence guard (poiFetchSeq)
  // discards any response superseded by a newer navigation before it can
  // apply stale results, the same pattern used elsewhere in this app (see
  // MyPropertyPage.js's fetchTrackedProperties).
  useEffect(() => {
    if (!recommendationData || recommendationData.amenityIntent.length === 0) {
      setRecommendationPois([]);
      setPoisLoading(false);
      return;
    }

    const seq = ++poiFetchSeq.current;
    setPoisLoading(true);

    const tasks = [];
    recommendationData.properties.forEach((property) => {
      recommendationData.amenityIntent.forEach((amenity) => {
        tasks.push(
          axios
            .get(`${API_BASE_URL}/pois/nearby`, {
              params: {
                lat: property.position.lat,
                lng: property.position.lng,
                category: amenity.category,
                limit: POI_FETCH_LIMIT,
                // Only sent when the user actually requested a distance for
                // this category - otherwise omitted entirely so the backend
                // applies ITS OWN existing default radius
                // (poiController.js's DEFAULT_RADIUS_METERS), never a second,
                // frontend-invented default.
                ...(amenity.maxDistanceKm != null
                  ? { radius: Math.round(amenity.maxDistanceKm * 1000) }
                  : {}),
              },
            })
            .then((res) => (res.data && Array.isArray(res.data.results) ? res.data.results : []))
            .catch((err) => {
              // One failing category/property pair must not break the whole
              // map - keep every other successfully-loaded category/property
              // (Promise.all below still resolves; this task just
              // contributes nothing). `null` (not []) so the aggregation
              // below can tell "this query genuinely found nothing" apart
              // from "this query failed", to surface a subtle warning for
              // the latter without ever fabricating a replacement result.
              console.error(
                `Error fetching nearby "${amenity.category}" POIs for "${property.title || property._id}":`,
                err.message
              );
              return null;
            })
        );
      });
    });

    Promise.all(tasks).then((resultLists) => {
      if (seq !== poiFetchSeq.current) return; // superseded by a newer navigation

      if (resultLists.some((list) => list === null)) {
        setNotification({
          open: true,
          message: t(
            "map_poi_partial_error",
            "Some nearby places could not be loaded."
          ),
          severity: "warning",
        });
      }

      // Dedup: the same real POI can legitimately be found by more than one
      // recommended property's search (View all on map) - never rendered
      // twice. Prefer the POI's own stable Mongo _id (poiService.js's
      // findNearbyPOIs returns it as `id`); only falls back to a
      // category+coordinate+name key on the (expected-never) chance a result
      // is missing it. Keeps the SMALLEST distanceMeters seen across every
      // property that matched it, for the popup's "X m from recommended
      // property" text - a real, backend-computed distance, never invented.
      const byId = new Map();
      resultLists.forEach((list) => {
        if (!Array.isArray(list)) return; // a failed task (null) - skip, already surfaced above
        list.forEach((poi) => {
          const coords = poi.geoLocation && poi.geoLocation.coordinates;
          if (!Array.isArray(coords) || coords.length !== 2) return;
          const [lng, lat] = coords;
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

          const key = poi.id
            ? String(poi.id)
            : `${poi.category}:${lng.toFixed(4)},${lat.toFixed(4)}:${poi.name || ""}`;
          const existing = byId.get(key);
          const distanceMeters =
            typeof poi.distanceMeters === "number" ? poi.distanceMeters : null;
          if (
            !existing ||
            existing.distanceMeters === null ||
            (distanceMeters !== null && distanceMeters < existing.distanceMeters)
          ) {
            byId.set(key, {
              name: poi.name || poi.nameEn || poi.nameBn || null,
              category: poi.category,
              coordinates: [lng, lat],
              distanceMeters,
            });
          }
        });
      });

      setRecommendationPois(Array.from(byId.values()));
      setPoisLoading(false);
    });
  }, [recommendationData, t]);

  // Camera strategy for recommendation mode - a single distinct point
  // centers/zooms directly (avoids fitBounds on a zero-area box); 2+
  // distinct points fit as a box, reusing MapComponent's own existing
  // fitBounds logic (see its `initialFitBounds` prop) rather than
  // duplicating camera math here. Recomputed as recommendationPois arrives
  // (asynchronously, see above) so the camera widens from a tight
  // single-property zoom to a bounds-fit once POIs load, rather than only
  // ever reflecting the properties that were known at mount time.
  //
  // Bounded strategy (properties are the primary geographic objects, POIs
  // are context): bounds are derived from the recommended properties FIRST,
  // and a POI only expands that box when it sits reasonably close to the
  // existing property cluster - a POI far outside the neighbourhood (e.g.
  // the only real match for a generously-radius'd request) still renders on
  // the map, it just doesn't force the whole camera to zoom out to include
  // it. Never removes or hides a valid POI, only decides what the INITIAL
  // camera frames.
  const recommendationCamera = useMemo(() => {
    if (!recommendationData) return null;
    const propertyCoords = recommendationData.properties.map((p) => [p.position.lng, p.position.lat]);
    if (propertyCoords.length === 0) return null;

    function boundsOf(coordList) {
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      coordList.forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      });
      return { minLng, minLat, maxLng, maxLat };
    }

    const propertyBounds = boundsOf(propertyCoords);
    const propertyDiagonal = Math.hypot(
      propertyBounds.maxLng - propertyBounds.minLng,
      propertyBounds.maxLat - propertyBounds.minLat
    );
    const centerLng = (propertyBounds.minLng + propertyBounds.maxLng) / 2;
    const centerLat = (propertyBounds.minLat + propertyBounds.maxLat) / 2;
    // 1.5x the property cluster's own diagonal, with a ~1.1km floor so a
    // single tight property (diagonal ~0) still has a sensible radius to
    // decide "is this POI reasonably close" against.
    const expansionRadiusDegrees = Math.max(propertyDiagonal * 1.5, 0.01);

    const nearbyPoiCoords = recommendationPois
      .map((p) => p.coordinates)
      .filter(
        ([lng, lat]) => Math.hypot(lng - centerLng, lat - centerLat) <= expansionRadiusDegrees
      );

    const allCoords = [...propertyCoords, ...nearbyPoiCoords];
    const uniqueKeys = new Set(
      allCoords.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`)
    );
    if (uniqueKeys.size <= 1) {
      const [lng, lat] = allCoords[0];
      return { mode: "point", center: [lat, lng], zoom: 15 };
    }

    const finalBounds = boundsOf(allCoords);
    return {
      mode: "bounds",
      bounds: [
        [finalBounds.minLng, finalBounds.minLat],
        [finalBounds.maxLng, finalBounds.maxLat],
      ],
    };
  }, [recommendationData, recommendationPois]);

  // ai_chatbot.js's floating panel is visible (it's how the user got here -
  // "View on map"/"View all on map" only exist inside that open panel) and
  // occupies the right side of the screen on desktop, so recommendation-mode
  // fitBounds/camera padding reserves that space instead of treating the
  // whole canvas as equally visible. Undefined outside recommendation mode -
  // MapComponent's own small symmetric default applies for normal /map
  // browsing, matching its pre-existing behaviour exactly.
  const recommendationFitPadding = useMemo(() => {
    if (!recommendationData) return undefined;
    if (!isDesktopChatbotWidth) {
      // Mobile: ai_chatbot.js's panel is a near-fullscreen overlay there,
      // not a side panel - no right-side reservation makes sense, just a
      // normal symmetric margin so the property/POIs aren't flush with the
      // screen edge.
      return RECOMMENDATION_FIT_BASE_PADDING;
    }
    return {
      top: RECOMMENDATION_FIT_BASE_PADDING,
      bottom: RECOMMENDATION_FIT_BASE_PADDING,
      left: RECOMMENDATION_FIT_BASE_PADDING,
      right:
        RECOMMENDATION_FIT_BASE_PADDING +
        CHATBOT_PANEL_WIDTH +
        CHATBOT_PANEL_RIGHT_OFFSET +
        CHATBOT_CLEARANCE_MARGIN,
    };
  }, [recommendationData, isDesktopChatbotWidth]);

  const {
    properties: allMappableProperties,
    loading,
    error,
    userLocation,
    mapCenter,
    mapZoom,
    selectedProperty,
    locateUser,
    handleSelectProperty,
    clearSelectedProperty,
    handleMapMove,
    fetchPropertyByCode,
    goToLocation,
    restoreMapState,
  } = useMapData(propertyCode, { skipInitialFetch: !!recommendationData });

  // Individual chatbot "View on Map" (exactly one verifiable recommended
  // property) auto-selects that property, the same way clicking its pin
  // would - it must be "immediately obvious this is the property I
  // clicked": the selected-property halo (see MapComponent.js) and
  // PropertyInfoPanel both key off `selectedProperty`, so without this the
  // recommended property would render as just another normal, unselected
  // pin. "View all on map" (2+ properties) intentionally does NOT
  // auto-select any single one of them - keyed only on `recommendationData`
  // (stable per navigation) so this runs once per "View on map" click, not
  // on every later re-render (e.g. once POIs finish loading).
  useEffect(() => {
    if (recommendationData && recommendationData.properties.length === 1) {
      handleSelectProperty(recommendationData.properties[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendationData]);

  const { results: placeResults, status: placeSearchStatus } =
    useLocationSearch(searchQuery, i18n.language);

  const { route, status: routeStatus, showRouteToDestination, clearRoute } =
    useRouting();
  const [routeMode, setRouteMode] = useState("driving");

  // "Show Route" entry point - from an existing property interaction (the
  // selected property's info panel), per the Phase D brief. Reuses the
  // already-fetched userLocation (from a prior "Locate Me") as the origin
  // when available, so a second click doesn't re-prompt geolocation; the
  // hook itself falls back to a fresh geolocation request when there isn't
  // one yet.
  const showNotification = useCallback((message, severity = "info") => {
    setNotification({ open: true, message, severity });
  }, []);

  const handleShowRoute = useCallback(() => {
    if (!selectedProperty?.position) return;
    // selectedProperty.position may be a district/division DISPLAY fallback
    // (see useMapData's getPropertyDisplayCoordinates) rather than the
    // property's real geocoded location - routing to that centroid would
    // look like a real, precise route to the property, which it isn't.
    if (selectedProperty.locationAccuracy === "district-level") {
      showNotification(
        t(
          "route_unavailable_district_level",
          "Exact property location is unavailable, so a route cannot be calculated."
        ),
        "warning"
      );
      return;
    }
    showRouteToDestination(
      selectedProperty.position.lat,
      selectedProperty.position.lng,
      routeMode,
      userLocation
    );
  }, [
    selectedProperty,
    routeMode,
    userLocation,
    showRouteToDestination,
    showNotification,
    t,
  ]);

  // A route to a property that's no longer selected (switched to another
  // property, or deselected) would just be confusing - clear it
  // automatically rather than leaving a stale/wrong line on the map. Does
  // NOT clear the selection itself (that stays owned by useMapData, exactly
  // as before) and does not reset filters/search/camera.
  const selectedPropertyIdRef = useRef(null);
  useEffect(() => {
    const currentId = selectedProperty?._id || null;
    if (
      selectedPropertyIdRef.current !== null &&
      selectedPropertyIdRef.current !== currentId
    ) {
      clearRoute();
    }
    selectedPropertyIdRef.current = currentId;
  }, [selectedProperty, clearRoute]);

  // Surfaces routing failures through the page's existing Snackbar rather
  // than a new UI element - raw backend/Valhalla errors are never shown
  // (routingController.js/useRouting.js already reduce them to a small
  // status enum before they ever reach here).
  useEffect(() => {
    const ROUTE_STATUS_MESSAGES = {
      "no-route": ["route_not_found", "No route could be found to this property.", "warning"],
      unavailable: ["route_engine_unavailable", "Routing is temporarily unavailable. Please try again later.", "error"],
      "geolocation-denied": ["geolocation_denied", "Location access was denied. Enable location permissions to get directions.", "warning"],
      "geolocation-unavailable": ["geolocation_unavailable", "Your browser does not support location services.", "warning"],
      "outside-bangladesh": ["route_origin_outside_bangladesh", "Your current location is outside Bangladesh.", "warning"],
      error: ["route_error", "Could not calculate a route.", "error"],
    };
    const entry = ROUTE_STATUS_MESSAGES[routeStatus];
    if (entry) {
      const [key, fallback, severity] = entry;
      showNotification(t(key, fallback), severity);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeStatus]);

  // Consumes a Place selected on the homepage (HomeSearchBar navigates here
  // with `state: { place: { lat, lng, type } }`, the same React Router
  // location.state handoff pattern already used elsewhere in this app, e.g.
  // EditPropertyPage's return-path). Runs once on mount only - not a
  // continuous sync, so it can't create a camera feedback loop: it just
  // calls the same goToLocation() the /map search dropdown already uses,
  // reusing zoomForPlaceType so no camera/zoom logic is duplicated. Direct
  // /map visits (no state) are completely unaffected - routerLocation.state
  // is simply undefined then, and this effect no-ops.
  useEffect(() => {
    const place = routerLocation.state?.place;
    if (place && typeof place.lat === "number" && typeof place.lng === "number") {
      goToLocation(place.lat, place.lng, zoomForPlaceType(place.type));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restores the exact camera position (and, if any, the selected property)
  // the user had on THIS /map view right before they clicked "View Details"
  // and navigated away - see handleViewDetails below, which snapshots it
  // onto this same history entry via navigate(path, {replace:true, state}).
  // Pressing Back returns to that same entry, so routerLocation.state.
  // fromMap is populated again on remount - read once here, exactly like
  // the place-restore effect above, so it can't create a feedback loop or
  // re-fire on its own. Only handled when the URL has no :propertyCode of
  // its own - that case already has its own correct, dedicated centering
  // logic (the initialPropertyCode effect inside useMapData), which this
  // deliberately never overrides. Direct /map visits and the Home-> place
  // handoff above are both unaffected, since neither ever sets
  // state.fromMap.
  useEffect(() => {
    if (propertyCode) return;
    const fromMap = routerLocation.state?.fromMap;
    if (!fromMap || !Array.isArray(fromMap.center) || typeof fromMap.zoom !== "number") return;
    restoreMapState(fromMap.center, fromMap.zoom);
    if (fromMap.selectedPropertyId) {
      fetchPropertyByCode(fromMap.selectedPropertyId, { preserveCamera: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (propertyCode && selectedProperty?._id === propertyCode) {
      const message =
        selectedProperty.locationAccuracy === "district-level"
          ? t(
              "location_district_level",
              "Property loaded with district-level location. Exact location may vary."
            )
          : selectedProperty.locationAccuracy === "approximate"
          ? t(
              "location_approximate",
              "Property loaded with approximate location"
            )
          : t(
              "property_loaded",
              `Property '${
                selectedProperty.title || "Unnamed Property"
              }' loaded`
            );
      const severity =
        selectedProperty.locationAccuracy === "district-level"
          ? "warning"
          : "info";
      showNotification(message, severity);
    } else if (propertyCode && !loading && !selectedProperty) {
      
    }
  }, [propertyCode, selectedProperty, loading, t]);

  const filteredMapProperties = useMemo(() => {
    // Recommendation mode substitutes its own (already real-coordinate-only)
    // property subset for the normal full listing here - the existing
    // filter pipeline below (price/beds/baths/type/search) then applies to
    // it exactly as it would to any other property list. Safe because every
    // filter control resets to its permissive default on a fresh MapPage
    // mount (a "View on map" click always navigates into a new mount), so
    // nothing here can unexpectedly hide a just-shown recommendation.
    let propsToFilter = recommendationData
      ? [...recommendationData.properties]
      : Array.isArray(allMappableProperties)
      ? [...allMappableProperties]
      : [];

    // 1. Apply listingType filter (e.g., 'rent', 'buy', 'sold')
    if (propertyTypeFilter !== "all") {
      propsToFilter = propsToFilter.filter(
        (p) => p.listingType === propertyTypeFilter
      );
    }

    // 2. Apply detailed filters from FilterSidebar state ('detailedFilters')
    propsToFilter = propsToFilter.filter((p) => {
      if (!p) return false;
      const priceMatch =
        p.price !== null && p.price !== undefined
          ? (() => {
              const [minPrice, maxPrice] = detailedFilters.priceRange;
              return (
                p.price >= minPrice &&
                (maxPrice === 50000000 ? true : p.price <= maxPrice)
              );
            })()
          : true;

      let bedMatch = true;
      if (
        detailedFilters.bedrooms !== "any" &&
        p.bedrooms !== null &&
        p.bedrooms !== undefined
      ) {
        const requiredBeds = parseInt(detailedFilters.bedrooms, 10);
        bedMatch =
          detailedFilters.bedrooms === "5"
            ? p.bedrooms >= requiredBeds
            : p.bedrooms === requiredBeds;
      } else if (
        detailedFilters.bedrooms !== "any" &&
        (p.bedrooms === null || p.bedrooms === undefined)
      ) {
        bedMatch = false;
      }

      let bathMatch = true;
      if (
        detailedFilters.bathrooms !== "any" &&
        p.bathrooms !== null &&
        p.bathrooms !== undefined
      ) {
        const requiredBaths = parseInt(detailedFilters.bathrooms, 10);
        bathMatch =
          detailedFilters.bathrooms === "3"
            ? p.bathrooms >= requiredBaths
            : p.bathrooms === requiredBaths;
      } else if (
        detailedFilters.bathrooms !== "any" &&
        (p.bathrooms === null || p.bathrooms === undefined)
      ) {
        bathMatch = false;
      }
      const typeMatch =
        detailedFilters.propertyType === "any" ||
        (p.propertyType &&
          p.propertyType.toLowerCase() ===
            detailedFilters.propertyType.toLowerCase());

      return priceMatch && bedMatch && bathMatch && typeMatch;
    });

    // 3. Apply Search Query
    if (searchQuery && searchQuery.trim() !== "") {
      const sq = searchQuery.toLowerCase().trim();
      const propsWithAddress = propsToFilter.map((p) => ({
        ...p,
        addressForSearch: constructAddressString(p),
      }));
      propsToFilter = propsWithAddress.filter(
        (p) =>
          (p.title && p.title.toLowerCase().includes(sq)) ||
          (p.addressForSearch &&
            p.addressForSearch.toLowerCase().includes(sq)) ||
          (p.district && p.district.toLowerCase().includes(sq)) ||
          (p.cityTown && p.cityTown.toLowerCase().includes(sq)) ||
          (p.upazila && p.upazila.toLowerCase().includes(sq))
      );
    }
    return propsToFilter;
  }, [allMappableProperties, propertyTypeFilter, detailedFilters, searchQuery]);

  // Combined search dropdown options: property matches (already computed
  // above by the existing filter, unchanged) plus place-search results,
  // clearly grouped so a "Property" option can never be confused with a
  // "Place" one. Property text-filtering of the map's displayed dots (the
  // existing behavior) is entirely unaffected by this - it's driven by
  // filteredMapProperties/searchQuery above regardless of what's selected
  // from this dropdown.
  const searchOptions = useMemo(() => {
    if (!searchQuery || searchQuery.trim().length < 2) return [];
    const propertyOptions = filteredMapProperties.slice(0, 5).map((p) => ({
      __type: "property",
      label: p.title || "Unnamed Property",
      property: p,
    }));
    const placeOptions = placeResults.map((place) => ({
      __type: "place",
      label: place.displayName,
      place,
    }));
    return [...propertyOptions, ...placeOptions];
  }, [searchQuery, filteredMapProperties, placeResults]);

  const handleSearchOptionSelect = useCallback(
    (option) => {
      if (!option || typeof option === "string") return;
      if (option.__type === "property") {
        handleSelectProperty(option.property);
        setSearchQuery(option.label);
      } else if (option.__type === "place") {
        goToLocation(option.place.lat, option.place.lng, zoomForPlaceType(option.place.type));
        setSearchQuery("");
      }
    },
    [handleSelectProperty, goToLocation]
  );

  const handlePropertyTypeFilterChange = (event, newType) => {
    if (newType !== null) {
      setPropertyTypeFilter(newType);
      clearSelectedProperty(); 
    }
  };
  const handleCloseNotification = () =>
    setNotification((prev) => ({ ...prev, open: false }));
  const toggleLocationInfo = () => setShowLocationInfo((prev) => !prev);

  const handleDetailedFilterChange = (newFilters) =>
    setDetailedFilters(newFilters);
  const handleResetDetailedFilters = () => {
    setDetailedFilters({
      priceRange: [0, 50000000],
      bedrooms: "any",
      bathrooms: "any",
      propertyType: "any",
    });
    showNotification(t("filters_reset", "Filters reset"), "info");
  };
  const handleCloseFiltersDrawer = () => setFiltersOpen(false);
  const handleOpenFiltersDrawer = () => setFiltersOpen(true);

  const clearAllPageFilters = () => {
    setSearchQuery("");
    setPropertyTypeFilter("all"); 
    handleResetDetailedFilters(); 
    clearSelectedProperty();
  };
  const handleBack = () => navigate(-1);


  const onMarkerPropertySelect = useCallback(
    (property) => {
      handleSelectProperty(property);
    },
    [handleSelectProperty]
  );

  // "View Details" from the map - snapshots the current camera + selected
  // property onto THIS /map history entry (replace: no new entry, no URL
  // change) before navigating away, so browser Back restores exactly this
  // view instead of remounting MapPage with no state at all (see the
  // restoration effect above). A plain replace here is safe to call
  // multiple times in a row (e.g. selecting different properties before
  // ever clicking View Details) since it always overwrites the same entry,
  // never accumulates extra history entries.
  const handleViewDetails = useCallback(
    (property) => {
      if (!property?._id) return;
      navigate(routerLocation.pathname, {
        replace: true,
        state: {
          fromMap: {
            center: mapCenter,
            zoom: mapZoom,
            selectedPropertyId: property._id,
          },
        },
      });
      navigate(`/properties/details/${property._id}`);
    },
    [navigate, routerLocation.pathname, mapCenter, mapZoom]
  );

  return (
    <Box
      sx={{
        height: "calc(100vh - 64px)",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      <Paper
        elevation={2}
        sx={{
          p: 1,
          m: { xs: 1, sm: 2 },
          mb: 0,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 1,
          borderRadius: "12px",
          zIndex: 1100,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: { xs: 0.5, sm: 1.5 },
            flexWrap: "wrap",
          }}
        >
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={handleBack}
            variant="outlined"
            size="small"
          >
            {t("back", "Back")}
          </Button>
          <Autocomplete
            freeSolo
            filterOptions={(x) => x}
            options={searchOptions}
            loading={placeSearchStatus === "loading"}
            inputValue={searchQuery}
            onInputChange={(event, newValue, reason) => {
              if (reason === "input") setSearchQuery(newValue);
            }}
            onChange={(event, newValue) => handleSearchOptionSelect(newValue)}
            groupBy={(option) =>
              option.__type === "property"
                ? t("search_group_properties", "Properties")
                : t("search_group_places", "Places")
            }
            getOptionLabel={(option) =>
              typeof option === "string" ? option : option.label
            }
            noOptionsText={
              placeSearchStatus === "unavailable"
                ? t("location_search_unavailable", "Location search unavailable")
                : t("no_results", "No results")
            }
            renderOption={(props, option) => {
              const secondaryContext =
                option.__type === "place"
                  ? [option.place.context.district, option.place.context.division]
                      .filter(Boolean)
                      .join(", ")
                  : "";
              return (
                <Box
                  component="li"
                  {...props}
                  key={`${option.__type}-${option.label}-${option.place?.id || option.property?._id}`}
                  sx={{ alignItems: "flex-start !important", py: 0.75 }}
                >
                  {option.__type === "property" ? (
                    <HomeWorkIcon fontSize="small" sx={{ mr: 1, mt: 0.25, color: "text.secondary", flexShrink: 0 }} />
                  ) : (
                    <LocationOnIcon fontSize="small" sx={{ mr: 1, mt: 0.25, color: "text.secondary", flexShrink: 0 }} />
                  )}
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {option.__type === "place" ? option.place.shortName : option.label}
                    </Typography>
                    {secondaryContext && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {secondaryContext}
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            }}
            sx={{
              width: { xs: "100%", sm: 340, md: 440 },
              mt: { xs: 1, sm: 0 },
            }}
            slotProps={{
              popper: {
                sx: { width: { xs: "100%", sm: 420, md: 480 } },
                placement: "bottom-start",
              },
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={t(
                  "search_map_placeholder",
                  "Search title, address, or place..."
                )}
                variant="outlined"
                size="small"
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  sx: { borderRadius: "8px", fontSize: "0.875rem" },
                }}
              />
            )}
          />
          <Tooltip title={t("filters", "Filters")}>
            <IconButton
              onClick={handleOpenFiltersDrawer}
              color="primary"
              size="small"
            >
              <FilterListIcon />
            </IconButton>
          </Tooltip>
        </Box>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: { xs: 0.5, sm: 1.5 },
            flexWrap: "wrap",
            justifyContent: { xs: "space-between", sm: "flex-end" },
            width: { xs: "100%", sm: "auto" },
            mt: { xs: 1, sm: 0 },
          }}
        >
          <ToggleButtonGroup
            value={propertyTypeFilter}
            exclusive
            onChange={handlePropertyTypeFilterChange}
            aria-label="property type filter"
            size="small"
          >
            <ToggleButton value="all" sx={{ fontSize: "0.75rem", px: 1 }}>
              {t("all_types", "All")}
            </ToggleButton>
            <ToggleButton value="rent" sx={{ fontSize: "0.75rem", px: 1 }}>
              {t("nav_rent", "Rent")}
            </ToggleButton>
            <ToggleButton value="buy" sx={{ fontSize: "0.75rem", px: 1 }}>
              {t("nav_buy", "Buy")}
            </ToggleButton>
            <ToggleButton value="sold" sx={{ fontSize: "0.75rem", px: 1 }}>
              {t("nav_sold", "Sold")}
            </ToggleButton>
          </ToggleButtonGroup>
          <Tooltip title={t("locate_me", "Locate Me")}>
            <IconButton onClick={locateUser} color="primary" size="small">
              <MyLocationIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("location_accuracy_info", "Location Info")}>
            <IconButton onClick={toggleLocationInfo} color="info" size="small">
              <InfoIcon />
            </IconButton>
          </Tooltip>
          <Button
            onClick={clearAllPageFilters}
            size="small"
            sx={{ fontSize: "0.75rem" }}
          >
            {t("clear_all", "Clear All")}
          </Button>
        </Box>
      </Paper>

      {error && (
        <Alert
          severity="error"
          sx={{
            position: "absolute",
            top: "80px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1001,
            width: "auto",
            maxWidth: "90%",
          }}
          onClose={() => {
            /* Consider if clearSelectedProperty or specific error clear is needed */
          }}
        >
          {error}
        </Alert>
      )}

      <Box
        sx={{
          flexGrow: 1,
          position: "relative",
          m: { xs: 1, sm: 2 },
          mt: 1,
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: 1,
        }}
      >
        {loading && !selectedProperty ? ( 
          <Box
            sx={{
              height: "100%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              flexDirection: "column",
            }}
          >
            <CircularProgress />{" "}
            <Typography sx={{ mt: 2 }}>
              {t("loading_map", "Loading map data...")}
            </Typography>
          </Box>
        ) : (
          <MapComponent
            properties={filteredMapProperties}
            mapCenter={
              recommendationCamera?.mode === "point"
                ? recommendationCamera.center
                : mapCenter
            }
            mapZoom={
              recommendationCamera?.mode === "point"
                ? recommendationCamera.zoom
                : mapZoom
            }
            userLocation={userLocation}
            selectedProperty={selectedProperty}
            onMarkerClick={onMarkerPropertySelect}
            onMapMove={handleMapMove}
            route={route}
            pois={recommendationPois}
            initialFitBounds={
              recommendationCamera?.mode === "bounds"
                ? recommendationCamera.bounds
                : null
            }
            fitPadding={recommendationFitPadding}
          />
        )}
        {/* Small, non-blocking indicator while requested-amenity POIs are
            still loading (property markers are already visible by this
            point - this never blocks or replaces the map itself, per the
            "should not silently look empty while POIs are loading"
            requirement). */}
        {poisLoading && (
          <Box
            sx={{
              position: "absolute",
              bottom: 12,
              right: 12,
              zIndex: 5,
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 1.5,
              py: 0.75,
              borderRadius: "8px",
              bgcolor: "background.paper",
              boxShadow: 2,
            }}
          >
            <CircularProgress size={14} thickness={5} />
            <Typography variant="caption" sx={{ fontSize: "0.7rem" }}>
              {t("loading_nearby_places", "Loading nearby places...")}
            </Typography>
          </Box>
        )}
        {selectedProperty && (
          <PropertyInfoPanel
            selectedProperty={selectedProperty}
            routeStatus={routeStatus}
            route={route}
            routeMode={routeMode}
            onRouteModeChange={setRouteMode}
            onShowRoute={handleShowRoute}
            onClearRoute={clearRoute}
            onViewDetails={handleViewDetails}
          />
        )}
      </Box>

      <Drawer
        anchor="left"
        open={filtersOpen}
        onClose={handleCloseFiltersDrawer}
        PaperProps={{ sx: { width: "80%", maxWidth: "320px" } }}
      >
        <Box
          sx={{
            p: 2,
            display: "flex",
            flexDirection: "column",
            height: "100%",
          }}
        >
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Typography variant="h6">{t("filters", "Filters")}</Typography>
            <IconButton onClick={handleCloseFiltersDrawer} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
          <Divider sx={{ my: 1 }} />
          <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
            <FilterSidebar
              filters={detailedFilters}
              onFilterChange={handleDetailedFilterChange}
              onResetFilters={handleResetDetailedFilters}
              isMobile={true} // Assuming sidebar adapts
              onClose={handleCloseFiltersDrawer}
            />
          </Box>
        </Box>
      </Drawer>

      <Drawer
        anchor="bottom"
        open={showLocationInfo}
        onClose={toggleLocationInfo}
        PaperProps={{
          sx: {
            maxHeight: "60%",
            borderTopLeftRadius: "16px",
            borderTopRightRadius: "16px",
          },
        }}
      >
        <Box sx={{ p: 2 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 1,
            }}
          >
            <Typography variant="h6">
              {t("location_accuracy_info", "Location Accuracy Information")}
            </Typography>
            <IconButton onClick={toggleLocationInfo} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body1" paragraph>
            {t(
              "location_info_description",
              "Property locations are displayed with different accuracy levels:"
            )}
          </Typography>
          {/* Accuracy descriptions... */}
          <Box sx={{ mb: 2 }}>
            <Typography
              variant="subtitle1"
              sx={{ display: "flex", alignItems: "center", mb: 1 }}
            >
              <Chip
                size="small"
                color="success"
                label="P"
                sx={{ mr: 1, width: 24, height: 24 }}
              />
              {t("precise_location_title", "Precise Location (P)")}
            </Typography>
            <Typography variant="body2" sx={{ ml: 4, mb: 2 }}>
              {t(
                "precise_location_desc",
                "The property is located at this exact point."
              )}
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ display: "flex", alignItems: "center", mb: 1 }}
            >
              <Chip
                size="small"
                color="warning"
                label="A"
                sx={{ mr: 1, width: 24, height: 24 }}
              />
              {t("approximate_location_title", "Approximate Location (A)")}
            </Typography>
            <Typography variant="body2" sx={{ ml: 4, mb: 2 }}>
              {t(
                "approximate_location_desc",
                "The property is near this point; exact location may vary."
              )}
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ display: "flex", alignItems: "center", mb: 1 }}
            >
              <Chip
                size="small"
                color="error"
                label="D"
                sx={{ mr: 1, width: 24, height: 24 }}
              />
              {t("district_location_title", "District-Level (D)")}
            </Typography>
            <Typography variant="body2" sx={{ ml: 4 }}>
              {t(
                "district_location_desc",
                "Only the general district is known."
              )}
            </Typography>
          </Box>
          <Alert severity="info">
            {t(
              "directions_info",
              "For 'Directions', the property's address (if available) is prioritized over map coordinates for better accuracy."
            )}
          </Alert>
          <Box sx={{ mt: 2, display: "flex", justifyContent: "flex-end" }}>
            <Button variant="contained" onClick={toggleLocationInfo}>
              {t("close", "Close")}
            </Button>
          </Box>
        </Box>
      </Drawer>

      <Snackbar
        open={notification.open}
        autoHideDuration={4000}
        onClose={handleCloseNotification}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={handleCloseNotification}
          severity={notification.severity}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {notification.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default MapPage;
