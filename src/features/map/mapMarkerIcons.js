// ============================================================================
// MARKER IMAGE GENERATION — rasterizes property pins and POI category icons
// onto <canvas> for MapLibre GL's symbol layers (map.addImage), so property
// locations render as proper pin markers and POIs render as distinct
// category icons instead of plain circle "dots".
//
// No new icon library and no external image assets: property pins reuse the
// exact same "location pin" glyph LocationOnIcon already renders elsewhere
// in this app, and POI glyphs reuse the exact path data poiMarkerConfig.js
// already pulled from @mui/icons-material. This module's only job is
// converting that existing path data into images MapLibre can place on the
// map - a pure rendering step, no new marker design decisions made here.
//
// Rendered at a fixed 2x pixel ratio regardless of the actual screen DPR
// (cheap one-time cost at map init, avoids visibly blurry markers on any
// retina/high-DPI display) and registered with map.addImage(name, imageData,
// {pixelRatio: MARKER_PIXEL_RATIO}) so MapLibre displays them at their
// intended CSS size. Each generator returns an ImageData (via
// ctx.getImageData) rather than the raw <canvas> element - ImageData is the
// one input shape MapLibre GL's addImage() unambiguously supports across
// versions; passing the canvas element directly was found (during real
// browser testing) to throw "mismatched image size" from MapLibre's own
// image manager in this app's bundled version.
// ============================================================================

export const MARKER_PIXEL_RATIO = 2;

// Material Design icon path data (both the LocationOn pin glyph and every
// POI category glyph in poiMarkerConfig.js) is authored on this grid.
const MATERIAL_ICON_VIEWBOX = 24;

// Same "location pin" glyph LocationOnIcon renders elsewhere in this app
// (e.g. MapPage's place-search dropdown) - reused here as the property
// marker silhouette rather than inventing a new pin shape.
const PIN_PATH_D =
  "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7m0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5";

// CSS pixel sizes (pre pixel-ratio scaling). The pin's own viewBox (24x24)
// already contains the full teardrop with its tip near the bottom edge, so a
// square canvas is all it needs - no separate taller canvas required.
// PROPERTY_PIN_SIZE stays clearly larger than POI_MARKER_SIZE (properties
// are the primary map objects, POIs are restrained/secondary - see
// createPoiMarkerImage below); SELECTED_PIN_SIZE is only modestly larger
// than the normal pin (room for the halo ring below, not a "giant" marker).
export const PROPERTY_PIN_SIZE = 34;
export const SELECTED_PIN_SIZE = 44;
export const POI_MARKER_SIZE = 24;

// Centered on the pin head in the pin's own 24x24 local coordinate space
// (the LocationOn glyph's head circle is centered around (12, 9), radius
// ~7) - see createPropertyPinImage's `halo` option.
const HALO_CENTER = { x: 12, y: 9 };
const HALO_RADIUS = 9.5;

function createCanvas(cssSize) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cssSize * MARKER_PIXEL_RATIO);
  canvas.height = Math.round(cssSize * MARKER_PIXEL_RATIO);
  const ctx = canvas.getContext("2d");
  ctx.scale(MARKER_PIXEL_RATIO, MARKER_PIXEL_RATIO);
  return { canvas, ctx };
}

// Property marker: the LocationOn pin silhouette, filled with the given
// listing-type colour, white outline for contrast against the basemap.
// icon-anchor: "bottom" (set on the symbol layer) then places the glyph's
// own tip - not the canvas's geometric center - at the property's real
// coordinate, matching how a real map pin is read.
//
// options.halo: the selected-property treatment. The client explicitly
// requires the pin to KEEP its normal Buy/Rent/Sold colour when selected -
// never a separate "selected" colour (e.g. pink) - so selection is shown by
// adding a soft white ring behind the SAME coloured pin instead of swapping
// its fill colour. Call this with cssSize=SELECTED_PIN_SIZE so the extra
// halo radius has room without clipping.
export function createPropertyPinImage(color, cssSize = PROPERTY_PIN_SIZE, options = {}) {
  const { halo = false } = options;
  const { canvas, ctx } = createCanvas(cssSize);
  const scale = cssSize / MATERIAL_ICON_VIEWBOX;
  const path = new Path2D(PIN_PATH_D);

  ctx.save();
  ctx.scale(scale, scale);

  if (halo) {
    ctx.beginPath();
    ctx.arc(HALO_CENTER.x, HALO_CENTER.y, HALO_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
  }

  ctx.lineWidth = 1.4 / scale;
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.stroke(path);
  ctx.restore();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// POI marker: a filled circle backdrop (category colour) with a white
// outline, plus the category's own glyph drawn in white, centered inside -
// visually smaller and shape-distinct (circle vs. teardrop pin) from
// property markers per the "properties are the primary map objects" rule.
// `pathD` may be a single path string or an array of path strings (a couple
// of Material icons - fire station, college - are drawn as two stacked
// paths); every entry is filled the same way.
export function createPoiMarkerImage(color, pathD, cssSize = POI_MARKER_SIZE) {
  const { canvas, ctx } = createCanvas(cssSize);
  const center = cssSize / 2;
  const radius = cssSize / 2 - 1.5;

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  // Glyph occupies just over half the circle's diameter, leaving a clear
  // colour ring around it so the category colour stays visible even with
  // the white icon drawn on top.
  const glyphBox = cssSize * 0.56;
  const scale = glyphBox / MATERIAL_ICON_VIEWBOX;
  ctx.save();
  ctx.translate(center - glyphBox / 2, center - glyphBox / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  const paths = Array.isArray(pathD) ? pathD : [pathD];
  paths.forEach((d) => ctx.fill(new Path2D(d)));
  ctx.restore();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
