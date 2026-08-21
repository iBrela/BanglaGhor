// ============================================================================
// Canonical Bangladesh geographic bounds — single source of truth.
// ============================================================================
// Numbers confirmed directly from bangladesh.pmtiles's own archive metadata
// (Geofabrik extract, built via Planetiler) - see tools/mapCoverageAudit/.
//
// Written as plain CommonJS (module.exports) so BOTH consumers can use it
// with zero build tooling:
//   - Frontend: src/features/map/bangladeshBounds.js imports and re-exports
//     these exact values (via Babel/webpack's standard CJS interop), so
//     MapComponent.js and useMapData.js need no changes at all.
//   - Backend: server/services/locationService.js requires this file via a
//     relative path (server/ and src/ are sibling directories at the repo
//     root - plain Node `require()` has no restriction on reaching outside
//     server/, unlike webpack's src/-only restriction for the frontend).
//
// This file intentionally has NO React/DOM/frontend dependency and NO
// Express/Mongoose/backend dependency - it's pure, dependency-free numeric
// data, which is what makes sharing it safe in both directions without
// creating real architectural coupling between the two apps.
// ============================================================================

const BANGLADESH_RAW_BOUNDS = {
  minLon: 87.998,
  minLat: 18.584,
  maxLon: 92.697,
  maxLat: 26.647,
};

// Small buffer (~0.15 degrees, ~15-17km at Bangladesh's latitude) so panning
// near the edge or a GPS reading in a border town doesn't feel like hitting
// a hard wall exactly at the data boundary.
const BOUNDS_BUFFER_DEGREES = 0.15;

const BANGLADESH_BOUNDS_BUFFERED = {
  minLon: BANGLADESH_RAW_BOUNDS.minLon - BOUNDS_BUFFER_DEGREES,
  minLat: BANGLADESH_RAW_BOUNDS.minLat - BOUNDS_BUFFER_DEGREES,
  maxLon: BANGLADESH_RAW_BOUNDS.maxLon + BOUNDS_BUFFER_DEGREES,
  maxLat: BANGLADESH_RAW_BOUNDS.maxLat + BOUNDS_BUFFER_DEGREES,
};

function isWithinBangladesh(lat, lng) {
  return (
    lat >= BANGLADESH_BOUNDS_BUFFERED.minLat &&
    lat <= BANGLADESH_BOUNDS_BUFFERED.maxLat &&
    lng >= BANGLADESH_BOUNDS_BUFFERED.minLon &&
    lng <= BANGLADESH_BOUNDS_BUFFERED.maxLon
  );
}

module.exports = {
  BANGLADESH_RAW_BOUNDS,
  BOUNDS_BUFFER_DEGREES,
  BANGLADESH_BOUNDS_BUFFERED,
  isWithinBangladesh,
};
