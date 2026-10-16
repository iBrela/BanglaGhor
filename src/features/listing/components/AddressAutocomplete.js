import React, { useState, useEffect } from "react";
import { Autocomplete, TextField, Box, Typography, CircularProgress } from "@mui/material";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import { useTranslation } from "react-i18next";
import useLocationSearch from "../../map/hooks/useLocationSearch";

// ============================================================================
// AddressAutocomplete — Google Maps-style address suggestions for the
// property listing address field, built on the SAME MUI Autocomplete +
// useLocationSearch(debounced, cached, Photon-backed /api/locations/search)
// pattern HomeSearchBar.js already uses for its own place search, just
// scoped to a single address input instead of a combined property+place
// search. No new backend endpoint, no new search infrastructure.
//
// `freeSolo` is the whole point here: typing and submitting manually,
// without ever picking a suggestion, must always keep working exactly as it
// did before this component existed (see useListingForm.js's
// handleAddressTextChange) - the dropdown is a convenience, never a
// requirement.
// ============================================================================
const AddressAutocomplete = ({
  value,
  onTextChange,
  onSelect,
  error,
  helperText,
  label,
  required,
  disabled,
}) => {
  const { t, i18n } = useTranslation();
  // Autocomplete is an uncontrolled-ish widget around its own inputValue -
  // mirrors the parent's `value` prop (formData.addressLine1) so a
  // suggestion-select (which updates formData from the parent) is reflected
  // here too, without fighting Autocomplete's own internal state.
  const [inputValue, setInputValue] = useState(value || "");

  useEffect(() => {
    setInputValue(value || "");
  }, [value]);

  const { results, status } = useLocationSearch(inputValue, i18n.language);

  return (
    <Autocomplete
      freeSolo
      filterOptions={(x) => x} // results already server-filtered; no client re-filtering
      options={results}
      loading={status === "loading"}
      disabled={disabled}
      inputValue={inputValue}
      onInputChange={(event, newValue, reason) => {
        // "reset" fires when Autocomplete resets its own input after a
        // programmatic value change (e.g. right after onSelect below) - the
        // parent has already set the canonical text in that case, so only
        // forward genuine typing to avoid double-applying/clobbering it.
        if (reason !== "input") return;
        setInputValue(newValue);
        onTextChange(newValue);
      }}
      onChange={(event, newValue) => {
        if (newValue && typeof newValue === "object") {
          onSelect(newValue);
        }
      }}
      getOptionLabel={(option) =>
        typeof option === "string" ? option : option.displayName
      }
      isOptionEqualToValue={(option, val) =>
        typeof val === "object" && option.id === val?.id
      }
      noOptionsText={
        status === "unavailable"
          ? t(
              "address_search_unavailable",
              "Address search unavailable right now - you can still type your address manually."
            )
          : t("address_no_suggestions", "No matching addresses found.")
      }
      renderOption={(props, option) => {
        // Primary line: just the place's own name (e.g. "Gulshan"), not the
        // full concatenated displayName (name + city + county + state) -
        // that string often repeats "Dhaka" 2-3 times for Dhaka-area
        // results, which is exactly the "ugly duplicated fragments" this is
        // meant to avoid. displayName itself is unchanged and still what
        // gets written into the address field on selection (see onChange
        // below) - this only changes how the dropdown ROW is presented.
        const primary = option.shortName || option.displayName;

        // House/Road/Street line - only when Photon actually returned one
        // of these for this exact result; never fabricated.
        const houseStreet = [option.houseNumber, option.street]
          .filter(Boolean)
          .join(" ");

        // Area/City/District line, de-duplicated against the primary name
        // and against itself (e.g. don't show "Dhaka, Dhaka").
        const seen = new Set([primary].filter(Boolean).map((s) => s.toLowerCase()));
        const areaBits = [option.city, option.context?.district, option.context?.division]
          .filter(Boolean)
          .filter((part) => {
            const key = part.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

        const secondaryLines = [];
        if (houseStreet) secondaryLines.push(houseStreet);
        if (areaBits.length > 0) secondaryLines.push(areaBits.join(", "));
        if (option.postcode) secondaryLines.push(option.postcode);

        const { key, ...rest } = props;
        return (
          <Box
            component="li"
            key={key || option.id}
            {...rest}
            sx={{ alignItems: "flex-start !important", py: 0.75 }}
          >
            <LocationOnIcon
              fontSize="small"
              sx={{ mr: 1, mt: 0.25, color: "text.secondary", flexShrink: 0 }}
            />
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
                {primary}
              </Typography>
              {secondaryLines.length > 0 && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {secondaryLines.join(" · ")}
                </Typography>
              )}
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          required={required}
          label={label}
          fullWidth
          variant="outlined"
          error={error}
          helperText={
            helperText || t("address_manual_hint", "Can't find your address? You can enter it manually.")
          }
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {status === "loading" ? <CircularProgress color="inherit" size={18} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
};

export default AddressAutocomplete;
