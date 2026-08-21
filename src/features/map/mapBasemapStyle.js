// ============================================================================
// PRODUCTION Bangladesh basemap style — MapLibre GL JS
// ============================================================================
// Matches the CONFIRMED OpenMapTiles-schema layers produced by our Planetiler
// build (verified directly from bangladesh.pmtiles's own metadata, not
// assumed):
//
//   aerodrome_label, aeroway, boundary, building, housenumber, landcover,
//   landuse, mountain_peak, park, place, poi, transportation,
//   transportation_name, water, water_name, waterway
//
// This is NOT the Protomaps basemap schema (roads/buildings/pois/places/
// earth) - that mismatch was found and ruled out during the M1 scratch test.
//
// Every name-bearing layer exposes "name", "name:en", "name:bn", and
// "name:latin" fields. nameExpr(lang) below makes the label language a single
// parameter, not hardcoded, so wiring this to the site's i18next language (or
// adding a Bangla toggle) later is a one-line change here, not a rebuild.
// ============================================================================

const GLYPHS_URL = "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf";
const FONT_REGULAR = "Noto Sans Regular";
const FONT_BOLD = "Noto Sans Bold";

// Local dev default matches the M1 scratch-test serving setup
// (npx serve map-build/data --cors -l 8080). Production deployments set
// REACT_APP_PMTILES_URL to point at the real hosted location (S3/CDN) -
// not configured yet, deliberately deferred to a later deployment step.
export function getPmtilesUrl() {
  return (
    process.env.REACT_APP_PMTILES_URL ||
    "http://localhost:8080/bangladesh.pmtiles"
  );
}

function nameExpr(lang) {
  return [
    "coalesce",
    ["get", `name:${lang}`],
    ["get", "name"],
    ["get", "name:latin"],
  ];
}

