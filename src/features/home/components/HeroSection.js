import React from "react";
import { Box, Container, Typography, Button, Grid, Stack } from "@mui/material";
import { styled, useTheme, alpha } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
 
const heroImageUrl = `${process.env.PUBLIC_URL}/pictures/dhaka2.jpg`;
 
const StyledButton = styled(Button)(({ theme, variant }) => ({
  borderRadius: "10px",
  padding: theme.spacing(1.2, 3),
  fontWeight: 700,
  textTransform: "none",
  transition: "all 0.3s ease",
  fontSize: "1.05rem",
  ...(variant === "contained" && {
    background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
    color: theme.palette.primary.contrastText,
    boxShadow: `0 0 20px ${alpha(theme.palette.primary.main, 0.4)}`,
    "&:hover": {
      background: `linear-gradient(135deg, ${theme.palette.success.main} 0%, ${theme.palette.primary.main} 100%)`,
      transform: "translateY(-3px)",
      boxShadow: `0 0 30px ${alpha(theme.palette.primary.main, 0.55)}`,
    },
  }),
  ...(variant === "outlined" && {
    borderColor: alpha(theme.palette.primary.main, 0.5),
    color: theme.palette.primary.main,
    "&:hover": {
      backgroundColor: alpha(theme.palette.primary.main, 0.08),
      borderColor: theme.palette.primary.main,
      transform: "translateY(-3px)",
    },
  }),
}));
 
const HeroSection = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
 
  return (
    <Box
      sx={{
        background: isDark
          ? `linear-gradient(160deg, ${theme.palette.background.default} 0%, ${theme.palette.background.paper} 60%, ${alpha(theme.palette.primary.main, 0.06)} 100%)`
          : `linear-gradient(160deg, ${theme.palette.background.default} 60%, ${alpha(theme.palette.primary.main, 0.12)} 100%)`,
        pt: { xs: 8, md: 12 },
        pb: { xs: 8, md: 10 },
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative glow orbs */}
      <Box
        sx={{
          position: "absolute",
          width: "500px",
          height: "500px",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${alpha(theme.palette.primary.main, 0.07)} 0%, transparent 70%)`,
          top: -200,
          right: -100,
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          width: "300px",
          height: "300px",
          borderRadius: "50%",
          background: `radial-gradient(circle, ${alpha(theme.palette.success.main, 0.05)} 0%, transparent 70%)`,
          bottom: -100,
          left: -50,
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
 
      <Container maxWidth="xl">
        <Grid container spacing={4} alignItems="center">
          <Grid item xs={12} md={6} sx={{ position: "relative", zIndex: 1 }}>
            <Typography
              variant="h1"
              sx={{
                fontSize: { xs: "2.5rem", md: "3.5rem" },
                fontWeight: 800,
                mb: 2,
                lineHeight: 1.2,
                color: "text.primary",
              }}
            >
              {t("hero_title")}{" "}
              <Box
                component="span"
                sx={{
                  background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.success.main})`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {t("home_translated")}
              </Box>{" "}
              {t("in_bangladesh")}
            </Typography>
 
            <Typography
              variant="subtitle1"
              sx={{
                fontSize: { xs: "1.1rem", md: "1.25rem" },
                mb: 4,
                color: "text.secondary",
                maxWidth: "650px",
              }}
            >
              {t("hero_subtitle")}
            </Typography>
 
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              justifyContent={{ xs: "center", md: "flex-start" }}
            >
              <StyledButton
                variant="contained"
                size="large"
                endIcon={<ArrowForwardIcon />}
                onClick={() => navigate("/properties/rent")}
              >
                {t("explore_properties")}
              </StyledButton>
              <StyledButton
                variant="outlined"
                size="large"
                onClick={() => navigate("/list-property")}
              >
                {t("list_property")}
              </StyledButton>
            </Stack>
          </Grid>
 
          <Grid item xs={12} md={6} sx={{ display: { xs: "none", md: "block" } }}>
            <Box
              component="img"
              src={heroImageUrl}
              alt="Modern home in Bangladesh"
              sx={{
                width: "100%",
                maxWidth: "600px",
                height: "auto",
                maxHeight: "400px",
                objectFit: "cover",
                borderRadius: "16px",
                boxShadow: isDark
                  ? `0 0 60px ${alpha(theme.palette.primary.main, 0.15)}, 0 20px 40px rgba(0,0,0,0.4)`
                  : `0 15px 35px ${alpha(theme.palette.primary.main, 0.15)}`,
                transform: "perspective(1000px) rotateY(-5deg)",
                transition: "all 0.5s ease",
                border: `1px solid ${alpha(theme.palette.primary.main, 0.15)}`,
                "&:hover": {
                  transform: "perspective(1000px) rotateY(0deg)",
                  boxShadow: isDark
                    ? `0 0 80px ${alpha(theme.palette.primary.main, 0.25)}, 0 20px 40px rgba(0,0,0,0.4)`
                    : `0 20px 50px ${alpha(theme.palette.primary.main, 0.25)}`,
                },
                display: "block",
                mx: "auto",
              }}
            />
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};
 
export default HeroSection;
 