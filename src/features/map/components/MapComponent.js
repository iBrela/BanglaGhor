import React, { useEffect, useRef } from "react";
import { Box, Typography, Alert, CircularProgress } from "@mui/material";
import { useTranslation } from "react-i18next";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { createBangladeshStyle, getPmtilesUrl } from "../mapBasemapStyle";
import { BANGLADESH_BOUNDS_BUFFERED } from "../bangladeshBounds";

// [lat, lng] placeholder meaning "no specific location was requested" - see
// isDefaultNationwideView() below. Matches useMapData.js's own DEFAULT_CENTER
// so MapPage's initial state (no propertyCode) is recognized as this signal.
const DEFAULT_CENTER = [23.8103, 90.4125];
const DEFAULT_ZOOM = 7;
// Lower floor than the archive's own centerZoom:6 (confirmed via PMTiles
// header metadata) - real browser aspect ratios (wide/short desktop windows)
// can need to zoom out past 6 for fitBounds to fit the whole country's
// north-south extent, since Bangladesh's bounding box is taller than it is
// wide. 4 gives comfortable headroom beyond any realistic viewport while
// still preventing zooming out into irrelevant surrounding territory.
const MIN_ZOOM = 4;
// Archive's real maxzoom is 15 (confirmed via PMTiles header). 18 allows a
// modest overzoom buffer for close inspection without pretending the source
// has detail it doesn't - MapLibre just scales up the z15 tile data past that.
const MAX_ZOOM = 18;
// Default padding for the initial fitBounds-to-Bangladesh camera (see
// isDefaultNationwideView) - overridable per-consumer via the fitPadding
// prop. 32px reads as a clearly visible margin (vs. edge-to-edge) on both
// small and large screens.
const INITIAL_FIT_PADDING = 32;
// Extra pan allowance (in degrees) added around the initial fitted view when
// deriving maxBounds for the default nationwide camera - see the mount
// effect for why this is derived from the fitted view rather than a fixed
// box. Modest on purpose: enough to nudge around the edges, not enough to
// wander into unrelated territory.
const PAN_MARGIN_DEGREES = 1;

// Bangladesh bounding box (confirmed archive bounds + shared buffer),
// expressed as MapLibre's [ [west, south], [east, north] ] ([lng, lat] pairs).
const BANGLADESH_BOUNDS = [
  [BANGLADESH_BOUNDS_BUFFERED.minLon, BANGLADESH_BOUNDS_BUFFERED.minLat],
  [BANGLADESH_BOUNDS_BUFFERED.maxLon, BANGLADESH_BOUNDS_BUFFERED.maxLat],
];

const SELECTED_COLOR = "#E91E63";
// Listing-type colors, matching the color convention already used for the
// Rent/For Sale/Sold chips elsewhere in the app (PropertyInfoPanel).
const RENT_COLOR = "#0288D1"; // MUI info.main
const BUY_COLOR = "#2E7D32"; // MUI success.main
const SOLD_COLOR = "#757575"; // MUI grey (default)
const FONT_BOLD = "Noto Sans Bold"; // same glyph stack the basemap style already loads

// Route line colors. A vivid blue reads clearly as "this is a route" (the
// same convention most map apps use) and, more importantly here, contrasts
// strongly against this basemap's own road palette, which is entirely warm
// amber/orange tones (see mapBasemapStyle.js) - never confusable with the
// property markers above, since those are small dots/pills, not a
// continuous line, regardless of hue closeness to RENT_COLOR.
const ROUTE_LINE_COLOR = "#1A73E8";
const ROUTE_CASING_COLOR = "#ffffff";
// Caps how tight the camera zooms in when fitting a very short route (e.g.
// a walking route across one block) - fitBounds would otherwise zoom in to
// the map's own MAX_ZOOM, which reads as an unhelpfully extreme close-up
// for a route that's only a few dozen meters long.
const ROUTE_FIT_MAX_ZOOM = 16;
const ROUTE_FIT_PADDING = 64;

