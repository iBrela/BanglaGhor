import React from "react";
import { Box, Container, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import HomeSearchBar from "./HomeSearchBar";

const heroImageUrl = `${process.env.PUBLIC_URL}/pictures/dhaka2.jpg`;

// Full-width, image-led marketplace hero (adapted general real-estate-
// marketplace UX conventions - property photography + a dark scrim +
// centered headline/search, not any specific site's proprietary layout or
// branding). Text/CTA sit on top of the photo via an overlay, so they stay
// legible regardless of light/dark theme mode - the overlay is fixed, not
// theme-driven, matching how any photo-background hero works.
//
// HomeSearchBar renders IN-FLOW here (not as a HomePage-level sibling
// pulled up with a negative margin) so the search panel is genuinely part
// of the hero's own centered column - never "hanging below" it.
const HeroSection = () => {
  const { t } = useTranslation();

  return (
    <Box
      sx={{
        position: "relative",
        // md previously jumped to 560 - taller than sm's own 480 for no
        // real reason (hero content - headline/subtitle/search panel -
        // comfortably fits well under 480 even on desktop), which made the
        // hero visually dominate the page and pushed Featured Properties
        // further down than necessary. Capped at 480 across sm and up, in
        // the "wide and premium, not oversized" ~420-480px range.
        minHeight: { xs: 420, sm: 480 },
        py: { xs: 5, md: 6 },
        display: "flex",
        alignItems: "center",
        backgroundImage: `url(${heroImageUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center 60%",
        overflow: "hidden",
      }}
    >
      {/* Dark scrim - deepens toward the bottom so the search panel (which
          sits in the hero's lower-middle) reads clearly against it. */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, ${alpha("#050B0D", 0.45)} 0%, ${alpha("#050B0D", 0.55)} 55%, ${alpha("#050B0D", 0.78)} 100%)`,
        }}
      />

      <Container maxWidth="lg" sx={{ position: "relative", zIndex: 1, textAlign: "center" }}>
        <Typography
          variant="h1"
          sx={{
            fontSize: { xs: "1.9rem", sm: "2.5rem", md: "3rem" },
            fontWeight: 800,
            lineHeight: 1.2,
            mb: 1.5,
            color: "#fff",
            textShadow: "0 2px 12px rgba(0,0,0,0.35)",
          }}
        >
          {t("hero_title")}{" "}
          <Box component="span" sx={{ color: "primary.light" }}>
            {t("home_translated")}
          </Box>{" "}
          {t("in_bangladesh")}
        </Typography>

        <Typography
          variant="subtitle1"
          sx={{
            fontSize: { xs: "1rem", md: "1.15rem" },
            color: alpha("#fff", 0.9),
            maxWidth: "560px",
            mx: "auto",
            mb: { xs: 3, md: 4 },
          }}
        >
          {t("hero_subtitle")}
        </Typography>

        <HomeSearchBar />
      </Container>
    </Box>
  );
};

export default HeroSection;
