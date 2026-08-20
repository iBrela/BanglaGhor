import React from "react";
import { Box, Typography, Button, Stack } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
 
const AboutCTASection = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
 
  return (
    <Box sx={{ textAlign: "center", py: 6, backgroundColor: "background.default" }}>
      <Box sx={{ maxWidth: "800px", mx: "auto", p: 4, borderRadius: 4, backgroundColor: "background.paper", border: "1px solid", borderColor: "divider" }}>
        <Typography variant="h4" component="h2" fontWeight={600} gutterBottom sx={{ color: "text.primary" }}>
          {t("about_cta.title")}
        </Typography>
        <Typography variant="h6" sx={{ mb: 4, maxWidth: "700px", mx: "auto", color: "text.secondary" }}>
          {t("about_cta.subtitle")}
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} justifyContent="center">
          <Button
            variant="contained"
            size="large"
            color="primary"
            onClick={() => navigate("/properties/rent")}
            sx={{ px: 4, py: 1.5, borderRadius: "8px", fontSize: "1.05rem", textTransform: "none" }}
          >
            {t("explore_properties")}
          </Button>
          <Button
            variant="outlined"
            size="large"
            color="primary"
            onClick={() => navigate("/contact")}
            sx={{ px: 4, py: 1.5, borderRadius: "8px", fontSize: "1.05rem", textTransform: "none" }}
          >
            {t("contact_us")}
          </Button>
        </Stack>
      </Box>
    </Box>
  );
};
 
export default AboutCTASection;