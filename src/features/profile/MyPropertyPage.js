import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Box,
  Container,
  Grid,
  Typography,
  Button,
  Chip,
  CircularProgress,
  Alert,
  Stack,
  TextField,
  Autocomplete,
} from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useTheme, alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import axios from "axios";
import Fuse from "fuse.js";
import AddBusinessIcon from "@mui/icons-material/AddBusiness";
import HomeWorkIcon from "@mui/icons-material/HomeWork";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import BookmarkAddOutlinedIcon from "@mui/icons-material/BookmarkAddOutlined";
import SearchIcon from "@mui/icons-material/Search";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import { useAuth } from "../../context/AuthContext";
import useMyListings from "./hooks/useMyListings";
import PropertyCard from "../properties/components/PropertyCard";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:5001/api";

const PREVIEW_COUNT = 4;

const FILTERS = [
  { key: "all", labelKey: "filter_all", fallback: "All" },
  { key: "rent", labelKey: "filter_for_rent", fallback: "For Rent" },
  { key: "buy", labelKey: "filter_for_sale", fallback: "For Sale" },
  { key: "sold", labelKey: "filter_sold", fallback: "Sold" },
];

// Same address-assembly logic PropertyCard.js itself uses, reused here only
// for the tracker's own search-result rows (not a new locality convention).
function buildLocationLabel(property) {
  return (
    [property.addressLine1, property.upazila, property.cityTown, property.district]
      .filter(Boolean)
      .join(", ") || "Location N/A"
  );
}

function formatPrice(property) {
  if (property.price === null || property.price === undefined) return "Price N/A";
  const suffix = property.listingType === "rent" ? "/mo" : "";
  return `৳ ${Number(property.price).toLocaleString()}${suffix}`;
}

// Same image-fallback logic PropertyCard.js itself uses (real http(s) URL
// or a placeholder) - reused here only for the compact selected-property
// preview, not a new image convention.
function resolveImageSrc(property) {
  const placeholderImg = "/pictures/placeholder.png";
  if (Array.isArray(property.images) && property.images.length > 0) {
    const firstImage = property.images[0];
    if (firstImage && (firstImage.startsWith("http://") || firstImage.startsWith("https://"))) {
      return firstImage;
    }
  }
  return placeholderImg;
}

// Compact, theme-consistent empty state - no illustration package, just an
// existing MUI icon + copy + a single real CTA, matching the pattern
// already established elsewhere in this app (e.g. MyListingsPage.js's own
// empty state).
function EmptyState({ icon, title, subtitle, ctaLabel, ctaTo }) {
  return (
    <Box sx={{ textAlign: "left", py: 4 }}>
      {icon}
      <Typography variant="body1" color="text.secondary" sx={{ mt: 1, textAlign: "left" }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" color="text.disabled" sx={{ mb: 2, textAlign: "left" }}>
          {subtitle}
        </Typography>
      )}
      {ctaLabel && ctaTo && (
        <Button
          variant="contained"
          component={RouterLink}
          to={ctaTo}
          sx={{ mt: subtitle ? 0 : 2, borderRadius: "8px", textTransform: "none" }}
        >
          {ctaLabel}
        </Button>
      )}
    </Box>
  );
}

// Reusable "heading (+ description) on the left, action link on the right"
// row - every section on this page uses this exact structure so their left
// edges all share the same Container boundary and their right-side actions
// all align consistently, instead of each section improvising its own
// layout (the alignment inconsistency this rewrite fixes).
function SectionHeader({ title, description, actionLabel, actionTo }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: { xs: "flex-start", sm: "center" },
        justifyContent: "space-between",
        flexDirection: { xs: "column", sm: "row" },
        gap: 1.5,
        mb: 2,
      }}
    >
      <Box sx={{ textAlign: "left" }}>
        <Typography variant="h6" component="h2" fontWeight={700} sx={{ textAlign: "left" }}>
          {title}
        </Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "left" }}>
            {description}
          </Typography>
        )}
      </Box>
      {actionLabel && actionTo && (
        <Button
          component={RouterLink}
          to={actionTo}
          endIcon={<ArrowForwardIcon />}
          sx={{ borderRadius: "8px", textTransform: "none", flexShrink: 0 }}
        >
          {actionLabel}
        </Button>
      )}
    </Box>
  );
}

