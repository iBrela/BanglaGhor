import React from "react";
import {
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Typography,
  Box,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Checkbox,
  FormGroup,
  Paper,
} from "@mui/material";
import { useTranslation } from "react-i18next";

// ============================================================================
// Step3_PropertyDetails — consolidates what used to be three separate steps'
// worth of fields (Step1's bedrooms/bathrooms, the old standalone Features
// step, and the subset of the old "Specific Details" step that actually has
// a downstream consumer - Property Detail display or chatbot recommendation
// matching, per the Phase 1 field-usage audit) into one meaningful step,
// grouped into four clearly-labeled sections (Property Basics / Features /
// Condition & Utilities / Security & Ownership).
//
// Every building-specific field is gated by the SAME needsBuildingSpecifics
// rule (land AND commercial both excluded) - fixes the Phase 1 finding that
// the old Step_Bangladesh_Details.js used an inconsistent `propertyType !==
// "land"` check (missed excluding commercial) for some of these fields.
// Security features and ownership-papers status are left unconditional on
// purpose: both are meaningful for land too (if anything, ownership-paper
// clarity matters MORE for land sales), so they're shown for every property
// type rather than hidden.
// ============================================================================

const SectionHeading = ({ children }) => (
  <Typography
    variant="subtitle1"
    sx={{ fontWeight: 700, color: "#2C3E50", mb: 0.5 }}
  >
    {children}
  </Typography>
);

const SectionPaper = ({ children }) => (
  <Paper
    variant="outlined"
    sx={{
      p: { xs: 2, sm: 2.5 },
      borderRadius: "10px",
      borderColor: "rgba(0,0,0,0.1)",
    }}
  >
    {children}
  </Paper>
);

