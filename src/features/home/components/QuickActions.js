import React from "react";
import { Box, Container, Stack, Link as MuiLink } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

// Buy/Rent/Sold already appear prominently as the centered tabs inside the
// hero's own search panel (see HeroSection.js/HomeSearchBar.js), so this
// row is deliberately lightweight now - plain text shortcuts, not bordered
// buttons - rather than visually repeating the same three options a second
// time. "Search by Location" was removed: map discovery now has its own
// dedicated navbar item (see Navbar.js) instead of a homepage shortcut.
// Destinations are the same real, already-working routes as before (see
// Footer.js/MobileDrawer.js's own /properties/buy and /properties/sold
// links).
const QuickActions = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const theme = useTheme();

  const actions = [
    { key: "buy", label: t("nav_buy"), path: "/properties/buy" },
    { key: "rent", label: t("nav_rent"), path: "/properties/rent" },
    { key: "sold", label: t("nav_sold"), path: "/properties/sold" },
  ];

  return (
    <Box sx={{ pb: { xs: 2, md: 2.5 } }}>
      <Container maxWidth="lg">
        <Stack
          direction="row"
          spacing={{ xs: 2, sm: 3 }}
          justifyContent="center"
          divider={
            <Box
              sx={{
                width: "3px",
                height: "3px",
                borderRadius: "50%",
                backgroundColor: theme.palette.divider,
                alignSelf: "center",
              }}
            />
          }
        >
          {actions.map((action) => (
            <MuiLink
              key={action.key}
              component="button"
              onClick={() => navigate(action.path)}
              underline="hover"
              sx={{
                color: "text.secondary",
                fontWeight: 600,
                fontSize: "0.85rem",
                "&:hover": { color: theme.palette.primary.main },
              }}
            >
              {action.label}
            </MuiLink>
          ))}
        </Stack>
      </Container>
    </Box>
  );
};

export default QuickActions;
