// ============================================================================
// Slippy-map tile math (standard Web Mercator tiling scheme used by MapLibre,
// Planetiler, and every other consumer of this PMTiles archive).
// ============================================================================

function lonLatToTile(lon, lat, z) {
  const latRad = (lat * Math.PI) / 180;
  const n = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y, z };
}

function tileX2Lon(x, z) {
  return (x / Math.pow(2, z)) * 360 - 180;
}

function tileY2Lat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function tileCenter(x, y, z) {
  return { lon: tileX2Lon(x + 0.5, z), lat: tileY2Lat(y + 0.5, z) };
}

// Converts a tile-local vector-tile coordinate (0..extent) into real lon/lat.
function tileLocalToLonLat(x, y, z, extent, px, py) {
  return {
    lon: tileX2Lon(x + px / extent, z),
    lat: tileY2Lat(y + py / extent, z),
  };
}

module.exports = { lonLatToTile, tileX2Lon, tileY2Lat, tileCenter, tileLocalToLonLat };
