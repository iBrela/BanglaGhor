import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Box,
  TextField,
  Button,
  InputAdornment,
  Paper,
  Typography,
  Autocomplete,
  IconButton,
  Tooltip,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import SearchIcon from "@mui/icons-material/Search";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import Fuse from "fuse.js";
import PropertyCardSuggestion from "./PropertyCardSuggestion";
import useLocationSearch from "../../map/hooks/useLocationSearch";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:5001/api";

const MAX_PROPERTY_MATCHES = 5;

const HomeSearchBar = () => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [allProperties, setAllProperties] = useState([]);

  // ── Speech to text state ──────────────────────────────────────────────────
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef(null);
  // ─────────────────────────────────────────────────────────────────────────

  const searchContainerRef = useRef(null);

  // ── Check browser speech support ─────────────────────────────────────────
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0].transcript)
          .join("");
        // Feeds the exact same reactive search pipeline typing does (see
        // searchOptions below) - no separate voice-specific search logic
        // needed anymore.
        setSearchQuery(transcript);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const fetchAllProperties = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/properties?fields=title,location,images,mode,_id`
        );
        setAllProperties(response.data || []);
      } catch (error) {
        console.error("Error fetching all properties for search:", error);
      }
    };
    fetchAllProperties();
  }, []);

  const fuse = useMemo(() => {
    if (!allProperties || allProperties.length === 0) return null;
    return new Fuse(allProperties, {
      keys: ["title", "location"],
      includeScore: true,
      threshold: 0.4,
    });
  }, [allProperties]);

  // Same M2 Phase 1 system already proven on /map: debounce, AbortController,
  // cache, Bangladesh bbox/country filtering and query-script language
  // priority all live in this one shared hook + backend endpoint - nothing
  // location-related is reimplemented here.
  const { results: placeResults, status: placeSearchStatus } =
    useLocationSearch(searchQuery, i18n.language);

  const propertyMatches = useMemo(() => {
    if (!fuse || !searchQuery || searchQuery.trim().length < 2) return [];
    return fuse
      .search(searchQuery.trim())
      .map((r) => r.item)
      .slice(0, MAX_PROPERTY_MATCHES);
  }, [fuse, searchQuery]);

  // Combined, clearly-grouped dropdown: existing property matches (unchanged
  // Fuse behavior) plus place-search results, exactly mirroring the proven
  // /map pattern. A "view all results" option is appended to the Properties
  // group when there are matches, preserving that existing shortcut.
  const searchOptions = useMemo(() => {
    if (!searchQuery || searchQuery.trim().length < 2) return [];
    const propertyOptions = propertyMatches.map((p) => ({
      __type: "property",
      label: p.title,
      property: p,
    }));
    const viewAllOption =
      propertyOptions.length > 0
        ? [{ __type: "view-all", label: t("view_all_results", "View all results") }]
        : [];
    const placeOptions = placeResults.map((place) => ({
      __type: "place",
      label: place.displayName,
      place,
    }));
    return [...propertyOptions, ...viewAllOption, ...placeOptions];
  }, [searchQuery, propertyMatches, placeResults, t]);

  // ── Toggle mic ────────────────────────────────────────────────────────────
  const handleMicToggle = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setSearchQuery("");
      recognitionRef.current.start();
      setIsListening(true);
    }
  };
  // ─────────────────────────────────────────────────────────────────────────

  const handlePropertySelect = useCallback(
    (property) => {
      const mode = property.mode || "rent";
      navigate(`/properties/${mode}`);
      setSearchQuery("");
    },
    [navigate]
  );

  const handleSearch = useCallback(() => {
    const queryParams = new URLSearchParams();
    if (searchQuery) queryParams.set("search", searchQuery);
    navigate(`/properties/rent?${queryParams.toString()}`);
  }, [navigate, searchQuery]);

  // Selecting a Place navigates to /map and hands off just the coordinates +
  // Photon's own "type" via React Router navigation state (the same
  // location.state pattern already used elsewhere in this app, e.g.
  // EditPropertyPage's return-path handoff) - no fake property is created,
  // and no MapLibre camera logic is duplicated here: /map's existing
  // zoomForPlaceType + mapCenter/mapZoom flow (already proven in M2 Phase 1)
  // does all of that on arrival.
  const handleOptionSelect = useCallback(
    (option) => {
      if (!option || typeof option === "string") return;
      if (option.__type === "property") {
        handlePropertySelect(option.property);
      } else if (option.__type === "view-all") {
        handleSearch();
      } else if (option.__type === "place") {
        setSearchQuery("");
        navigate("/map", {
          state: {
            place: { lat: option.place.lat, lng: option.place.lng, type: option.place.type },
          },
        });
      }
    },
    [handlePropertySelect, handleSearch, navigate]
  );

  return (
    <>
      <Paper
        ref={searchContainerRef}
        elevation={3}
        sx={{
          p: { xs: 1.5, sm: 2 },
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          alignItems: "stretch",
          gap: 1.5,
          borderRadius: "12px",
          mt: { xs: 4, md: -4 },
          mb: { xs: 4, md: 6 },
          zIndex: 10,
          position: "relative",
          backgroundColor: "background.paper",
          maxWidth: "950px",
          mx: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Autocomplete
          freeSolo
          filterOptions={(x) => x}
          options={searchOptions}
          loading={placeSearchStatus === "loading"}
          inputValue={searchQuery}
          onInputChange={(event, newValue, reason) => {
            if (reason === "input") setSearchQuery(newValue);
          }}
          onChange={(event, newValue) => handleOptionSelect(newValue)}
          groupBy={(option) =>
            option.__type === "place"
              ? t("search_group_places", "Places")
              : t("search_group_properties", "Properties")
          }
          getOptionLabel={(option) =>
            typeof option === "string" ? option : option.label
          }
          noOptionsText={
            placeSearchStatus === "unavailable"
              ? t(
                  "location_search_unavailable_short",
                  "Location search unavailable - property search still works"
                )
              : t("no_results", "No specific matches found.")
          }
          renderOption={(props, option) => {
            if (option.__type === "view-all") {
              const { key, ...rest } = props;
              return (
                <Box
                  component="li"
                  key={key || "view-all"}
                  {...rest}
                  sx={{ justifyContent: "center", color: "primary.main", fontWeight: 600 }}
                >
                  {option.label}
                </Box>
              );
            }
            if (option.__type === "property") {
              const { key, ...rest } = props;
              return (
                <Box component="li" key={key || option.property._id} {...rest} sx={{ p: "0 !important" }}>
                  <PropertyCardSuggestion property={option.property} onSelect={() => {}} />
                </Box>
              );
            }
            const secondaryContext = [option.place.context.district, option.place.context.division]
              .filter(Boolean)
              .join(", ");
            const { key, ...rest } = props;
            return (
              <Box
                component="li"
                key={key || option.place.id}
                {...rest}
                sx={{ alignItems: "flex-start !important", py: 0.75 }}
              >
                <LocationOnIcon fontSize="small" sx={{ mr: 1, mt: 0.25, color: "text.secondary", flexShrink: 0 }} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {option.place.shortName}
                  </Typography>
                  {secondaryContext && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {secondaryContext}
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          }}
          sx={{
            flex: { xs: "1 1 100%", md: 1 },
          }}
          slotProps={{
            popper: {
              sx: { width: { xs: "100%", md: 420 } },
              placement: "bottom-start",
            },
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              fullWidth
              variant="outlined"
              placeholder={
                isListening ? "🎤 Listening..." : t("search_placeholder")
              }
              onFocus={() => {}}
              InputProps={{
                ...params.InputProps,
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                ),
                // ── Mic button inside the search field ──────────────────────
                endAdornment: (
                  <>
                    {params.InputProps.endAdornment}
                    {speechSupported && (
                      <InputAdornment position="end">
                        <Tooltip title={isListening ? "Stop listening" : "Search by voice"}>
                          <IconButton
                            onClick={handleMicToggle}
                            size="small"
                            sx={{
                              color: isListening ? "#FF5F40" : "#7BAFC0",
                              backgroundColor: isListening
                                ? alpha("#FF5F40", 0.12)
                                : "transparent",
                              animation: isListening ? "pulse 1.2s infinite" : "none",
                              "@keyframes pulse": {
                                "0%": { boxShadow: "0 0 0 0 rgba(255,95,64,0.4)" },
                                "70%": { boxShadow: "0 0 0 8px rgba(255,95,64,0)" },
                                "100%": { boxShadow: "0 0 0 0 rgba(255,95,64,0)" },
                              },
                              "&:hover": {
                                backgroundColor: isListening
                                  ? alpha("#FF5F40", 0.2)
                                  : alpha("#00D4E8", 0.1),
                                color: isListening ? "#FF5F40" : "#00D4E8",
                              },
                            }}
                          >
                            {isListening ? <MicOffIcon /> : <MicIcon />}
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    )}
                  </>
                ),
                // ─────────────────────────────────────────────────────────────
                sx: {
                  borderRadius: "8px",
                  bgcolor: alpha("#EFF9FE", 0.5),
                  // cyan outline when listening
                  ...(isListening && {
                    "& fieldset": { borderColor: "#FF5F40 !important" },
                  }),
                },
              }}
            />
          )}
        />

        <Button
          variant="contained"
          color="primary"
          size="large"
          onClick={handleSearch}
          startIcon={<SearchIcon />}
          sx={{
            py: 1.8,
            px: { xs: 2, md: 4 },
            borderRadius: "8px",
            flexShrink: 0,
            height: "56px",
            boxShadow: "0 4px 12px rgba(43, 123, 140, 0.2)",
            "&:hover": {
              bgcolor: "#246A77",
              boxShadow: "0 6px 16px rgba(43, 123, 140, 0.3)",
            },
          }}
        >
          {t("search_button")}
        </Button>
      </Paper>
    </>
  );
};

export default HomeSearchBar;