// Individual property dots are hidden entirely below this zoom (nationwide/
// regional views stay clean, basemap-only). Matches road-secondary-tertiary's
// own minzoom in mapBasemapStyle.js, so dots only appear once there's
// meaningful road context on the basemap to place them against - not picked
// as an arbitrary number.
const MARKER_MIN_ZOOM = 9;
// Price pills wait until individual dots have had a beat to settle in as
// their own zoom tier, so the transition into "individual markers" doesn't
// also dump a wall of price text at once.
const PRICE_LABEL_MIN_ZOOM = 14;

// Tolerance used to detect "the map is already at this position" so the
// camera-sync effect doesn't redundantly call jumpTo() in response to its
// own moveend/zoomend echo (see the camera-sync effect below).
const CENTER_EPSILON_DEGREES = 1e-4; // ~11m at the equator
const ZOOM_EPSILON = 0.01;

function toLngLat([lat, lng]) {
  return [lng, lat];
}

function isValidCenter(center) {
  return (
    Array.isArray(center) &&
    center.length === 2 &&
    typeof center[0] === "number" &&
    typeof center[1] === "number"
  );
}

// True when mapCenter/mapZoom are still exactly the literal placeholder
// values every caller passes for "no specific location requested" (MapPage
// with no propertyCode, HomeMapPreview, HomeSearchBar's picker dialog before
// a selection). This is a value-based signal, not a dedicated prop, so it's
// only meaningful because every current caller happens to use this same
// literal default - if a future caller ever needs to genuinely navigate BACK
// to this exact point/zoom as a deliberate action, it won't register as one
// (see the mount effect and camera-sync effect below for how this is used).
function isDefaultNationwideView(center, zoom) {
  return (
    isValidCenter(center) &&
    center[0] === DEFAULT_CENTER[0] &&
    center[1] === DEFAULT_CENTER[1] &&
    zoom === DEFAULT_ZOOM
  );
}

// Formats a raw BDT price into the compact Bangladeshi lakh/crore notation
// used throughout South Asian real estate listings (e.g. 25000 -> "৳25K",
// 8000000 -> "৳80L", 12000000 -> "৳1.2Cr"). Rent listings get a "/mo" suffix
// so a monthly rent pill isn't mistaken for a sale price.
function trimDecimal(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatCompactBDT(price, listingType) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return "";
  let label;
  if (n >= 1e7) label = `৳${trimDecimal(n / 1e7)}Cr`;
  else if (n >= 1e5) label = `৳${trimDecimal(n / 1e5)}L`;
  else if (n >= 1e3) label = `৳${trimDecimal(n / 1e3)}K`;
  else label = `৳${Math.round(n)}`;
  return listingType === "rent" ? `${label}/mo` : label;
}

function propertiesToGeoJSON(properties) {
  return {
    type: "FeatureCollection",
    features: properties
      .filter(
        (p) =>
          p &&
          p._id &&
          p.position &&
          typeof p.position.lat === "number" &&
          typeof p.position.lng === "number"
      )
      .map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.position.lng, p.position.lat] },
        properties: {
          _id: p._id,
          listingType: p.listingType || "buy",
          priceLabel: formatCompactBDT(p.price, p.listingType),
        },
      })),
  };
}

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

// Distinct from every existing marker/route color (SELECTED_COLOR/
// RENT_COLOR/BUY_COLOR/SOLD_COLOR/ROUTE_LINE_COLOR) so a POI marker can
// never be mistaken for a property marker at a glance.
const POI_MARKER_COLOR = "#7B1FA2";

// Chatbot recommendation POIs only - already real, backend-verified
// { name, category, coordinates: [lng, lat] } objects (see MapPage.js's
// derivation from _amenityMatches). No fetching, no geocoding here; this is
// purely a display-shape conversion, same role as propertiesToGeoJSON above.
function poisToGeoJSON(pois) {
  return {
    type: "FeatureCollection",
    features: (pois || [])
      .filter(
        (p) =>
          p &&
          Array.isArray(p.coordinates) &&
          p.coordinates.length === 2 &&
          Number.isFinite(p.coordinates[0]) &&
          Number.isFinite(p.coordinates[1])
      )
      .map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: p.coordinates },
        properties: {
          name: p.name || "",
          category: p.category || "",
        },
      })),
  };
}

