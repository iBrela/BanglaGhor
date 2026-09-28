import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography, Alert, CircularProgress } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { createBangladeshStyle, getPmtilesUrl } from "../mapBasemapStyle";
import { BANGLADESH_BOUNDS_BUFFERED } from "../bangladeshBounds";
import { PROPERTY_MARKER_CONFIG } from "../config/propertyMarkerConfig";
import { POI_MARKER_CONFIG } from "../config/poiMarkerConfig";
import {
  createPropertyPinImage,
  createPoiMarkerImage,
  MARKER_PIXEL_RATIO,
  SELECTED_PIN_SIZE,
} from "../mapMarkerIcons";
import MapLegend from "./MapLegend";

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

// Listing-type colors now live in propertyMarkerConfig.js (single source of
// truth shared with MapLegend) - these are just local aliases so the rest of
// this file (markerColorExpression, the price-pill halo) doesn't need to
// change shape. No separate "selected" colour: a selected property keeps its
// normal Buy/Rent/Sold colour everywhere (pin AND price-pill halo) - the
// selected STATE is shown via the pin's halo ring (see mapMarkerIcons.js's
// `halo` option), never a colour swap.
const RENT_COLOR = PROPERTY_MARKER_CONFIG.rent.color;
const BUY_COLOR = PROPERTY_MARKER_CONFIG.buy.color;
const SOLD_COLOR = PROPERTY_MARKER_CONFIG.sold.color;
const FONT_BOLD = "Noto Sans Bold"; // same glyph stack the basemap style already loads
// Sensible cap on how tight the camera zooms in when fitting a very compact
// recommendation cluster (e.g. one property with 2 nearby POIs a block
// away) - fitBounds would otherwise zoom in to the map's own MAX_ZOOM, an
// unhelpfully extreme close-up for a tightly-grouped set of markers.
const RECOMMENDATION_FIT_MAX_ZOOM = 16;

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

// Chatbot recommendation POIs only - already real, backend-verified
// { name, category, coordinates: [lng, lat], distanceMeters? } objects (see
// MapPage.js's fetchAmenityPois, which calls the real /api/pois/nearby
// endpoint per requested category and dedupes the results). No fetching, no
// geocoding here; this is purely a display-shape conversion, same role as
// propertiesToGeoJSON above. distanceMeters (when present) is the real,
// backend-computed straight-line distance to the nearest recommended
// property that matched this POI - never fabricated, never a travel time.
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
          distanceMeters: typeof p.distanceMeters === "number" ? p.distanceMeters : null,
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

// Price-pill halo colour, driven purely by listing type - a selected
// property's price pill stays the same colour as its pin (see the file-level
// comment above); there is no separate "selected" branch here.
const markerColorExpression = [
  "match",
  ["get", "listingType"],
  "rent",
  RENT_COLOR,
  "buy",
  BUY_COLOR,
  "sold",
  SOLD_COLOR,
  BUY_COLOR,
];

// Drives the property pin's icon-image from listing type - used by the base
// "property-markers" layer (every property, normal colour/size).
const propertyIconExpression = [
  "match",
  ["get", "listingType"],
  "rent",
  "pin-rent",
  "buy",
  "pin-buy",
  "sold",
  "pin-sold",
  "pin-buy",
];

// Same match, but resolving to the HALO variant of each listing-type's own
// colour (see mapMarkerIcons.js's `halo` option / the addImage registration
// above) - used by "property-markers-selected" below, which is already
// filtered to just the selected feature via map.setFilter, so a plain
// (non-feature-state) data expression is fine here. Deliberately does NOT
// branch on feature-state directly on icon-image - MapLibre GL does not
// support feature-state expressions in LAYOUT properties (confirmed via a
// real "feature-state data expressions are not supported with layout
// properties" error during browser testing), which is why the selected
// treatment is a second, filtered layer instead of a feature-state case here.
const propertySelectedIconExpression = [
  "match",
  ["get", "listingType"],
  "rent",
  "pin-rent-selected",
  "buy",
  "pin-buy-selected",
  "sold",
  "pin-sold-selected",
  "pin-buy-selected",
];

