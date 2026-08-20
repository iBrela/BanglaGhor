import React from "react";
import { Box, Container, Typography, Divider } from "@mui/material";
import { styled, useTheme, alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
 
import MissionSection from "./components/MissionSection";
import ValuesSection from "./components/ValuesSection";
import TeamSection from "./components/TeamSection";
import AboutCTASection from "./components/AboutCTASection";
 
const IntroBackground = styled(Box)(({ theme }) => ({
  padding: theme.spacing(10, 2),
  background:
    theme.palette.mode === "dark"
      ? `linear-gradient(160deg, ${theme.palette.background.default} 0%, ${theme.palette.background.paper} 60%, ${alpha(theme.palette.primary.main, 0.06)} 100%)`
      : `linear-gradient(160deg, ${theme.palette.background.default} 60%, ${alpha(theme.palette.primary.main, 0.12)} 100%)`,
  textAlign: "center",
  position: "relative",
  overflow: "hidden",
  "&::before": {
    content: '""',
    position: "absolute",
    width: "400px",
    height: "400px",
    borderRadius: "50%",
    background: `radial-gradient(circle, ${alpha(theme.palette.primary.main, 0.08)} 0%, transparent 70%)`,
    top: -150,
    right: -100,
    pointerEvents: "none",
  },
}));
 
const AboutUsPage = () => {
  const { t } = useTranslation();
  const theme = useTheme();
 
  return (
    <Box sx={{ backgroundColor: "background.default", minHeight: "100vh" }}>
      <IntroBackground>
        <Container maxWidth="md" sx={{ position: "relative", zIndex: 1 }}>
          <Typography
            variant="h2"
            component="h1"
            fontWeight={800}
            gutterBottom
            sx={{ color: "text.primary" }}
          >
            {t("nav_about")}{" "}
            <Box
              component="span"
              sx={{
                background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.success.main})`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              BanglaGhor
            </Box>
          </Typography>
          <Typography
            variant="h5"
            paragraph
            sx={{ color: "text.secondary", fontWeight: 400, lineHeight: 1.7 }}
          >
            Connecting you with your perfect property in Bangladesh. Learn more
            about our journey, values, and the team dedicated to simplifying
            your real estate experience.
          </Typography>
        </Container>
      </IntroBackground>
 
      <Container maxWidth="lg">
        <MissionSection />
        <Divider sx={{ my: 4 }} />
        <ValuesSection />
        <TeamSection />
      </Container>
 
      <AboutCTASection />
    </Box>
  );
};
 
export default AboutUsPage;