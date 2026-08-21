// ============================================================================
// Shared Bangladesh coverage bounds — re-exported from the canonical module.
// ============================================================================
// The actual numbers live in src/shared/bangladeshGeo.js, which both this
// frontend code AND the backend (server/services/locationService.js) import
// from - see that file for why. This file exists so MapComponent.js and
// useMapData.js (which already import from "../bangladeshBounds") don't need
// to change at all.
// ============================================================================

import {
  BANGLADESH_RAW_BOUNDS,
  BOUNDS_BUFFER_DEGREES,
  BANGLADESH_BOUNDS_BUFFERED,
  isWithinBangladesh,
} from "../../shared/bangladeshGeo";

export {
  BANGLADESH_RAW_BOUNDS,
  BOUNDS_BUFFER_DEGREES,
  BANGLADESH_BOUNDS_BUFFERED,
  isWithinBangladesh,
};