export function createBangladeshStyle(pmtilesUrl, lang = "en") {
  const name = nameExpr(lang);

  return {
    version: 8,
    name: "BanglaGhor Bangladesh Basemap",
    glyphs: GLYPHS_URL,
    sources: {
      bangladesh: {
        type: "vector",
        url: `pmtiles://${pmtilesUrl}`,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors &copy; <a href="https://openmaptiles.org" target="_blank">OpenMapTiles</a>',
      },
    },
    layers: [
      // ── Background / ground ─────────────────────────────────────────────
      { id: "background", type: "background", paint: { "background-color": "#f7f5f1" } },
      {
        id: "landcover-wood",
        type: "fill",
        source: "bangladesh",
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "wood"],
        paint: { "fill-color": "#d7e7c9", "fill-opacity": 0.65 },
      },
      {
        id: "landuse-general",
        type: "fill",
        source: "bangladesh",
        "source-layer": "landuse",
        filter: ["!", ["in", ["get", "class"], ["literal", ["hospital", "school"]]]],
        minzoom: 6,
        paint: { "fill-color": "#ece8e0", "fill-opacity": 0.55 },
      },
      {
        id: "landuse-hospital",
        type: "fill",
        source: "bangladesh",
        "source-layer": "landuse",
        filter: ["==", ["get", "class"], "hospital"],
        minzoom: 12,
        paint: { "fill-color": "#f9dcdc", "fill-opacity": 0.65 },
      },
      {
        id: "landuse-school",
        type: "fill",
        source: "bangladesh",
        "source-layer": "landuse",
        filter: ["==", ["get", "class"], "school"],
        minzoom: 12,
        paint: { "fill-color": "#dee4f6", "fill-opacity": 0.65 },
      },
      {
        id: "park",
        type: "fill",
        source: "bangladesh",
        "source-layer": "park",
        minzoom: 5,
        paint: { "fill-color": "#c3ddac", "fill-opacity": 0.75 },
      },

      // ── Water ────────────────────────────────────────────────────────────
      {
        id: "water",
        type: "fill",
        source: "bangladesh",
        "source-layer": "water",
        paint: { "fill-color": "#a6cbe3" },
      },
      {
        id: "waterway",
        type: "line",
        source: "bangladesh",
        "source-layer": "waterway",
        minzoom: 6,
        paint: {
          "line-color": "#a6cbe3",
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 14, 2.5],
        },
      },

      // ── Administrative boundaries ────────────────────────────────────────
      {
        id: "boundary-country",
        type: "line",
        source: "bangladesh",
        "source-layer": "boundary",
        filter: ["==", ["get", "admin_level"], 2],
        paint: { "line-color": "#96938d", "line-width": 1.3, "line-dasharray": [3, 2] },
      },
      {
        id: "boundary-state",
        type: "line",
        source: "bangladesh",
        "source-layer": "boundary",
        filter: ["==", ["get", "admin_level"], 4],
        minzoom: 4,
        paint: { "line-color": "#bcb9b2", "line-width": 0.8, "line-dasharray": [2, 2] },
      },

      // ── Buildings: flat fill until z15, light 3D extrusion from z15 ──────
      {
        id: "building-fill",
        type: "fill",
        source: "bangladesh",
        "source-layer": "building",
        minzoom: 13,
        maxzoom: 15,
        paint: {
          "fill-color": "#e2ddd2",
          "fill-outline-color": "#cdc6b6",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.35, 14.9, 0.9],
        },
      },
      {
        id: "building-extrusion",
        type: "fill-extrusion",
        source: "bangladesh",
        "source-layer": "building",
        minzoom: 15,
        paint: {
          "fill-extrusion-color": "#e2ddd2",
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.85,
        },
      },

      // ── Transportation (casing then fill, major → minor) ───────────────
      {
        id: "road-motorway-casing",
        type: "line",
        source: "bangladesh",
        "source-layer": "transportation",
        filter: ["==", ["get", "class"], "motorway"],
        minzoom: 4,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#d4903f",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.5, 10, 4, 15, 12],
        },
      },
      {
        id: "road-motorway",
        type: "line",
        source: "bangladesh",
        "source-layer": "transportation",
        filter: ["==", ["get", "class"], "motorway"],
        minzoom: 4,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#f6a25a",
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 10, 2.5, 15, 9],
        },
      },
      {
        id: "road-trunk-primary",
        type: "line",
        source: "bangladesh",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["trunk", "primary"]]],
        minzoom: 6,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#f8c169",
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.8, 12, 2.5, 15, 8],
        },
      },
      {
        id: "road-secondary-tertiary",
        type: "line",
        source: "bangladesh",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["secondary", "tertiary"]]],
        minzoom: 9,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 14, 2, 16, 6],
        },
      },
      {
        id: "road-minor",
        type: "line",
        source: "bangladesh",
        "source-layer": "transportation",
        filter: ["==", ["get", "class"], "minor"],
        minzoom: 12,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 4],
          "line-opacity": 0.9,
        },
      },
      {
        id: "road-service-track",
        type: "line",
        source: "bangladesh",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["service", "track"]]],
        minzoom: 14,
        paint: { "line-color": "#e6e2d8", "line-width": 1 },
      },
      {
        id: "road-path-pedestrian",
        type: "line",
        source: "bangladesh",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["path"]]],
        minzoom: 14,
        paint: { "line-color": "#c9a97a", "line-width": 1, "line-dasharray": [1, 1.5] },
      },

      // ── Points of interest ──────────────────────────────────────────────
      {
        id: "poi-hospital",
        type: "circle",
        source: "bangladesh",
        "source-layer": "poi",
        filter: ["any", ["==", ["get", "class"], "hospital"], ["==", ["get", "subclass"], "hospital"]],
        minzoom: 13,
        paint: {
          "circle-radius": 5,
          "circle-color": "#e05656",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      },
      {
        id: "poi-education",
        type: "circle",
        source: "bangladesh",
        "source-layer": "poi",
        filter: [
          "any",
          ["==", ["get", "class"], "school"],
          ["==", ["get", "class"], "college"],
          ["in", ["get", "subclass"], ["literal", ["school", "college", "university"]]],
        ],
        minzoom: 13,
        paint: {
          "circle-radius": 5,
          "circle-color": "#4c6ef5",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      },
      // Daily-essentials POIs: mosques/temples/churches (class="place_of_worship",
      // covers all religions - subclass is the religion, e.g. "muslim" at
      // ~85% of the class nationwide, not a "mosque" tag), marketplaces
      // (subclass="marketplace" - the class itself is the generic "grocery"
      // bucket shared with supermarkets/convenience stores, so subclass is
      // the only reliable filter), and pharmacies. Confirmed nationwide by
      // the coverage audit (32k+/8.5k+/9k+ features respectively at z14) but
      // previously invisible until z15 along with every other generic POI.
      // Clinics are already covered by poi-hospital below (they share
      // class="hospital" with subclass="clinic", confirmed by the audit).
      {
        id: "poi-daily-essentials",
        type: "circle",
        source: "bangladesh",
        "source-layer": "poi",
        filter: [
          "any",
          ["==", ["get", "class"], "place_of_worship"],
          ["==", ["get", "subclass"], "marketplace"],
          ["==", ["get", "class"], "pharmacy"],
        ],
        minzoom: 14,
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#3f9d5f",
          "circle-stroke-width": 1.2,
          "circle-stroke-color": "#ffffff",
        },
      },
      {
        id: "poi-general",
        type: "circle",
        source: "bangladesh",
        "source-layer": "poi",
        filter: [
          "!",
          [
            "any",
            ["==", ["get", "class"], "hospital"],
            ["==", ["get", "class"], "school"],
            ["==", ["get", "class"], "college"],
            ["==", ["get", "class"], "place_of_worship"],
            ["==", ["get", "subclass"], "marketplace"],
            ["==", ["get", "class"], "pharmacy"],
          ],
        ],
        minzoom: 15,
        paint: { "circle-radius": 3, "circle-color": "#9a9a9a", "circle-opacity": 0.8 },
      },

      // ── Labels (drawn last; symbol-sort-key uses the schema's own `rank`
      //     field so more important places/POIs win label collisions) ─────
      {
        id: "water-name-label",
        type: "symbol",
        source: "bangladesh",
        "source-layer": "water_name",
        minzoom: 9,
        layout: { "text-field": name, "text-font": [FONT_REGULAR], "text-size": 11, "symbol-placement": "line" },
        paint: { "text-color": "#4f80a8", "text-halo-color": "#f7f5f1", "text-halo-width": 1 },
      },
      {
        id: "road-name-major",
        type: "symbol",
        source: "bangladesh",
        "source-layer": "transportation_name",
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary"]]],
        minzoom: 11,
        layout: { "text-field": name, "text-font": [FONT_REGULAR], "text-size": 11, "symbol-placement": "line" },
        paint: { "text-color": "#6b5233", "text-halo-color": "#ffffff", "text-halo-width": 1.2 },
      },
      {
        id: "road-name-minor",
        type: "symbol",
        source: "bangladesh",
        "source-layer": "transportation_name",
        filter: ["!", ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary"]]]],
        minzoom: 14,
        layout: { "text-field": name, "text-font": [FONT_REGULAR], "text-size": 10, "symbol-placement": "line" },
        paint: { "text-color": "#6b5233", "text-halo-color": "#ffffff", "text-halo-width": 1.2 },
      },
      {
        id: "poi-label",
        type: "symbol",
        source: "bangladesh",
        "source-layer": "poi",
        minzoom: 14,
        layout: {
          "text-field": name,
          "text-font": [FONT_REGULAR],
          "text-size": 10,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "symbol-sort-key": ["get", "rank"],
        },
        paint: { "text-color": "#333333", "text-halo-color": "#ffffff", "text-halo-width": 1.2 },
      },
      {
        id: "place-country",
        type: "symbol",
        source: "bangladesh",
        "source-layer": "place",
        filter: ["==", ["get", "class"], "country"],
        maxzoom: 6,
        layout: {
          "text-field": name,
          "text-font": [FONT_BOLD],
          "text-size": 14,
          "text-transform": "uppercase",
          "text-letter-spacing": 0.1,
        },
        paint: { "text-color": "#3a3a3a", "text-halo-color": "#f7f5f1", "text-halo-width": 1.5 },
      },
      {
        id: "place-city",
        type: "symbol",
        source: "bangladesh",
        "source-layer": "place",
        filter: ["==", ["get", "class"], "city"],
        minzoom: 4,
        layout: {
          "text-field": name,
          "text-font": [FONT_BOLD],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 16],
          "symbol-sort-key": ["get", "rank"],
        },
        paint: { "text-color": "#2b2b2b", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
      },
      {
        id: "place-town",
        type: "symbol",
        source: "bangladesh",
        "source-layer": "place",
        filter: ["==", ["get", "class"], "town"],
        minzoom: 8,
        layout: { "text-field": name, "text-font": [FONT_REGULAR], "text-size": 12, "symbol-sort-key": ["get", "rank"] },
        paint: { "text-color": "#3a3a3a", "text-halo-color": "#ffffff", "text-halo-width": 1.2 },
      },
      {
        id: "place-village-suburb",
        type: "symbol",
        source: "bangladesh",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["village", "suburb"]]],
        minzoom: 11,
        layout: { "text-field": name, "text-font": [FONT_REGULAR], "text-size": 11, "symbol-sort-key": ["get", "rank"] },
        paint: { "text-color": "#4a4a4a", "text-halo-color": "#ffffff", "text-halo-width": 1.1 },
      },
      // Rural hamlets: real, named class="hamlet" places confirmed present
      // nationwide (~1,000+ features) by the coverage audit but previously
      // unrendered by any layer. Smaller/later than village on purpose -
      // hamlets are the smallest inhabited-place tier, one step below a
      // village, so they should only appear once the user is zoomed in
      // close enough that clutter isn't a concern.
      {
        id: "place-hamlet",
        type: "symbol",
        source: "bangladesh",
        "source-layer": "place",
        filter: ["==", ["get", "class"], "hamlet"],
        minzoom: 13,
        layout: { "text-field": name, "text-font": [FONT_REGULAR], "text-size": 10, "symbol-sort-key": ["get", "rank"] },
        paint: { "text-color": "#6b6b6b", "text-halo-color": "#ffffff", "text-halo-width": 1 },
      },
      {
        id: "place-neighbourhood",
        type: "symbol",
        source: "bangladesh",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["neighbourhood", "quarter"]]],
        minzoom: 13,
        layout: { "text-field": name, "text-font": [FONT_REGULAR], "text-size": 10 },
        paint: { "text-color": "#666666", "text-halo-color": "#ffffff", "text-halo-width": 1 },
      },
    ],
  };
}
