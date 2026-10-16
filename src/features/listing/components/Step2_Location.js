import React from "react";
import { Grid, TextField, Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import AddressAutocomplete from "./AddressAutocomplete";
import LocationMapPreview from "./LocationMapPreview";

const Step2_Location = ({
  formData,
  errors,
  handleChange,
  onAddressTextChange,
  onAddressSelect,
}) => {
  const { t } = useTranslation();

  return (
    <Box>
      {/* <Typography variant="h6" gutterBottom>
        {t("step_location", "Location Details")}
      </Typography> */}
      <Grid container spacing={3}>
        {/* Address Line 1 (House/Road/Village/Area) - Google Maps-style
            autocomplete, backed by the existing /api/locations/search
            (Photon) endpoint. Typing without ever picking a suggestion is
            always accepted (freeSolo) - see AddressAutocomplete.js. */}
        <Grid item xs={12}>
          <AddressAutocomplete
            required
            label={t(
              "address_line_1",
              "Address Line 1 (House/Road/Village/Area)"
            )}
            value={formData.addressLine1}
            onTextChange={onAddressTextChange}
            onSelect={onAddressSelect}
            error={!!errors.addressLine1}
            helperText={errors.addressLine1}
          />
        </Grid>

        {/* Address Line 2 (Optional) */}
        <Grid item xs={12}>
          <TextField
            id="addressLine2"
            name="addressLine2"
            label={t("address_line_2", "Address Line 2 (Optional)")}
            fullWidth
            variant="outlined"
            value={formData.addressLine2}
            onChange={handleChange}
            error={!!errors.addressLine2}
            helperText={
              errors.addressLine2 ||
              t(
                "address_l2_helper",
                "e.g., Near XYZ School OR Post Office: ABC"
              )
            }
          />
        </Grid>

        {/* City / Town */}
        <Grid item xs={12} sm={6}>
          <TextField
            required
            id="cityTown"
            name="cityTown"
            label={t("city_town", "City / Town")}
            fullWidth
            variant="outlined"
            value={formData.cityTown}
            onChange={handleChange}
            error={!!errors.cityTown}
            helperText={errors.cityTown}
          />
        </Grid>

        {/* Upazila / Thana - auto-filled only when the address-autocomplete
            provider (Photon) returned a trustworthy, distinct value for it
            (see locationService.js's normalizePhotonFeature); otherwise left
            blank for manual entry, never guessed. */}
        <Grid item xs={12} sm={6}>
          <TextField
            required
            id="upazila"
            name="upazila"
            label={t("upazila_thana", "Upazila / Thana")}
            fullWidth
            variant="outlined"
            value={formData.upazila}
            onChange={handleChange}
            error={!!errors.upazila}
            helperText={
              errors.upazila ||
              (!formData.upazila
                ? t(
                    "upazila_not_confirmed",
                    "Upazila/Thana could not be confirmed automatically. Please enter it manually."
                  )
                : "")
            }
          />
          {/* Consider Select dropdown if you have a list of upazilas per district */}
        </Grid>

        {/* District */}
        <Grid item xs={12} sm={6}>
          <TextField
            required
            id="district"
            name="district"
            label={t("district", "District")}
            fullWidth
            variant="outlined"
            value={formData.district}
            onChange={handleChange}
            error={!!errors.district}
            helperText={errors.district}
          />
          {/* Consider Select dropdown if you have a list of districts */}
        </Grid>

        {/* Postal Code */}
        <Grid item xs={12} sm={6}>
          <TextField
            required
            id="postalCode"
            name="postalCode"
            label={t("postal_code", "Postal Code")}
            fullWidth
            variant="outlined"
            value={formData.postalCode}
            onChange={handleChange}
            error={!!errors.postalCode}
            helperText={errors.postalCode}
            inputProps={{ maxLength: 4 }} // BD postal codes are usually 4 digits
          />
        </Grid>

        {/* Map confirmation preview - only ever shown once the seller has
            picked a real autocomplete suggestion (formData.latitude/
            longitude are only ever set by handleAddressSelect in
            useListingForm.js). A purely manually-typed address never shows
            a marker here - there are no verified coordinates yet to show,
            and showing one would misleadingly imply the location was
            confirmed when it wasn't. */}
        <Grid item xs={12}>
          {formData.latitude != null && formData.longitude != null ? (
            <LocationMapPreview
              lat={formData.latitude}
              lng={formData.longitude}
            />
          ) : (
            <Typography variant="caption" color="text.secondary">
              {t(
                "location_not_confirmed",
                "Pick a suggestion from the address search above to preview the exact location on the map. You can still enter your address manually without one."
              )}
            </Typography>
          )}
        </Grid>
      </Grid>
    </Box>
  );
};

export default Step2_Location;
