// ============================================================================
// Bangladesh boundary polygon — parses the Geofabrik .poly file that was used
// to clip the OSM extract our PMTiles archive is built from (same source,
// same shape). Using this exact polygon (rather than a rectangular bounding
// box) means "is this point inside Bangladesh" matches the true extent of
// what our data pipeline could possibly contain, including the coastal
// buffer Geofabrik includes around the mainland.
//
// File format: standard Osmosis .poly polygon filter format
// (https://wiki.openstreetmap.org/wiki/Osmosis/Polygon_Filter_File_Format).
// ============================================================================

const path = require("path");
const fs = require("fs");

const POLY_PATH = path.join(__dirname, "bangladesh-boundary.poly");

function parsePolyFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  let i = 1; // line 0 is the file/section name, skip it
  const rings = [];
  while (i < lines.length) {
    const header = lines[i++];
    if (!header || header.toUpperCase() === "END") break;
    const coords = [];
    while (true) {
      const line = lines[i++];
      if (!line || line.toUpperCase() === "END") break;
      const parts = line.split(/\s+/).filter(Boolean).map(Number);
      coords.push([parts[0], parts[1]]); // [lon, lat]
    }
    rings.push(coords);
  }
  return rings;
}

let cachedRings = null;
function getRings() {
  if (!cachedRings) cachedRings = parsePolyFile(POLY_PATH);
  return cachedRings;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Geofabrik .poly files can have multiple rings (e.g. exclave slivers);
// a point counts as "inside Bangladesh" if it falls in any of them.
function isInsideBangladesh(lon, lat) {
  const rings = getRings();
  for (const ring of rings) {
    if (pointInRing(lon, lat, ring)) return true;
  }
  return false;
}

function getBoundaryBBox() {
  const rings = getRings();
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLon, minLat, maxLon, maxLat };
}

module.exports = { isInsideBangladesh, getBoundaryBBox, getRings };
