// ============================================================================
// Shared property-coordinate extraction — single source of truth for reading
// a property's location out of the shapes the backend can send it in (see
// server/models/property.js): GeoJSON geoLocation, legacy top-level
// latitude/longitude, and the legacy position{lat,lng} object. Fix #4
// (server/controllers/propertyController.js) keeps all three synchronized on
// every address-changing edit, so for current/future data they always agree
// - this priority order only matters for older/inconsistent records.
//
// Two functions, two different jobs - do not mix them up:
//
//   getPropertyCoordinates(property)
//     REAL, backend-geocoded coordinates only. Returns null when the
//     property has none. Use this anywhere the caller needs to know the
//     property's actual location - routing destinations, accessibility
//     lookups, "does this property have a real position" checks.
//
//   getPropertyDisplayCoordinates(property)
//     Real coordinates when available, otherwise a division centroid so a
//     map/preview still has something to render. NEVER use this result as a
//     routing destination or for accessibility - a district/division
//     centroid is not the property's real location, only a display
//     placeholder. Check the returned `isFallback` flag (or `accuracy`) if a
//     caller needs to distinguish the two cases visually.
// ============================================================================

import { divisionCenters } from "../constants/divisionCenters";

function toFiniteLatLng(lat, lng) {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  return { lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) };
}

export function getPropertyCoordinates(property) {
  if (!property) return null;

  // 1. geoLocation - the canonical GeoJSON representation (coordinates are
  // [longitude, latitude]) and the field real backend logic (M5
  // accessibility, the chatbot's geo-proximity queries) actually reads.
  const geoCoords = property.geoLocation && property.geoLocation.coordinates;
  if (Array.isArray(geoCoords) && geoCoords.length === 2) {
    const [lng, lat] = geoCoords;
    const result = toFiniteLatLng(lat, lng);
    if (result) return result;
  }

  // 2. Legacy top-level latitude/longitude.
  if (
    typeof property.latitude === "number" &&
    typeof property.longitude === "number"
  ) {
    const result = toFiniteLatLng(property.latitude, property.longitude);
    if (result) return result;
  }

  // 3. Legacy position{lat,lng} - documented in the schema as being kept
  // only "for frontend map compatibility", so it's the last resort.
  if (
    property.position &&
    typeof property.position.lat === "number" &&
    typeof property.position.lng === "number"
  ) {
    const result = toFiniteLatLng(property.position.lat, property.position.lng);
    if (result) return result;
  }

  return null;
}

export function getPropertyDisplayCoordinates(property) {
  if (!property) {
    return { position: null, accuracy: "unknown", isFallback: false };
  }

  const real = getPropertyCoordinates(property);
  if (real) {
    return {
      position: real,
      accuracy: property.locationAccuracy || "precise",
      isFallback: false,
    };
  }

  const lowerDistrict = property.district?.toLowerCase() || "";
  const lowerDivision = property.division?.toLowerCase() || "";
  const fallbackKey = Object.keys(divisionCenters).find(
    (key) => lowerDistrict.includes(key) || lowerDivision.includes(key)
  );
  if (fallbackKey) {
    const [lat, lng] = divisionCenters[fallbackKey];
    const result = toFiniteLatLng(lat, lng);
    if (result) {
      return { position: result, accuracy: "district-level", isFallback: true };
    }
  }

  return { position: null, accuracy: "unknown", isFallback: false };
}
