import React from "react";
import { Grid, TextField, Box } from "@mui/material";
import { useTranslation } from "react-i18next";

const Step_Description = ({ formData, errors, handleChange }) => {
  const { t } = useTranslation();

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
                "Leave this blank to automatically generate a description from your property details."
              )
            }
          />
        </Grid>
      </Grid>
    </Box>
  );
};

export default Step_Description;