const Step3_PropertyDetails = ({
  formData,
  errors,
  features,
  handleChange,
  handleFeatureChange,
}) => {
  const { t } = useTranslation();
  const bdDetails = formData.bangladeshDetails || {};
  const bdErrors = errors.bangladeshDetails || {};

  const needsBuildingSpecifics =
    formData.propertyType !== "land" && formData.propertyType !== "commercial";

  const checkboxFeatureList = [
    { key: "parking", labelKey: "parking" },
    { key: "garden", labelKey: "garden" },
    { key: "airConditioning", labelKey: "air_conditioning" },
    { key: "pool", labelKey: "swimming_pool" },
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {!needsBuildingSpecifics && (
        <Typography color="text.secondary">
          {t(
            "property_details_land_commercial_note",
            "Only the details relevant to land/commercial listings are shown below."
          )}
        </Typography>
      )}

      {needsBuildingSpecifics && (
        <>
          {/* A. Property Basics */}
          <SectionPaper>
            <SectionHeading>
              {t("property_basics", "Property Basics")}
            </SectionHeading>
            <Grid container spacing={2.5} sx={{ mt: 0.5 }}>
              <Grid item xs={12} sm={4}>
                <TextField
                  required
                  id="bedrooms"
                  name="bedrooms"
                  label={t("bedrooms")}
                  type="number"
                  fullWidth
                  variant="outlined"
                  value={formData.bedrooms}
                  onChange={handleChange}
                  error={!!errors.bedrooms}
                  helperText={errors.bedrooms}
                  InputProps={{ inputProps: { min: 0 } }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  required
                  id="bathrooms"
                  name="bathrooms"
                  label={t("bathrooms")}
                  type="number"
                  fullWidth
                  variant="outlined"
                  value={formData.bathrooms}
                  onChange={handleChange}
                  error={!!errors.bathrooms}
                  helperText={errors.bathrooms}
                  InputProps={{ inputProps: { min: 0 } }}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth variant="outlined">
                  <InputLabel id="furnished-label">
                    {t("furnished", "Furnished Status")}
                  </InputLabel>
                  <Select
                    labelId="furnished-label"
                    id="furnished"
                    name="furnished"
                    value={features.furnished || "no"}
                    label={t("furnished", "Furnished Status")}
                    onChange={handleFeatureChange}
                  >
                    <MenuItem value="no">{t("furnished_no", "Not Furnished")}</MenuItem>
                    <MenuItem value="semi">{t("furnished_semi", "Semi Furnished")}</MenuItem>
                    <MenuItem value="full">{t("furnished_full", "Fully Furnished")}</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </SectionPaper>

          {/* B. Features */}
          <SectionPaper>
            <SectionHeading>{t("features", "Features")}</SectionHeading>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              {t("optional", "Optional")}
            </Typography>
            <FormGroup row sx={{ columnGap: 3, rowGap: 0.5, flexWrap: "wrap" }}>
              {checkboxFeatureList.map((feature) => (
                <FormControlLabel
                  key={feature.key}
                  control={
                    <Checkbox
                      checked={features[feature.key] || false}
                      onChange={handleFeatureChange}
                      name={feature.key}
                    />
                  }
                  label={t(feature.labelKey, feature.key)}
                  sx={{ minWidth: { xs: "45%", sm: "auto" } }}
                />
              ))}
            </FormGroup>
            <Grid container spacing={2.5} sx={{ mt: 0.5 }}>
              <Grid item xs={12} sm={6}>
                <FormControl component="fieldset">
                  <FormLabel component="legend">
                    {t("balcony_available", "Balcony?")}
                  </FormLabel>
                  <RadioGroup
                    row
                    name="bangladeshDetails.balcony"
                    value={bdDetails.balcony || "no"}
                    onChange={handleChange}
                  >
                    <FormControlLabel value="yes" control={<Radio size="small" />} label={t("yes", "Yes")} />
                    <FormControlLabel value="no" control={<Radio size="small" />} label={t("no", "No")} />
                  </RadioGroup>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl component="fieldset">
                  <FormLabel component="legend">
                    {t("rooftop_access", "Rooftop Access?")}
                  </FormLabel>
                  <RadioGroup
                    row
                    name="bangladeshDetails.rooftopAccess"
                    value={bdDetails.rooftopAccess || "no"}
                    onChange={handleChange}
                  >
                    <FormControlLabel value="yes" control={<Radio size="small" />} label={t("yes", "Yes")} />
                    <FormControlLabel value="no" control={<Radio size="small" />} label={t("no", "No")} />
                  </RadioGroup>
                </FormControl>
              </Grid>
            </Grid>
          </SectionPaper>

          {/* C. Condition & Utilities */}
          <SectionPaper>
            <SectionHeading>
              {t("condition_utilities", "Condition & Utilities")}
            </SectionHeading>
            <Grid container spacing={2.5} sx={{ mt: 0.5 }}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth required error={!!bdErrors.propertyCondition}>
                  <InputLabel id="propertyCondition-label">
                    {t("property_condition", "Property Condition")}
                  </InputLabel>
                  <Select
                    labelId="propertyCondition-label"
                    name="bangladeshDetails.propertyCondition"
                    value={bdDetails.propertyCondition || ""}
                    label={t("property_condition", "Property Condition")}
                    onChange={handleChange}
                  >
                    <MenuItem value="new">{t("condition_new", "Newly Built")}</MenuItem>
                    <MenuItem value="under_construction">
                      {t("condition_uc", "Under Construction")}
                    </MenuItem>
                    <MenuItem value="resale">{t("condition_resale", "Resale")}</MenuItem>
                  </Select>
                  {bdErrors.propertyCondition && (
                    <FormHelperText>{bdErrors.propertyCondition}</FormHelperText>
                  )}
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth required error={!!bdErrors.waterSource}>
                  <InputLabel id="waterSource-label">
                    {t("water_source", "Water Source")}
                  </InputLabel>
                  <Select
                    labelId="waterSource-label"
                    name="bangladeshDetails.waterSource"
                    value={bdDetails.waterSource || ""}
                    label={t("water_source", "Water Source")}
                    onChange={handleChange}
                  >
                    <MenuItem value="wasa">{t("water_wasa", "WASA")}</MenuItem>
                    <MenuItem value="deep_tube_well">{t("water_dtw", "Deep Tube Well")}</MenuItem>
                    <MenuItem value="both">{t("water_both", "Both")}</MenuItem>
                    <MenuItem value="other">{t("water_other", "Other")}</MenuItem>
                  </Select>
                  {bdErrors.waterSource && (
                    <FormHelperText>{bdErrors.waterSource}</FormHelperText>
                  )}
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth required error={!!bdErrors.gasSource}>
                  <InputLabel id="gasSource-label">{t("gas_source", "Gas Source")}</InputLabel>
                  <Select
                    labelId="gasSource-label"
                    name="bangladeshDetails.gasSource"
                    value={bdDetails.gasSource || ""}
                    label={t("gas_source", "Gas Source")}
                    onChange={handleChange}
                  >
                    <MenuItem value="piped">{t("gas_piped", "Piped (Titas/Other)")}</MenuItem>
                    <MenuItem value="cylinder">{t("gas_cylinder", "Cylinder")}</MenuItem>
                    <MenuItem value="none">{t("gas_none", "None")}</MenuItem>
                  </Select>
                  {bdErrors.gasSource && <FormHelperText>{bdErrors.gasSource}</FormHelperText>}
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel id="backupPower-label">
                    {t("backup_power", "Backup Power")}
                  </InputLabel>
                  <Select
                    labelId="backupPower-label"
                    name="bangladeshDetails.backupPower"
                    value={bdDetails.backupPower || "none"}
                    label={t("backup_power", "Backup Power")}
                    onChange={handleChange}
                  >
                    <MenuItem value="none">{t("power_none", "None")}</MenuItem>
                    <MenuItem value="ips">{t("power_ips", "IPS")}</MenuItem>
                    <MenuItem value="generator">{t("power_generator", "Generator")}</MenuItem>
                    <MenuItem value="solar">{t("power_solar", "Solar")}</MenuItem>
                  </Select>
                  <FormHelperText>{t("optional", "Optional")}</FormHelperText>
                </FormControl>
              </Grid>
            </Grid>
          </SectionPaper>
        </>
      )}

      {/* D. Security & Ownership - shown for every property type, including
          land, since both are meaningful regardless of building status. */}
      <SectionPaper>
        <SectionHeading>
          {t("security_ownership", "Security & Ownership")}
        </SectionHeading>
        <Grid container spacing={2.5} sx={{ mt: 0.5 }}>
          <Grid item xs={12} sm={6}>
            <FormControl component="fieldset" variant="standard">
              <FormLabel component="legend">
                {t("security_features", "Security Features")}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  ({t("optional", "Optional")})
                </Typography>
              </FormLabel>
              <FormGroup row sx={{ columnGap: 2, rowGap: 0.5, flexWrap: "wrap" }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={bdDetails.securityFeatures?.includes("gated") || false}
                      onChange={handleChange}
                      name="bangladeshDetails.securityFeatures"
                      value="gated"
                    />
                  }
                  label={t("security_gated", "Gated Community")}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={bdDetails.securityFeatures?.includes("guards") || false}
                      onChange={handleChange}
                      name="bangladeshDetails.securityFeatures"
                      value="guards"
                    />
                  }
                  label={t("security_guards", "Security Guards")}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={bdDetails.securityFeatures?.includes("cctv") || false}
                      onChange={handleChange}
                      name="bangladeshDetails.securityFeatures"
                      value="cctv"
                    />
                  }
                  label={t("security_cctv", "CCTV")}
                />
              </FormGroup>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl component="fieldset">
              <FormLabel component="legend">
                {t("ownership_papers_clear", "Ownership Papers Clear?")}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  ({t("optional", "Optional")})
                </Typography>
              </FormLabel>
              <RadioGroup
                row
                name="bangladeshDetails.ownershipPapers"
                value={bdDetails.ownershipPapers || "unknown"}
                onChange={handleChange}
                sx={{ columnGap: 1, rowGap: 0.5, flexWrap: "wrap" }}
              >
                <FormControlLabel value="clear" control={<Radio size="small" />} label={t("papers_clear", "Clear")} />
                <FormControlLabel value="pending" control={<Radio size="small" />} label={t("papers_pending", "Pending")} />
                <FormControlLabel value="issue" control={<Radio size="small" />} label={t("papers_issue", "Issue/Dispute")} />
                <FormControlLabel value="unknown" control={<Radio size="small" />} label={t("unknown", "Unknown")} />
              </RadioGroup>
            </FormControl>
          </Grid>
        </Grid>
      </SectionPaper>
    </Box>
  );
};

export default Step3_PropertyDetails;