// No feature ever has this literal _id - a selectFilter of
// ["==", ["get", "_id"], NO_SELECTION_ID] matches nothing, which is exactly
// "no property currently selected" for the property-markers-selected layer.
const NO_SELECTION_ID = "__no_property_selected__";

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
  // Optional: [[minLng, minLat], [maxLng, maxLat]] - applied at mount, and
  // again any time it changes afterwards (see the dedicated sync effect
  // below - needed because chatbot recommendation POIs arrive asynchronously
  // after the map has already mounted, so the initial fit may need to widen
  // once they load). For chatbot recommendation mode with 2+ result points;
  // MapPage.js handles the single-point case via plain mapCenter/mapZoom
  // instead, to avoid fitBounds on a zero-area box.
  initialFitBounds = null,
  // Small floating Buy/Rent/Sold (+ active POI categories) key - on by
  // default for full-size map views (/map), turned off for compact embedded
  // previews (e.g. HomeMapPreview) where it would just be clutter.
  showLegend = true,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const protocolRef = useRef(null);
  const propertiesRef = useRef(properties);
  const routeRef = useRef(route);
  const selectedIdRef = useRef(null);
  const styleLoadedRef = useRef(false);
  // Reactive counterpart to styleLoadedRef. The ref alone caused a real race
  // (confirmed via browser testing): the mount effect's async "load" handler
  // sets styleLoadedRef.current = true, but a sync effect below
  // (properties/pois/route/etc) only re-runs when ITS OWN prop dependency
  // changes - if that prop had already changed WHILE styleLoadedRef.current
  // was still false (e.g. chatbot recommendation POIs resolving before the
  // map's "load" event fires), the effect's guard silently no-ops and, since
  // the prop doesn't necessarily change again afterward, that update is lost
  // forever - the GeoJSON source stays stuck on whatever stale/empty data
  // the mount effect's own closure captured. Adding this as an explicit
  // dependency makes every affected effect also re-run at the moment style
  // finishes loading, picking up whatever the LATEST prop value is by then.
  const [styleLoaded, setStyleLoaded] = useState(false);

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

    // One-time style override for the POI popup (see the "poi-markers"
    // click handler below) - MapLibre's own default popup chrome (white
    // box, low-contrast default close button, a small connecting "tip"
    // triangle) doesn't integrate with BanglaGhor's light/dark theme, so the
    // popup's own surface/text colours are set inline from the live MUI
    // theme at click time instead; this override only resets MapLibre's
    // outer wrapper (padding/background/shadow) so that inline-styled inner
    // content shows through cleanly, and hides the tip (a themed triangle
    // isn't worth the added complexity for a small visual detail). Scoped to
    // a dedicated className so it can never affect any other popup, and
    // guarded by id so re-mounting this component (e.g. React StrictMode)
    // never inserts it twice.
    if (typeof document !== "undefined" && !document.getElementById("banglaghor-map-popup-style")) {
      const styleEl = document.createElement("style");
      styleEl.id = "banglaghor-map-popup-style";
      styleEl.textContent =
        ".banglaghor-poi-popup .maplibregl-popup-tip{display:none;}" +
        ".banglaghor-poi-popup .maplibregl-popup-content{padding:0;background:transparent;box-shadow:0 6px 20px rgba(0,0,0,0.3);border-radius:10px;}" +
        ".banglaghor-poi-popup .maplibregl-popup-close-button{font-size:15px;line-height:1;width:20px;height:20px;border-radius:50%;top:6px;right:6px;display:flex;align-items:center;justify-content:center;}";
      document.head.appendChild(styleEl);
    }

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
      map.fitBounds(initialFitBounds, {
        padding: fitPadding,
        animate: false,
        maxZoom: RECOMMENDATION_FIT_MAX_ZOOM,
      });
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

      // Re-apply the constructor's own center/zoom through jumpTo's padding
      // option so a single-point chatbot recommendation is centered within
      // the space actually visible next to the chatbot panel (see
      // MapPage.js's asymmetric fitPadding), not the full canvas - the
      // constructor itself has no padding-aware camera option, and the
      // reactive mapCenter/mapZoom sync effect below would otherwise skip
      // this exact value on the very first render (it already matches what
      // the constructor set, so its own "already there" guard would no-op).
      // A no-op for every non-recommendation caller, where fitPadding is a
      // small symmetric default (equal padding on every side doesn't shift
      // anything).
      if (fitPadding && typeof fitPadding === "object") {
        map.jumpTo({ center: toLngLat(initialCenter), zoom: mapZoom, padding: fitPadding });
      }
    }

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      // Register every marker image ONCE per map instance, before any layer
      // that references them by name - property pins (one per listing type,
      // plus one HALO variant per listing type for the selected state - see
      // createPropertyPinImage's `halo` option) and one icon per POI
      // category (poiMarkerConfig.js's full 16-category set, registered
      // unconditionally regardless of whether recommendation mode is
      // active, since it's a fixed, cheap, one-time cost and pois can
      // arrive/change later without re-triggering this "load" handler).
      //
      // The selected pin is deliberately NOT a separate colour (e.g. pink) -
      // the client requires a selected property to keep its normal Buy/
      // Rent/Sold colour, shown instead via a white halo behind the SAME
      // coloured pin (see mapMarkerIcons.js).
      Object.values(PROPERTY_MARKER_CONFIG).forEach((cfg) => {
        map.addImage(cfg.icon, createPropertyPinImage(cfg.color), {
          pixelRatio: MARKER_PIXEL_RATIO,
        });
        map.addImage(
          `${cfg.icon}-selected`,
          createPropertyPinImage(cfg.color, SELECTED_PIN_SIZE, { halo: true }),
          { pixelRatio: MARKER_PIXEL_RATIO }
        );
      });
      Object.entries(POI_MARKER_CONFIG).forEach(([category, cfg]) => {
        map.addImage(`poi-${category}`, createPoiMarkerImage(cfg.color, cfg.pathD), {
          pixelRatio: MARKER_PIXEL_RATIO,
        });
      });

      // Route source/layers added first so route/markers/pins never fight
      // over what's "under" the route line.
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

      // ── Chatbot recommendation POIs - independent source/layer, added
      // BEFORE the properties source/layers below so property pins ALWAYS
      // paint on top of (and stay clickable over) any POI marker sharing
      // the same screen space. MapLibre GL draws layers in addLayer() order
      // - later layers paint over earlier ones - so this ordering, not
      // React/component order, is what actually decides z-order; a prior
      // version of this file added POIs AFTER the property layers and that
      // was the literal, confirmed cause of property pins being hidden
      // underneath dense POI clusters. Empty by default (pois=[] for every
      // existing consumer that doesn't pass the prop). Each category gets
      // its own icon-image (registered above from poiMarkerConfig.js)
      // rather than one shared colour/shape, and stays visually smaller/
      // secondary to property pins (POI_MARKER_SIZE < PROPERTY_PIN_SIZE,
      // see mapMarkerIcons.js) per the "properties are the primary map
      // objects" rule. icon-allow-overlap/icon-ignore-placement: true so no
      // requested POI is ever silently collision-hidden - the client asked
      // for ALL matching POIs to be shown, not a thinned subset; property
      // pins still win visually because they paint on top, not because POIs
      // are hidden.
      map.addSource("pois", {
        type: "geojson",
        data: poisToGeoJSON(pois),
      });
      map.addLayer({
        id: "poi-markers",
        type: "symbol",
        source: "pois",
        minzoom: MARKER_MIN_ZOOM,
        layout: {
          "icon-image": ["concat", "poi-", ["get", "category"]],
          "icon-size": 1,
          "icon-anchor": "center",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
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
      // distanceMeters (when present) is a real straight-line distance to
      // the NEAREST recommended property that matched this POI - see
      // MapPage.js's fetchAmenityPois/dedup. Worded generically ("from
      // recommended property") rather than naming a specific property,
      // since a POI deduped across multiple recommended properties (View
      // all on map) has no single correct property to attribute it to -
      // never fabricated, never a travel time.
      //
      // Styled inline from the LIVE MUI theme (theme.palette.background.
      // paper/text.primary/text.secondary/divider) rather than fixed hex
      // values or a plain CSS file, so the popup always matches the app's
      // actual current light/dark mode - not just an OS preference - with
      // zero extra branching. Built as an HTML string (setHTML), same as
      // before; the outer transparent/no-padding override (injected once,
      // above) lets this inner, fully-styled box be the only visible
      // surface. The close button is restyled directly on its real DOM node
      // (only available after addTo()) since it isn't part of this HTML.
      map.on("click", "poi-markers", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const coords = feature.geometry.coordinates.slice();
        const name = feature.properties.name || t("poi_popup_unnamed", "Point of interest");
        const category = feature.properties.category || "";
        const categoryConfig = POI_MARKER_CONFIG[category];
        const categoryLabel = categoryConfig
          ? t(categoryConfig.labelKey, categoryConfig.labelFallback)
          : String(category).replace(/_/g, " ");
        const accentColor = categoryConfig ? categoryConfig.color : "#7B1FA2";
        const distanceMeters = feature.properties.distanceMeters;

        let distanceLabel = "";
        if (typeof distanceMeters === "number" && Number.isFinite(distanceMeters)) {
          const distanceText =
            distanceMeters >= 1000
              ? `${(distanceMeters / 1000).toFixed(1)} km`
              : `${Math.round(distanceMeters)} m`;
          distanceLabel = `${distanceText} ${t("poi_distance_from_property", "from recommended property")}`;
        }

        const iconPaths = categoryConfig
          ? Array.isArray(categoryConfig.pathD)
            ? categoryConfig.pathD
            : [categoryConfig.pathD]
          : [];
        const iconSvg = iconPaths.length
          ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="#fff">${iconPaths
              .map((d) => `<path d="${d}"/>`)
              .join("")}</svg>`
          : "";

        const surface = theme.palette.background.paper;
        const primaryText = theme.palette.text.primary;
        const secondaryText = theme.palette.text.secondary;
        const border = theme.palette.divider;

        const popup = new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
          maxWidth: "260px",
          offset: 16,
          className: "banglaghor-poi-popup",
        })
          .setLngLat(coords)
          .setHTML(
            `<div style="background:${surface};color:${primaryText};border:1px solid ${border};border-radius:10px;padding:10px 28px 10px 10px;max-width:260px;box-sizing:border-box;font-family:inherit;">` +
              `<div style="display:flex;align-items:flex-start;gap:8px;">` +
              `<span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:${accentColor};display:flex;align-items:center;justify-content:center;margin-top:1px;">${iconSvg}</span>` +
              `<div style="min-width:0;">` +
              `<div style="font-weight:600;font-size:13.5px;line-height:1.35;overflow-wrap:break-word;color:${primaryText};">${escapeHtml(name)}</div>` +
              `<div style="font-size:11.5px;color:${secondaryText};margin-top:2px;text-transform:capitalize;">${escapeHtml(categoryLabel)}</div>` +
              (distanceLabel
                ? `<div style="font-size:11.5px;color:${secondaryText};margin-top:2px;">${escapeHtml(distanceLabel)}</div>`
                : "") +
              `</div>` +
              `</div>` +
              `</div>`
          )
          .addTo(map);

        const closeBtn = popup.getElement()?.querySelector(".maplibregl-popup-close-button");
        if (closeBtn) {
          closeBtn.style.color = secondaryText;
          closeBtn.style.background = "transparent";
          closeBtn.onmouseenter = () => {
            closeBtn.style.background = border;
          };
          closeBtn.onmouseleave = () => {
            closeBtn.style.background = "transparent";
          };
        }
      });

      map.addSource("properties", {
        type: "geojson",
        data: propertiesToGeoJSON(propertiesRef.current),
        promoteId: "_id",
      });

      // Individual property PIN (not a plain circle/dot - see
      // mapMarkerIcons.js's createPropertyPinImage, the same "location pin"
      // glyph LocationOnIcon renders elsewhere in this app). Added AFTER the
      // poi-markers layer above so it always paints on top - see that
      // layer's comment for why this ordering (not React/component order)
      // is what actually controls z-order in MapLibre. Hidden entirely
      // below MARKER_MIN_ZOOM so nationwide/regional views stay a clean
      // basemap-only view. icon-allow-overlap/icon-ignore-placement: true so
      // every property always renders - a symbol layer's default collision
      // detection would otherwise silently hide some pins at moderate
      // density, which circle layers (the previous implementation) were
      // never subject to; every property must stay visible, not be dropped
      // for label-collision reasons. No clustering: our realistic property
      // volume (hundreds to low thousands) renders fine as a single symbol
      // layer, and the product requirement is for clustering to never be
      // visible anyway - so the aggregation machinery would only add
      // complexity for zero benefit.
      map.addLayer({
        id: "property-markers",
        type: "symbol",
        source: "properties",
        minzoom: MARKER_MIN_ZOOM,
        layout: {
          "icon-image": propertyIconExpression,
          "icon-size": 1,
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });

      // Selected-property highlight - the SAME listing-type colour pin,
      // rendered larger with a white halo ring behind it (see
      // mapMarkerIcons.js's `halo` option / propertySelectedIconExpression)
      // - the client explicitly requires a selected/recommended property to
      // keep its normal Buy/Rent/Sold colour, never a separate "selected"
      // colour. A second layer (filtered to just the selected feature, and
      // added after property-markers so it paints on top of the base pin)
      // rather than a feature-state-driven icon-image on the layer above,
      // because MapLibre GL does not support feature-state expressions in
      // layout properties - see propertyIconExpression's comment. The
      // filter starts matching nothing (NO_SELECTION_ID) and is updated via
      // map.setFilter whenever selectedProperty changes (see the sync
      // effect below).
      map.addLayer({
        id: "property-markers-selected",
        type: "symbol",
        source: "properties",
        minzoom: MARKER_MIN_ZOOM,
        filter: ["==", ["get", "_id"], NO_SELECTION_ID],
        layout: {
          "icon-image": propertySelectedIconExpression,
          "icon-size": 1,
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });

      // Price pill, floating above the pin's head. Only from
      // PRICE_LABEL_MIN_ZOOM so close-in property browsing gets price
      // context without cluttering the zoom levels where pins first appear.
      // Kept as its own symbol layer (rather than combined into the pin
      // layer above) so it can have its own minzoom independent of the pin,
      // and added last so it always stays legible above every marker below.
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
          // Pins are noticeably taller than the old dot marker, so the price
          // pill needs more clearance above the anchor point to sit above
          // the pin's head instead of overlapping it.
          "text-offset": [0, -3.5],
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-width": 3,
          "text-halo-color": markerColorExpression,
        },
      });

      styleLoadedRef.current = true;
      setStyleLoaded(true);

      ["property-markers", "property-markers-selected", "property-price-label"].forEach(
        (layerId) => {
          map.on("mouseenter", layerId, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", layerId, () => {
            map.getCanvas().style.cursor = "";
          });
        }
      );

      const handleMarkerSelect = (e) => {
        const clickedId = e.features?.[0]?.properties?._id;
        if (!clickedId || !onMarkerClick) return;
        const fullProperty = propertiesRef.current.find((p) => p._id === clickedId);
        if (fullProperty) onMarkerClick(fullProperty);
      };
      map.on("click", "property-markers", handleMarkerSelect);
      map.on("click", "property-markers-selected", handleMarkerSelect);
      map.on("click", "property-price-label", handleMarkerSelect);
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
  }, [properties, styleLoaded]);

  // ── Sync pois → GeoJSON source when the pois prop changes ──────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const source = map.getSource("pois");
    if (source) {
      source.setData(poisToGeoJSON(pois));
    }
  }, [pois, styleLoaded]);

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
  }, [route, styleLoaded]);

  // ── Re-fit camera when initialFitBounds changes AFTER mount ────────────
  // The mount effect above only applies initialFitBounds once, synchronously
  // at construction. Chatbot recommendation POIs are fetched asynchronously
  // (see MapPage.js's fetchAmenityPois) and typically resolve well after the
  // map has already mounted and fit to just the recommended properties -
  // without this, the camera would never widen to include POIs that arrive
  // after that first fit. Guarded the same way as the mount effect's own
  // recommendation branch (maxZoom cap so a tight cluster doesn't over-zoom)
  // and only runs once style/tiles are actually ready.
  const prevFitBoundsRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current || !initialFitBounds) return;
    if (prevFitBoundsRef.current === initialFitBounds) return;
    prevFitBoundsRef.current = initialFitBounds;
    map.fitBounds(initialFitBounds, {
      padding: fitPadding,
      animate: true,
      maxZoom: RECOMMENDATION_FIT_MAX_ZOOM,
    });
  }, [initialFitBounds, fitPadding, styleLoaded]);

  // ── Sync selected marker styling ────────────────────────────────────────
  // Two mechanisms, for two different layer types: feature-state (paint
  // property, drives the price label's text-halo-color via
  // markerColorExpression) and a layer filter (property-markers-selected's
  // icon-image can't use feature-state - see propertyIconExpression's
  // comment - so the highlighted pin is a separate layer shown/hidden by
  // filtering on the selected _id instead).
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
    if (map.getLayer("property-markers-selected")) {
      map.setFilter("property-markers-selected", [
        "==",
        ["get", "_id"],
        newSelectedId || NO_SELECTION_ID,
      ]);
    }
    selectedIdRef.current = newSelectedId;
  }, [selectedProperty, properties, styleLoaded]);

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

    // padding here is the same camera option fitBounds uses elsewhere in
    // this file (a number or {top,bottom,left,right}) - for the normal,
    // symmetric default it's a no-op (equal padding on every side doesn't
    // shift anything), but for recommendation mode's asymmetric,
    // chatbot-aware padding (see MapPage.js) it keeps a single-point
    // recommendation ("View on map" on just one property) visually centered
    // within the space actually visible NEXT TO the chatbot panel, not
    // dead-center of the full canvas (part of which sits behind it).
    map.jumpTo({ center: targetLngLat, zoom: mapZoom, padding: fitPadding });
  }, [mapCenter, mapZoom, fitPadding]);

  // Legend only lists POI categories actually present on the map right now
  // (never every possible category) - empty for normal /map browsing, where
  // pois is always []).
  const legendPoiCategories = useMemo(
    () => Array.from(new Set((pois || []).map((p) => p.category).filter(Boolean))),
    [pois]
  );

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
      {showLegend && <MapLegend poiCategories={legendPoiCategories} />}
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