// My Property overview (Phase 1 + Property Tracker). Section "My Properties"
// reuses the existing useMyListings hook/API verbatim (GET
// /api/user-profiles/me/listings) - filtering by listingType is done
// entirely client-side over data already fetched, no new backend endpoint.
// "Properties I'm Interested In" reuses the exact same wishlist endpoint
// Saved.js itself calls (GET /api/users/:email/wishlist) via a small local
// fetch, so Saved.js stays completely untouched. The new Tracker
// (search/track/untrack) is the only genuinely new backend surface - see
// server/models/TrackedProperty.js / server/controllers/
// trackedPropertyController.js / server/routes/trackedPropertyRoutes.js -
// deliberately separate storage from the wishlist, never merged with it.
const MyPropertyPage = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();
  const { isLoggedIn, user, idToken } = useAuth();

  const { myListings, loading: listingsLoading, error: listingsError } = useMyListings();
  const [activeFilter, setActiveFilter] = useState("all");

  const [savedPreview, setSavedPreview] = useState([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState(null);

  // ── Property Tracker state ──────────────────────────────────────────────
  const [allProperties, setAllProperties] = useState([]);
  const [trackQuery, setTrackQuery] = useState("");
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [tracking, setTracking] = useState(false);
  const [trackFeedback, setTrackFeedback] = useState(null); // {severity, message}

  const [trackedProperties, setTrackedProperties] = useState([]);
  const [trackedLoading, setTrackedLoading] = useState(true);
  const [trackedError, setTrackedError] = useState(null);
  const [untrackingId, setUntrackingId] = useState(null);

  const authHeaders = useRef({});
  authHeaders.current = idToken ? { Authorization: `Bearer ${idToken}` } : {};

  const fetchSavedPreview = useCallback(async () => {
    if (!(isLoggedIn && user?.email && idToken)) {
      setSavedPreview([]);
      setSavedLoading(false);
      return;
    }
    setSavedLoading(true);
    setSavedError(null);
    try {
      // Same endpoint/response shape Saved.js already relies on.
      const response = await axios.get(`${API_BASE_URL}/users/${user.email}/wishlist`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const wishlist = Array.isArray(response.data?.wishlist) ? response.data.wishlist : [];
      setSavedPreview(wishlist);
    } catch (err) {
      console.error("Error fetching saved-properties preview:", err);
      setSavedError(t("saved_preview_load_error", "Could not load your saved properties."));
      setSavedPreview([]);
    } finally {
      setSavedLoading(false);
    }
  }, [isLoggedIn, user, idToken, t]);

  useEffect(() => {
    fetchSavedPreview();
  }, [fetchSavedPreview]);

  // Same fetch-once-then-Fuse-search-client-side pattern HomeSearchBar.js
  // already uses for its own property matching - no new search endpoint,
  // and (matching that same precedent) no debounce needed since Fuse runs
  // entirely client-side with no network request per keystroke.
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    axios
      .get(`${API_BASE_URL}/properties`)
      .then((res) => {
        if (!cancelled) setAllProperties(Array.isArray(res.data) ? res.data : []);
      })
      .catch((err) => console.error("Error fetching properties for tracker search:", err));
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  const fuse = useMemo(() => {
    if (!allProperties.length) return null;
    return new Fuse(allProperties, {
      keys: ["title", "addressLine1", "upazila", "cityTown", "district"],
      includeScore: true,
      threshold: 0.4,
    });
  }, [allProperties]);

  const trackSearchOptions = useMemo(() => {
    if (!fuse || !trackQuery || trackQuery.trim().length < 2) return [];
    return fuse.search(trackQuery.trim()).map((r) => r.item).slice(0, 8);
  }, [fuse, trackQuery]);

  const trackedIds = useMemo(
    () => new Set(trackedProperties.map((p) => p._id)),
    [trackedProperties]
  );

  // Root cause of "success message but Tracked Properties stayed empty":
  // fetchTrackedProperties() was called a second time (after a successful
  // track) while the *first* call (triggered by this page's own mount
  // effect) could still be in flight. Both hit the same endpoint with no
  // ordering guarantee - if the earlier (pre-track, empty-result) request
  // happened to resolve *after* the later (post-track) one, its stale
  // response overwrote the correct state right back to empty. trackedFetchSeq
  // is a standard "only the most recently issued request may update state"
  // guard: every call gets a ticket, and a response is applied only if its
  // ticket is still the latest one issued - any earlier, now-superseded
  // response is silently discarded instead of clobbering newer state.
  const trackedFetchSeq = useRef(0);

  const fetchTrackedProperties = useCallback(async () => {
    if (!(isLoggedIn && idToken)) {
      setTrackedProperties([]);
      setTrackedLoading(false);
      return;
    }
    const seq = ++trackedFetchSeq.current;
    setTrackedLoading(true);
    setTrackedError(null);
    try {
      const response = await axios.get(`${API_BASE_URL}/tracked-properties`, {
        headers: authHeaders.current,
      });
      if (seq !== trackedFetchSeq.current) return; // superseded by a newer request
      setTrackedProperties(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      if (seq !== trackedFetchSeq.current) return;
      console.error("Error fetching tracked properties:", err);
      setTrackedError(t("tracked_load_error", "Could not load your tracked properties."));
      setTrackedProperties([]);
    } finally {
      if (seq === trackedFetchSeq.current) setTrackedLoading(false);
    }
  }, [isLoggedIn, idToken, t]);

  useEffect(() => {
    fetchTrackedProperties();
  }, [fetchTrackedProperties]);

  const alreadyTracked = selectedProperty ? trackedIds.has(selectedProperty._id) : false;

  const handleTrackProperty = async () => {
    if (!selectedProperty || alreadyTracked || tracking) return;
    setTracking(true);
    setTrackFeedback(null);
    const trackedNow = selectedProperty; // capture before it's cleared below
    try {
      await axios.post(
        `${API_BASE_URL}/tracked-properties`,
        { propertyId: trackedNow._id },
        { headers: authHeaders.current }
      );
      // Show it under Tracked Properties immediately - we already have the
      // full property object from the search results, so the user doesn't
      // have to wait on a network round trip to see it appear (requirement:
      // "must appear IMMEDIATELY ... without requiring a page refresh").
      setTrackedProperties((prev) =>
        prev.some((p) => p._id === trackedNow._id) ? prev : [trackedNow, ...prev]
      );
      setTrackFeedback({ severity: "success", message: t("track_success", "Property is now being tracked.") });
      setSelectedProperty(null);
      setTrackQuery("");
      // Reconciles with the server's own populated/authoritative record
      // (e.g. any fields the raw search-list copy didn't have) - awaited so
      // this always resolves after the optimistic update above, and guarded
      // against out-of-order responses by fetchTrackedProperties itself.
      await fetchTrackedProperties();
    } catch (err) {
      console.error("Error tracking property:", err);
      setTrackFeedback({
        severity: "error",
        message: err.response?.data?.error || t("track_error", "Could not track this property."),
      });
    } finally {
      setTracking(false);
    }
  };

  const handleUntrack = async (property) => {
    if (!property?._id) return;
    setUntrackingId(property._id);
    try {
      await axios.delete(`${API_BASE_URL}/tracked-properties/${property._id}`, {
        headers: authHeaders.current,
      });
      setTrackedProperties((prev) => prev.filter((p) => p._id !== property._id));
    } catch (err) {
      console.error("Error untracking property:", err);
      setTrackFeedback({
        severity: "error",
        message: err.response?.data?.error || t("untrack_error", "Could not untrack this property."),
      });
    } finally {
      setUntrackingId(null);
    }
  };

  const filteredListings = useMemo(() => {
    if (activeFilter === "all") return myListings;
    return myListings.filter((p) => p.listingType === activeFilter);
  }, [myListings, activeFilter]);

  if (!isLoggedIn) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="warning">
          {t("please_log_in_account", "Please")}{" "}
          <RouterLink to="/login">{t("login", "Log in")}</RouterLink>{" "}
          {t("please_log_in_property", "to view your property overview.")}
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Box
        sx={{
          display: "flex",
          alignItems: { xs: "flex-start", sm: "center" },
          justifyContent: "space-between",
          flexDirection: { xs: "column", sm: "row" },
          gap: 2,
          mb: 1,
        }}
      >
        <Typography variant="h4" component="h1" fontWeight={700} sx={{ textAlign: "left" }}>
          {t("account_my_property", "My Property")}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddBusinessIcon />}
          onClick={() => navigate("/list-property")}
          sx={{ borderRadius: "8px", textTransform: "none", flexShrink: 0 }}
        >
          {t("account_list_property", "List a Property")}
        </Button>
      </Box>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 5, textAlign: "left" }}>
        {t("my_property_subtitle", "Manage your listings and keep track of properties you're interested in.")}
      </Typography>

      {/* ── Track a Property ──────────────────────────────────────────── */}
      <Box sx={{ mb: 6 }}>
        <Typography variant="h6" component="h2" fontWeight={700} sx={{ textAlign: "left" }}>
          {t("track_a_property", "Track a Property")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: "left" }}>
          {t(
            "track_a_property_desc",
            "Keep track of a property and quickly return to its latest listing details."
          )}
        </Typography>

        <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 1.5 }}>
          <Autocomplete
            fullWidth
            options={trackSearchOptions}
            // Options are already Fuse-filtered above (matching
            // HomeSearchBar.js's own established pattern) - bypass MUI's
            // own secondary substring filter, which would otherwise discard
            // valid Fuse matches (e.g. an address-field match) that don't
            // literally contain the query text in the option's label.
            filterOptions={(x) => x}
            value={selectedProperty}
            inputValue={trackQuery}
            onInputChange={(event, newValue, reason) => {
              if (reason === "input") {
                setTrackQuery(newValue);
                // Typing again after a selection means the visible text no
                // longer necessarily matches the selected property - drop
                // the stale selection so Track Property correctly goes back
                // to disabled until a new option is actually chosen.
                setSelectedProperty((prev) => (prev ? null : prev));
              }
              if (reason === "clear") setSelectedProperty(null);
            }}
            onChange={(event, newValue) => {
              setSelectedProperty(newValue);
              // Sync the input to the selected property's own title rather
              // than leaving the raw text the user typed (e.g. "dhaka")
              // sitting there looking as if nothing was selected - this is
              // Autocomplete's own natural behavior, which manually
              // controlling inputValue separately from value had been
              // overriding.
              setTrackQuery(newValue ? newValue.title || "" : "");
            }}
            getOptionLabel={(option) => (typeof option === "string" ? option : option.title || "")}
            isOptionEqualToValue={(option, value) => option._id === value._id}
            noOptionsText={
              trackQuery.trim().length < 2
                ? t("track_search_hint", "Type at least 2 characters to search.")
                : t("track_no_results", "No matching properties found.")
            }
            renderOption={(props, option) => {
              const { key, ...rest } = props;
              return (
                <Box component="li" key={key || option._id} {...rest}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%", py: 0.25 }}>
                    <LocationOnIcon sx={{ fontSize: "1rem", color: "text.secondary", flexShrink: 0 }} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                        {option.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                        {buildLocationLabel(option)}
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: "right", flexShrink: 0 }}>
                      <Chip
                        label={option.listingType}
                        size="small"
                        sx={{ height: 18, fontSize: "0.65rem", textTransform: "capitalize", mb: 0.25 }}
                      />
                      <Typography variant="caption" sx={{ display: "block", fontWeight: 700, color: "primary.main" }}>
                        {formatPrice(option)}
                      </Typography>
                    </Box>
                  </Box>
                </Box>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={t(
                  "track_search_placeholder",
                  "Search for a property by address, title or location"
                )}
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <>
                      <SearchIcon color="action" sx={{ ml: 0.5, mr: 0.5 }} />
                      {params.InputProps.startAdornment}
                    </>
                  ),
                  sx: { borderRadius: "8px", bgcolor: alpha(theme.palette.primary.main, 0.04) },
                }}
              />
            )}
          />
          <Button
            variant="contained"
            startIcon={<BookmarkAddOutlinedIcon />}
            disabled={!selectedProperty || alreadyTracked || tracking}
            onClick={handleTrackProperty}
            sx={{ borderRadius: "8px", textTransform: "none", flexShrink: 0, minWidth: { md: 180 } }}
          >
            {tracking
              ? t("tracking_in_progress", "Tracking…")
              : alreadyTracked
              ? t("already_tracked", "Already tracked")
              : t("track_property_cta", "Track Property")}
          </Button>
        </Box>

        {/* Selected Property preview - makes it completely obvious which
            real property Track Property will act on, using the actual
            selected object (the same one handleTrackProperty sends). */}
        {selectedProperty && (
          <Box
            sx={{
              mt: 2,
              p: 2,
              display: "flex",
              alignItems: "center",
              gap: 2,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: "10px",
              bgcolor: alpha(theme.palette.primary.main, 0.03),
            }}
          >
            <Box
              component="img"
              src={resolveImageSrc(selectedProperty)}
              alt={selectedProperty.title || ""}
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = "/pictures/placeholder.png";
              }}
              sx={{ width: 64, height: 64, borderRadius: "8px", objectFit: "cover", flexShrink: 0 }}
            />
            <Box sx={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <Typography
                variant="caption"
                sx={{
                  textTransform: "uppercase",
                  fontWeight: 700,
                  fontSize: "0.65rem",
                  letterSpacing: 0.5,
                  color: "text.secondary",
                  textAlign: "left",
                }}
              >
                {t("selected_property", "Selected Property")}
              </Typography>
              <Typography variant="subtitle2" fontWeight={700} noWrap sx={{ textAlign: "left" }}>
                {selectedProperty.title || ""}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", textAlign: "left" }}>
                {buildLocationLabel(selectedProperty)}
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.25 }}>
                <Typography variant="body2" fontWeight={700} color="primary.main">
                  {formatPrice(selectedProperty)}
                </Typography>
                {(selectedProperty.listingType || selectedProperty.propertyType) && (
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: "capitalize" }}>
                    {[selectedProperty.listingType, selectedProperty.propertyType].filter(Boolean).join(" • ")}
                  </Typography>
                )}
              </Box>
            </Box>
            <Button
              size="small"
              onClick={() => {
                setSelectedProperty(null);
                setTrackQuery("");
              }}
              sx={{ textTransform: "none", flexShrink: 0, alignSelf: { xs: "flex-end", sm: "center" } }}
            >
              {t("clear", "Clear")}
            </Button>
          </Box>
        )}

        {trackFeedback && (
          <Alert severity={trackFeedback.severity} sx={{ mt: 2 }} onClose={() => setTrackFeedback(null)}>
            {trackFeedback.message}
          </Alert>
        )}
      </Box>

      {/* ── Tracked Properties ────────────────────────────────────────── */}
      <Box sx={{ mb: 6 }}>
        <SectionHeader
          title={t("tracked_properties_heading", "Tracked Properties")}
          description={t("tracked_properties_desc", "Properties you're actively keeping an eye on.")}
        />

        {trackedLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {!trackedLoading && trackedError && <Alert severity="error">{trackedError}</Alert>}

        {!trackedLoading && !trackedError && trackedProperties.length === 0 && (
          <EmptyState
            icon={<BookmarkAddOutlinedIcon sx={{ fontSize: 40, color: theme.palette.text.disabled }} />}
            title={t("no_tracked_yet", "No tracked properties yet.")}
            subtitle={t("no_tracked_yet_hint", "Search above to start tracking a property.")}
          />
        )}

        {!trackedLoading && !trackedError && trackedProperties.length > 0 && (
          <Grid container spacing={3}>
            {trackedProperties.map((property) => (
              <Grid item xs={12} sm={6} md={3} key={property._id}>
                <PropertyCard
                  property={property}
                  showViewOnMap
                  onUntrack={handleUntrack}
                  untracking={untrackingId === property._id}
                />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      {/* ── My Properties ────────────────────────────────────────────── */}
      <Box sx={{ mb: 6 }}>
        <SectionHeader
          title={t("my_properties_heading", "My Properties")}
          description={t("my_properties_desc", "View and manage properties you have listed on BanglaGhor.")}
          actionLabel={t("view_all_listings", "View all listings")}
          actionTo="/my-listings"
        />

        {myListings.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}>
            {FILTERS.map((f) => (
              <Chip
                key={f.key}
                label={t(f.labelKey, f.fallback)}
                clickable
                onClick={() => setActiveFilter(f.key)}
                color={activeFilter === f.key ? "primary" : "default"}
                variant={activeFilter === f.key ? "filled" : "outlined"}
                sx={{ fontWeight: 600, borderRadius: "8px" }}
              />
            ))}
          </Stack>
        )}

        {listingsLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {!listingsLoading && listingsError && <Alert severity="error">{listingsError}</Alert>}

        {!listingsLoading && !listingsError && myListings.length === 0 && (
          <EmptyState
            icon={<HomeWorkIcon sx={{ fontSize: 40, color: theme.palette.text.disabled }} />}
            title={t("no_listings_yet", "You haven't listed any properties yet.")}
            ctaLabel={t("list_first_property", "List your first property")}
            ctaTo="/list-property"
          />
        )}

        {!listingsLoading && !listingsError && myListings.length > 0 && (
          <Grid container spacing={3}>
            {filteredListings.slice(0, PREVIEW_COUNT).map((property) => (
              <Grid item xs={12} sm={6} md={3} key={property._id}>
                <PropertyCard property={property} />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      {/* ── Properties I'm Interested In ─────────────────────────────── */}
      <Box>
        <SectionHeader
          title={t("interested_in_heading", "Properties I'm Interested In")}
          description={t("interested_in_desc", "Keep track of properties you've saved.")}
          actionLabel={t("view_all_collections", "View all Collections")}
          actionTo="/saved"
        />

        {savedLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {!savedLoading && savedError && <Alert severity="error">{savedError}</Alert>}

        {!savedLoading && !savedError && savedPreview.length === 0 && (
          <EmptyState
            icon={<FavoriteBorderIcon sx={{ fontSize: 40, color: theme.palette.text.disabled }} />}
            title={t("no_saved_yet", "No saved properties yet.")}
            ctaLabel={t("explore_properties", "Explore Properties")}
            ctaTo="/properties/rent"
          />
        )}

        {!savedLoading && !savedError && savedPreview.length > 0 && (
          <Grid container spacing={3}>
            {savedPreview.slice(0, PREVIEW_COUNT).map((property) => (
              <Grid item xs={12} sm={6} md={3} key={property._id}>
                <PropertyCard property={property} />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
    </Container>
  );
};

export default MyPropertyPage;
