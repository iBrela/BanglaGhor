import { useState, useCallback, useRef } from "react";
import axios from "axios";
import { isWithinBangladesh } from "../bangladeshBounds";

// ============================================================================
// useRouting — single-route requests against the BanglaGhor routing API
// (GET /api/routing/route, backend-only per Phase B/C - see
// server/services/routingService.js). Never calls Valhalla directly and
// never decodes route geometry itself - the backend already returns a ready
// GeoJSON LineString.
// ============================================================================

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:5001/api";

const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0,
};

// status: "idle" | "locating" | "loading" | "ok" | "no-route" |
//         "unavailable" | "outside-bangladesh" | "geolocation-denied" |
//         "geolocation-unavailable" | "error"
export default function useRouting() {
  const [route, setRoute] = useState(null); // { distanceMeters, durationSeconds, mode, geometry }
  const [status, setStatus] = useState("idle");
  // Guards against a slower, superseded request (e.g. user switches mode
  // twice quickly) overwriting the result of a later one.
  const requestIdRef = useRef(0);

  const clearRoute = useCallback(() => {
    requestIdRef.current += 1;
    setRoute(null);
    setStatus("idle");
  }, []);

  const requestRoute = useCallback((origin, destLat, destLng, mode) => {
    const thisRequestId = ++requestIdRef.current;
    setStatus("loading");
    axios
      .get(`${API_BASE_URL}/routing/route`, {
        params: {
          originLat: origin.lat,
          originLng: origin.lng,
          destLat,
          destLng,
          mode,
          geometry: true,
        },
      })
      .then((response) => {
        if (thisRequestId !== requestIdRef.current) return; // superseded
        setRoute(response.data.route);
        setStatus("ok");
      })
      .catch((err) => {
        if (thisRequestId !== requestIdRef.current) return;
        setRoute(null);
        const httpStatus = err.response?.status;
        // Mirrors the routing controller's own status contract (404/503/400)
        // - see server/controllers/routingController.js. Never surfaces the
        // raw error body to the UI, only a status bucket the caller maps to
        // a translated message.
        if (httpStatus === 404) setStatus("no-route");
        else if (httpStatus === 503) setStatus("unavailable");
        else setStatus("error");
      });
  }, []);

  // One-off current-position lookup, deliberately independent of
  // useMapData's locateUser() - that function also recenters the map camera
  // and clears the selected property, both wrong side effects when the
  // intent is "show me the route to the property I already have open."
  // Reuses the same isWithinBangladesh check and geolocation options as
  // locateUser for consistency, without sharing its state/side effects.
  const getCurrentPosition = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("geolocation-unavailable"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          if (!isWithinBangladesh(lat, lng)) {
            reject(new Error("outside-bangladesh"));
            return;
          }
          resolve({ lat, lng });
        },
        () => reject(new Error("geolocation-denied")),
        GEOLOCATION_OPTIONS
      );
    });
  }, []);

  // Full flow: use an already-known origin if the caller has one (e.g. the
  // map's existing userLocation from a prior "Locate Me"), otherwise prompt
  // a fresh geolocation lookup, then request the route.
  const showRouteToDestination = useCallback(
    async (destLat, destLng, mode, knownOrigin) => {
      let origin = knownOrigin;
      if (!origin) {
        setStatus("locating");
        try {
          origin = await getCurrentPosition();
        } catch (err) {
          setStatus(err.message || "error");
          return;
        }
      }
      requestRoute(origin, destLat, destLng, mode);
    },
    [getCurrentPosition, requestRoute]
  );

  return { route, status, showRouteToDestination, clearRoute };
}