// Minimal HTML escaping for popup content - POI name/category ultimately
// originate from imported OSM data (see server/models/PointOfInterest.js),
// not user input, but are still external text being inserted via
// Popup.setHTML() - escaped defensively rather than trusted blindly.
function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

// route is the normalized object useRouting/the backend returns
// ({ distanceMeters, durationSeconds, mode, geometry }) or null - never a
// raw Valhalla shape, and never decoded here (the backend already returns a
// ready GeoJSON LineString via routingService.js's legsToGeoJSON).
function routeToGeoJSON(route) {
  if (!route || !route.geometry) return EMPTY_FEATURE_COLLECTION;
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: route.geometry, properties: {} }],
  };
}

function boundsFromLineString(coordinates) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coordinates) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

// Shared by both the circle-dot layer and the price-pill layer so the color
// scheme (selected pink > listing-type color) is defined in exactly one place.
const markerColorExpression = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  SELECTED_COLOR,
  [
    "match",
    ["get", "listingType"],
    "rent",
    RENT_COLOR,
    "buy",
    BUY_COLOR,
    "sold",
    SOLD_COLOR,
    BUY_COLOR,
  ],
];

const MapComponent = ({
  properties = [],
  mapCenter = DEFAULT_CENTER,
  mapZoom = DEFAULT_ZOOM,
  selectedProperty,
  onMarkerClick,
  onMapMove,
  // Only affects the initial fitBounds-to-Bangladesh camera (see
  // isDefaultNationwideView below) - lets a specific consumer (e.g. a small
  // homepage preview) request a tighter/looser fit without changing the
  // default for every other consumer (/map, HomeSearchBar's picker).
  fitPadding = INITIAL_FIT_PADDING,
  // Optional: { distanceMeters, durationSeconds, mode, geometry } from
  // useRouting, or null/undefined for "no route shown" - see the dedicated
  // sync effect below. Entirely independent of the properties source/layers
  // (own source id, own layers, added/removed without touching them).
  route = null,
  // Optional: chatbot recommendation POIs, [{ name, category, coordinates:
  // [lng, lat] }] - see poisToGeoJSON above. Independent source/layer, same
  // pattern as `route`. Existing consumers that never pass this prop behave
  // exactly as before (defaults to an empty array -> empty POI source).
  pois = [],
  // Optional: [[minLng, minLat], [maxLng, maxLat]] - when provided, used
  // ONCE at mount instead of the default Bangladesh-wide fit (see the mount
  // effect below). For chatbot recommendation mode with 2+ result points;
  // MapPage.js handles the single-point case via plain mapCenter/mapZoom
  // instead, to avoid fitBounds on a zero-area box.
  initialFitBounds = null,
}) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const protocolRef = useRef(null);
  const propertiesRef = useRef(properties);
  const routeRef = useRef(route);
  const selectedIdRef = useRef(null);
  const styleLoadedRef = useRef(false);

  propertiesRef.current = properties;
  routeRef.current = route;
  // No poisRef needed: unlike property markers (whose GeoJSON strips most
  // fields, see propertiesToGeoJSON), the POI popup only needs name/category
  // - both already embedded directly in poisToGeoJSON's feature.properties,
  // so the click handler below reads them straight off the clicked feature.

  // ── Initialize map once ────────────────────────────────────────────────
  useEffect(() => {
    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    protocolRef.current = protocol;

    const initialCenter = isValidCenter(mapCenter) ? mapCenter : DEFAULT_CENTER;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createBangladeshStyle(getPmtilesUrl(), "en"),
      center: toLngLat(initialCenter),
      zoom: mapZoom,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      // maxBounds is intentionally NOT set here - see below. Setting it to
      // BANGLADESH_BOUNDS up front made the initial fitBounds() call
      // impossible to satisfy: MapLibre's internal constrain logic always
      // forces zoom back UP until the maxBounds box "covers" the viewport,
      // which is provably >= the "contain" zoom fitBounds computes whenever
      // the viewport's aspect ratio doesn't exactly match Bangladesh's own
      // (tall) aspect ratio - which it essentially never does. That's the
      // root cause of the whole-country view being cut off (confirmed by
      // reading maplibre-gl's defaultConstrain implementation directly).
    });
    mapRef.current = map;

    // Registered before fitBounds() below so its moveend/zoomend is always
    // caught regardless of whether MapLibre dispatches it synchronously or
    // on the next tick.
    const handleMove = () => {
      if (onMapMove) {
        onMapMove(map.getCenter(), map.getZoom());
      }
    };
    map.on("moveend", handleMove);
    map.on("zoomend", handleMove);

    if (initialFitBounds) {
      // Chatbot recommendation mode with 2+ result points (MapPage.js only
      // passes this when there's a genuine multi-point box to fit - the
      // single-point case uses plain mapCenter/mapZoom below instead, same
      // branch as any other specific-location request). Same fit-then-derive-
      // maxBounds shape as the nationwide case below, just fitted to the
      // recommendation results' own box instead of all of Bangladesh.
      map.fitBounds(initialFitBounds, { padding: fitPadding, animate: false });
      const fittedView = map.getBounds();
      map.setMaxBounds([
        [fittedView.getWest() - PAN_MARGIN_DEGREES, fittedView.getSouth() - PAN_MARGIN_DEGREES],
        [fittedView.getEast() + PAN_MARGIN_DEGREES, fittedView.getNorth() + PAN_MARGIN_DEGREES],
      ]);
    } else if (isDefaultNationwideView(mapCenter, mapZoom)) {
      // No specific location was requested - fit the whole country into
      // whatever the container's actual size is, instead of trusting a
      // fixed zoom number to work for every screen. fitBounds is purely
      // geometric (container size + projection math), so it doesn't need to
      // wait for "load"/style/tiles to be ready. Called synchronously right
      // after construction, before anything paints, so there's no visible
      // jump from the constructor's center/zoom. No maxBounds is active yet
      // at this point (see above), so nothing fights this result.
      map.fitBounds(BANGLADESH_BOUNDS, { padding: fitPadding, animate: false });

      // Now apply panning protection, sized from the view fitBounds just
      // produced (plus a margin) rather than the tight country box - this
      // guarantees, for any viewport aspect ratio, that the box already
      // covers what's on screen, so setMaxBounds()'s own immediate re-check
      // never needs to bump the zoom back up and undo the fit.
      const fittedView = map.getBounds();
      map.setMaxBounds([
        [fittedView.getWest() - PAN_MARGIN_DEGREES, fittedView.getSouth() - PAN_MARGIN_DEGREES],
        [fittedView.getEast() + PAN_MARGIN_DEGREES, fittedView.getNorth() + PAN_MARGIN_DEGREES],
      ]);
    } else {
      // A specific location was requested (property/search/Locate Me before
      // mount, or a single-point chatbot recommendation) - the tight country
      // box is the right constraint from the start, no fitBounds involved
      // here to conflict with it.
      map.setMaxBounds(BANGLADESH_BOUNDS);
    }

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      // Route source/layers added BEFORE the properties source/layers below
      // so property markers and price labels always render on top of the
      // route line - the route stays visible against the (warm-toned) roads
      // underneath it without ever covering a marker and making it
      // unclickable.
      map.addSource("route", {
        type: "geojson",
        data: routeToGeoJSON(routeRef.current),
      });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ROUTE_CASING_COLOR,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 8],
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ROUTE_LINE_COLOR,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 16, 5.5],
        },
      });

      map.addSource("properties", {
        type: "geojson",
        data: propertiesToGeoJSON(propertiesRef.current),
        promoteId: "_id",
      });

      // Individual property dot. Hidden entirely below MARKER_MIN_ZOOM so
      // nationwide/regional views stay a clean basemap-only view; grows
      // slightly with zoom past that so it reads as more prominent once the
      // user is browsing a specific area closely. No clustering: our
      // realistic property volume (hundreds to low thousands) renders fine
      // as a single GPU circle layer, and the product requirement is for
      // clustering to never be visible anyway - so the aggregation machinery
      // would only add complexity for zero benefit.
      map.addLayer({
        id: "property-markers",
        type: "circle",
        source: "properties",
        minzoom: MARKER_MIN_ZOOM,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            MARKER_MIN_ZOOM,
            ["case", ["boolean", ["feature-state", "selected"], false], 9, 5],
            16,
            ["case", ["boolean", ["feature-state", "selected"], false], 13, 8],
          ],
          "circle-color": markerColorExpression,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Price pill, floating above the dot. Only from PRICE_LABEL_MIN_ZOOM so
      // close-in property browsing gets price context without cluttering the
      // zoom levels where dots first appear.
      map.addLayer({
        id: "property-price-label",
        type: "symbol",
        source: "properties",
        minzoom: PRICE_LABEL_MIN_ZOOM,
        layout: {
          "text-field": ["get", "priceLabel"],
          "text-font": [FONT_BOLD],
          "text-size": 11,
          "text-anchor": "bottom",
          "text-offset": [0, -1.3],
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-width": 3,
          "text-halo-color": markerColorExpression,
        },
      });

      styleLoadedRef.current = true;

      ["property-markers", "property-price-label"].forEach((layerId) => {
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      });

      const handleMarkerSelect = (e) => {
        const clickedId = e.features?.[0]?.properties?._id;
        if (!clickedId || !onMarkerClick) return;
        const fullProperty = propertiesRef.current.find((p) => p._id === clickedId);
        if (fullProperty) onMarkerClick(fullProperty);
      };
      map.on("click", "property-markers", handleMarkerSelect);
      map.on("click", "property-price-label", handleMarkerSelect);

      // ── Chatbot recommendation POIs - independent source/layer, added
      // after the property layers above so it never affects property
      // clustering/rendering; empty by default (pois=[] for every existing
      // consumer that doesn't pass the prop). Visually distinguished from
      // property markers by an inverted fill/stroke (white fill, colored
      // ring, vs. property markers' colored fill/white ring) rather than a
      // new icon/package.
      map.addSource("pois", {
        type: "geojson",
        data: poisToGeoJSON(pois),
      });
      map.addLayer({
        id: "poi-markers",
        type: "circle",
        source: "pois",
        minzoom: MARKER_MIN_ZOOM,
        paint: {
          "circle-radius": 6,
          "circle-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-stroke-color": POI_MARKER_COLOR,
        },
      });

      map.on("mouseenter", "poi-markers", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "poi-markers", () => {
        map.getCanvas().style.cursor = "";
      });

      // Own popup, own layer, own handler - never touches onMarkerClick or
      // selectedProperty, so it can't interfere with property marker click
      // handling (property markers stay exactly as clickable as before).
      // Deliberately no distance/travel-time shown here: those numbers are
      // only meaningful relative to a specific property, and this generic
      // popup has no such context (see MapPage.js's dedup, which merges the
      // same POI across multiple properties into one marker).
      map.on("click", "poi-markers", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const coords = feature.geometry.coordinates.slice();
        const name = feature.properties.name || "Point of interest";
        const category = String(feature.properties.category || "").replace(/_/g, " ");
        new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "220px" })
          .setLngLat(coords)
          .setHTML(
            `<strong>${escapeHtml(name)}</strong>` +
              (category ? `<br/><span style="text-transform:capitalize">${escapeHtml(category)}</span>` : "")
          )
          .addTo(map);
      });
    });

    return () => {
      map.remove();
      maplibregl.removeProtocol("pmtiles");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync properties → GeoJSON source when the properties prop changes ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const source = map.getSource("properties");
    if (source) {
      source.setData(propertiesToGeoJSON(properties));
    }
  }, [properties]);

  // ── Sync pois → GeoJSON source when the pois prop changes ──────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const source = map.getSource("pois");
    if (source) {
      source.setData(poisToGeoJSON(pois));
    }
  }, [pois]);

  // ── Sync route → GeoJSON source, fit camera to it when it's new ────────
  // Only fires fitBounds when a route actually arrives (new geometry) - not
  // on every render, and never when route is cleared (route=null just wipes
  // the source data, camera is left exactly where the user has it, per the
  // "don't force back to nationwide view" requirement). fitBounds's own
  // moveend/zoomend firing is handled by the existing mapCenter/mapZoom sync
  // effect's own unchanged-position guard below - no new feedback-loop
  // mechanism needed here.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const source = map.getSource("route");
    if (!source) return;

    source.setData(routeToGeoJSON(route));

    const coordinates = route?.geometry?.coordinates;
    if (coordinates && coordinates.length > 0) {
      map.fitBounds(boundsFromLineString(coordinates), {
        padding: ROUTE_FIT_PADDING,
        maxZoom: ROUTE_FIT_MAX_ZOOM,
      });
    }
  }, [route]);

  // ── Sync selected marker styling via feature-state ─────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    const newSelectedId = selectedProperty?._id || null;
    const prevSelectedId = selectedIdRef.current;

    if (prevSelectedId && prevSelectedId !== newSelectedId) {
      map.setFeatureState({ source: "properties", id: prevSelectedId }, { selected: false });
    }
    if (newSelectedId) {
      map.setFeatureState({ source: "properties", id: newSelectedId }, { selected: true });
    }
    selectedIdRef.current = newSelectedId;
  }, [selectedProperty, properties]);

  // ── Sync mapCenter/mapZoom props → camera (external, e.g. select/locate) ─
  // Guarded against redundant jumpTo() calls: jumpTo() always fires
  // moveend/zoomend even when the target matches the current position,
  // which would otherwise echo back through onMapMove -> parent state ->
  // this same effect, in an unbroken feedback loop. Skipping the call when
  // the map is already effectively at the target position breaks that loop
  // without affecting genuine external recentering (select/locate/etc.).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // The literal default center/zoom is a "no specific location requested"
    // placeholder, already handled once by the mount effect's fitBounds (or
    // literal center/zoom) above - never a real navigation target on its
    // own. Ignoring it here also stops callers like HomeMapPreview /
    // HomeSearchBar (which pass a fresh array literal on every render) from
    // yanking the camera back to it on every incidental re-render, and lets
    // a user's manual pan/zoom inside those embedded maps stand.
    if (isDefaultNationwideView(mapCenter, mapZoom)) return;

    const center = isValidCenter(mapCenter) ? mapCenter : DEFAULT_CENTER;
    const targetLngLat = toLngLat(center);

    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();

    const centerUnchanged =
      Math.abs(currentCenter.lng - targetLngLat[0]) < CENTER_EPSILON_DEGREES &&
      Math.abs(currentCenter.lat - targetLngLat[1]) < CENTER_EPSILON_DEGREES;
    const zoomUnchanged = Math.abs(currentZoom - mapZoom) < ZOOM_EPSILON;

    if (centerUnchanged && zoomUnchanged) return;

    map.jumpTo({ center: targetLngLat, zoom: mapZoom });
  }, [mapCenter, mapZoom]);

  return (
    <Box
      sx={{
        position: "relative",
        height: "100%",
        width: "100%",
        borderRadius: "inherit",
        overflow: "hidden",
      }}
    >
      <Box ref={containerRef} sx={{ height: "100%", width: "100%" }} />
    </Box>
  );
};

export const MapLoadingState = () => {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        backgroundColor: "rgba(0,0,0,0.03)",
        borderRadius: "12px",
      }}
    >
      <CircularProgress size={60} thickness={4} />
      <Typography sx={{ mt: 2 }}>
        {t("loading_map", "Loading map data...")}
      </Typography>
    </Box>
  );
};

export const MapErrorState = ({ message }) => {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        backgroundColor: "rgba(0,0,0,0.03)",
        borderRadius: "12px",
        p: 3,
      }}
    >
      <Alert severity="error" sx={{ maxWidth: "500px" }}>
        {message || t("map_error", "Error loading map data")}
      </Alert>
    </Box>
  );
};

export default MapComponent;
