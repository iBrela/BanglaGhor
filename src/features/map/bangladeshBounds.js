// ============================================================================
// Shared Bangladesh coverage bounds — single source of truth.
// Used by both MapComponent.js (maxBounds) and useMapData.js (Locate Me
// coverage check), so both stay consistent with the same buffer value.
// ============================================================================

// Confirmed directly from bangladesh.pmtiles's own archive metadata
// (Geofabrik extract, built via Planetiler).
export const BANGLADESH_RAW_BOUNDS = {
  minLon: 87.998,
  minLat: 18.584,
  maxLon: 92.697,
  maxLat: 26.647,
};

// Small buffer (~0.15 degrees, ~15-17km at Bangladesh's latitude) so panning
// near the edge or a GPS reading in a border town doesn't feel like hitting
// a hard wall exactly at the data boundary.
export const BOUNDS_BUFFER_DEGREES = 0.15;

export const BANGLADESH_BOUNDS_BUFFERED = {
  minLon: BANGLADESH_RAW_BOUNDS.minLon - BOUNDS_BUFFER_DEGREES,
  minLat: BANGLADESH_RAW_BOUNDS.minLat - BOUNDS_BUFFER_DEGREES,
  maxLon: BANGLADESH_RAW_BOUNDS.maxLon + BOUNDS_BUFFER_DEGREES,
  maxLat: BANGLADESH_RAW_BOUNDS.maxLat + BOUNDS_BUFFER_DEGREES,
};

export function isWithinBangladesh(lat, lng) {
  return (
    lat >= BANGLADESH_BOUNDS_BUFFERED.minLat &&
    lat <= BANGLADESH_BOUNDS_BUFFERED.maxLat &&
    lng >= BANGLADESH_BOUNDS_BUFFERED.minLon &&
    lng <= BANGLADESH_BOUNDS_BUFFERED.maxLon
  );
}
