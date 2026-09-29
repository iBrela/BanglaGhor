import { useState, useEffect, useRef } from "react";
import axios from "axios";

// ============================================================================
// useLocationSearch — debounced, cancellable place-name autocomplete.
// ============================================================================
// Calls GET /api/locations/search (backend, Photon-only autocomplete - see
// server/services/locationService.js). Deliberately generic/reusable: this
// hook has no MapPage-specific logic, so it's ready to be reused by
// HomeSearchBar in a later pass without changes.
// ============================================================================

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:5001/api";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

// status: "idle" (query too short) | "loading" | "ok" | "unavailable"
//
// lang: the app's current i18next language ("en"/"bn"). Photon returns a
// DIFFERENT name/city/county/state for the exact same place depending on
// this - the query text's own script does NOT determine the response
// language (verified with real requests; see locationService.js's
// photonLangFor() for the full finding). Passing it explicitly is what makes
// place labels follow the app's language instead of always coming back in
// whatever Photon's default happens to be.
export default function useLocationSearch(query, lang) {
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("idle");
  const debounceRef = useRef(null);
  const abortControllerRef = useRef(null);
  // Session-lifetime cache of already-seen (query, lang) pairs, so
  // retyping/backspacing to a previously-searched string doesn't re-hit the
  // backend. Deliberately simple (exact-string keyed, no prefix awareness)
  // per "don't build complex prefix caching unless evidence shows it's
  // needed."
  const cacheRef = useRef(new Map());

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = (query || "").trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      setResults([]);
      setStatus("idle");
      return undefined;
    }

    const cacheKey = `${trimmed.toLowerCase()}::${lang || "en"}`;
    const cachedResults = cacheRef.current.get(cacheKey);
    if (cachedResults) {
      setResults(cachedResults);
      setStatus("ok");
      return undefined;
    }

    debounceRef.current = setTimeout(() => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setStatus("loading");
      // i18next-browser-languagedetector can report a regional variant
      // (e.g. "en-US", "bn-BD") straight from navigator.language - the
      // backend's validator only accepts the bare "en"/"bn" the app
      // actually ships, so normalize here rather than relaxing that
      // validator (this hook is the only caller of this endpoint).
      const apiLang = (lang || "").toLowerCase().startsWith("bn") ? "bn" : "en";
      axios
        .get(`${API_BASE_URL}/locations/search`, {
          params: { q: trimmed, lang: apiLang },
          signal: controller.signal,
        })
        .then((response) => {
          const data = response.data || {};
          if (data.status === "unavailable") {
            setResults([]);
            setStatus("unavailable");
            return;
          }
          const results = Array.isArray(data.results) ? data.results : [];
          cacheRef.current.set(cacheKey, results);
          setResults(results);
          setStatus("ok");
        })
        .catch((err) => {
          if (axios.isCancel(err)) return; // superseded by a newer keystroke
          console.error("[useLocationSearch] request failed:", err.message);
          setResults([]);
          setStatus("unavailable");
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, lang]);

  return { results, status };
}
