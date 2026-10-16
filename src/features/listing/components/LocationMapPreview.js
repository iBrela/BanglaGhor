import React, { useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { createBangladeshStyle, getPmtilesUrl } from "../../map/mapBasemapStyle";

// ============================================================================
// LocationMapPreview — a small, read-only "confirm this location" marker
// preview for the listing Location step. Deliberately NOT a reuse of the
// main MapComponent.js: that component unconditionally sets up property/POI/
// route sources+layers and marker-image registration for the full map-browse
// page, none of which apply here. This only stands up the same shared
// basemap style (createBangladeshStyle/getPmtilesUrl, identical to
// MapComponent.js) plus a single plain maplibregl.Marker - no POI layer, no
// route layer, no property layer.
//
// Only ever rendered by the parent when BOTH lat and lng are real, finite,
// already-verified numbers (see Step2_Location.js - that's the address-
// autocomplete selection path, see useListingForm.js's handleAddressSelect).
// This component itself never invents a fallback/default center - if it's
// ever mounted without a valid point, it renders nothing rather than showing
// a misleading placeholder location.
// ============================================================================

const PREVIEW_ZOOM = 15;

const LocationMapPreview = ({ lat, lng }) => {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const protocolRef = useRef(null);

  const hasValidPoint = Number.isFinite(lat) && Number.isFinite(lng);

  // Mount once.
  useEffect(() => {
    if (!hasValidPoint || !containerRef.current) return undefined;

    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    protocolRef.current = protocol;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createBangladeshStyle(getPmtilesUrl(), "en"),
      center: [lng, lat],
      zoom: PREVIEW_ZOOM,
      // Non-interactive by design - this is a confirmation preview, not a
      // browsing map. Scroll-zoom is disabled so scrolling the listing form
      // page never gets trapped by the map underneath the cursor.
      scrollZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: false,
    });
    mapRef.current = map;

    markerRef.current = new maplibregl.Marker({ color: "#2B7B8C" })
      .setLngLat([lng, lat])
      .addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      if (protocolRef.current) {
        maplibregl.removeProtocol("pmtiles");
        protocolRef.current = null;
      }
    };
    // Intentionally mount/unmount only on hasValidPoint flipping - lat/lng
    // moves while mounted are handled by the effect below instead of a full
    // remount (cheaper, and avoids a visible map flash on every new
    // suggestion pick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasValidPoint]);

  // Re-center on a new point without remounting the map (e.g. seller picks a
  // second suggestion after the first).
  useEffect(() => {
    if (!hasValidPoint || !mapRef.current || !markerRef.current) return;
    markerRef.current.setLngLat([lng, lat]);
    mapRef.current.jumpTo({ center: [lng, lat], zoom: PREVIEW_ZOOM });
  }, [hasValidPoint, lat, lng]);

  if (!hasValidPoint) return null;

  return (
    <Box>
      <Box
        ref={containerRef}
        role="img"
        aria-label={t(
          "location_preview_map_aria",
          "Map preview of the selected location"
        )}
        sx={{
          height: 220,
          width: "100%",
          borderRadius: "8px",
          overflow: "hidden",
          border: "1px solid rgba(0,0,0,0.12)",
        }}
      />
      <Typography
        variant="caption"
        display="block"
        sx={{ mt: 0.5, color: "text.secondary" }}
      >
        {t(
          "location_preview_caption",
          "This marker shows the location matched to your selected address."
        )}
      </Typography>
    </Box>
  );
};

export default LocationMapPreview;
