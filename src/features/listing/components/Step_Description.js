import React from "react";
import {
  Grid,
  TextField,
  Box,
  Button,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Divider,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { useTranslation } from "react-i18next";

// ============================================================================
// Step_Description — the seller's own description field, plus:
//   1. An "Enhance with AI" button (onEnhanceDescription, wired from
//      useListingForm.js) that works whether or not the seller has written
//      anything: non-blank text is merged with confirmed listing data
//      (seller's facts are the source of truth); blank text generates a
//      fresh, grounded description straight from confirmed listing data.
//      Either way the result is written back into this same textarea for
//      the seller to review/edit/regenerate - leaving the step with a blank
//      description also triggers this automatically (see useListingForm.js's
//      handleNext), so the seller always sees generated text before Review
//      rather than it only appearing silently at publish time.
//   2. An optional, clearly-labeled, collapsed-by-default section holding
//      the Phase 1 "generation-only" bangladeshDetails fields - these never
//      display anywhere on the published listing, they only help the AI
//      write a better description, grouped here by what they describe.
// ============================================================================
const Step_Description = ({
  formData,
  errors,
  handleChange,
  onEnhanceDescription,
  enhancingDescription,
}) => {
  const { t } = useTranslation();
  const bdDetails = formData.bangladeshDetails || {};
  const hasDraft = !!(formData.description || "").trim();

  return (
    <Box>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <TextField
            id="description"
            name="description"
            label={t("property_description", "Description")}
            fullWidth
            multiline
            rows={6}
            variant="outlined"
            value={formData.description || ""}
            onChange={handleChange}
            error={!!errors.description}
            helperText={
              errors.description ||
              t(
                "description_helper_auto",
                "Write your own description, or leave this blank to automatically generate one from your property details."
              )
            }
          />
        </Grid>

        <Grid item xs={12}>
          <Button
            variant="outlined"
            startIcon={
              enhancingDescription ? (
                <CircularProgress size={18} />
              ) : (
                <AutoAwesomeIcon />
              )
            }
            onClick={onEnhanceDescription}
            disabled={enhancingDescription}
            sx={{ textTransform: "none", borderRadius: "8px" }}
          >
            {enhancingDescription
              ? t("enhancing_description", "Enhancing...")
              : hasDraft
              ? t("enhance_with_ai", "Enhance with AI")
              : t("generate_with_ai", "Generate with AI")}
          </Button>
          <Typography
            variant="caption"
            display="block"
            sx={{ mt: 0.5, color: "text.secondary" }}
          >
            {hasDraft
              ? t(
                  "enhance_with_ai_helper",
                  "Improves grammar and flow using your own text and the details you've entered. Your facts are preserved - review the result and edit freely before publishing."
                )
              : t(
                  "generate_with_ai_helper",
                  "Creates a description from your confirmed property details below - no text required here first. Review and edit the result freely before publishing."
                )}
          </Typography>
        </Grid>

        <Grid item xs={12}>
          <Accordion sx={{ mt: 1 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography sx={{ fontWeight: 600 }}>
                {t(
                  "description_helper_fields_title",
                  "Help us create a better description"
                )}
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 1 }}
                >
                  ({t("optional", "Optional")})
                </Typography>
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 2.5 }}
              >
                {t(
                  "description_helper_fields_subtitle",
                  "These details are optional. They help us create a more accurate property description - they aren't shown on your listing directly, and aren't independently verified."
                )}
              </Typography>

              {/* Location & Access */}
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, color: "#2C3E50", mb: 1 }}
              >
                {t("location_access", "Location & Access")}
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="bangladeshDetails.proximityToMainRoad"
                    label={t("proximity_main_road", "Proximity to Main Road")}
                    fullWidth
                    variant="outlined"
                    value={bdDetails.proximityToMainRoad || ""}
                    onChange={handleChange}
                    helperText={t(
                      "proximity_helper",
                      "e.g., On main road, 100m, 5 mins walk"
                    )}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="bangladeshDetails.roadWidth"
                    label={t("road_width", "Front Road Width (approx)")}
                    fullWidth
                    variant="outlined"
                    value={bdDetails.roadWidth || ""}
                    onChange={handleChange}
                    helperText={t("road_width_helper", "e.g., 10ft, 20ft, 30ft+")}
                  />
                </Grid>
              </Grid>

              <Divider sx={{ my: 2.5 }} />

              {/* Property Environment */}
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, color: "#2C3E50", mb: 1 }}
              >
                {t("property_environment", "Property Environment")}
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="bangladeshDetails.naturalLight"
                    label={t(
                      "natural_light_ventilation",
                      "Natural Light/Ventilation"
                    )}
                    fullWidth
                    variant="outlined"
                    value={bdDetails.naturalLight || ""}
                    onChange={handleChange}
                    helperText={t(
                      "light_helper",
                      "e.g., Good, Average, Corner Unit"
                    )}
                  />
                </Grid>
              </Grid>

              <Divider sx={{ my: 2.5 }} />

              {/* Nearby Places */}
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, color: "#2C3E50", mb: 1 }}
              >
                {t("nearby_places", "Nearby Places")}
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="bangladeshDetails.nearbySchools"
                    label={t("nearby_schools", "Nearby Schools/Colleges")}
                    fullWidth
                    variant="outlined"
                    value={bdDetails.nearbySchools || ""}
                    onChange={handleChange}
                    multiline
                    minRows={2}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="bangladeshDetails.nearbyHospitals"
                    label={t("nearby_hospitals", "Nearby Hospitals/Clinics")}
                    fullWidth
                    variant="outlined"
                    value={bdDetails.nearbyHospitals || ""}
                    onChange={handleChange}
                    multiline
                    minRows={2}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="bangladeshDetails.nearbyMarkets"
                    label={t("nearby_markets", "Nearby Markets/Shops")}
                    fullWidth
                    variant="outlined"
                    value={bdDetails.nearbyMarkets || ""}
                    onChange={handleChange}
                    multiline
                    minRows={2}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="bangladeshDetails.nearbyReligiousPlaces"
                    label={t("nearby_religious", "Nearby Mosques/Temples etc.")}
                    fullWidth
                    variant="outlined"
                    value={bdDetails.nearbyReligiousPlaces || ""}
                    onChange={handleChange}
                    multiline
                    minRows={2}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="bangladeshDetails.nearbyOthers"
                    label={t("nearby_others", "Other Nearby (Parks, Restaurants)")}
                    fullWidth
                    variant="outlined"
                    value={bdDetails.nearbyOthers || ""}
                    onChange={handleChange}
                    multiline
                    minRows={2}
                  />
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Step_Description;
