import React from "react";
import { Box, Container, Grid, Paper, Typography } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import BoltIcon from "@mui/icons-material/Bolt";
import SavingsIcon from "@mui/icons-material/Savings";
import PublicIcon from "@mui/icons-material/Public";

// Compact, secondary guidance cards - each links to a real existing
// destination (property listings / the map), and are intentionally plainer
// (Paper + manual border, not the theme's own MuiCard hover treatment) so
// they never compete visually with actual property listings above.
//
// The third card ("Explore areas and locations" -> /map) serves a different
// UX purpose than the navbar's own "Map" link (see Navbar.js): the navbar
// entry is for direct navigation, this card is a homepage discovery prompt
// - both are intentionally kept.
const SupportingInfoCards = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const theme = useTheme();

  const cards = [
    {
      key: "faster",
      icon: <BoltIcon />,
      title: t("support_card_1_title"),
      text: t("support_card_1_text"),
      path: "/properties/rent",
    },
    {
      key: "budget",
      icon: <SavingsIcon />,
      title: t("support_card_2_title"),
      text: t("support_card_2_text"),
      path: "/properties/buy",
    },
    {
      key: "areas",
      icon: <PublicIcon />,
      title: t("support_card_3_title"),
      text: t("support_card_3_text"),
      path: "/map",
    },
  ];

  return (
    <Box sx={{ py: { xs: 3, md: 4 } }}>
      <Container maxWidth="lg">
        <Grid container spacing={2}>
          {cards.map((card) => (
            <Grid item xs={12} sm={4} key={card.key}>
              <Paper
                onClick={() => navigate(card.path)}
                elevation={0}
                sx={{
                  p: 2.5,
                  height: "100%",
                  minHeight: 0,
                  cursor: "pointer",
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: "12px",
                  transition: "all 0.2s ease",
                  "&:hover": {
                    borderColor: alpha(theme.palette.primary.main, 0.5),
                    transform: "translateY(-2px)",
                  },
                }}
              >
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: "8px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mb: 1.5,
                    color: theme.palette.primary.main,
                    backgroundColor: alpha(theme.palette.primary.main, 0.1),
                    "& svg": { fontSize: "1.15rem" },
                  }}
                >
                  {card.icon}
                </Box>
                <Typography
                  variant="subtitle1"
                  sx={{ fontWeight: 700, mb: 0.5, color: "text.primary" }}
                >
                  {card.title}
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  {card.text}
                </Typography>
              </Paper>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
};

export default SupportingInfoCards;
