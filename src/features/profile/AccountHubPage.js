import React from "react";
import {
  Box,
  Container,
  Grid,
  Paper,
  Typography,
  Button,
  ButtonBase,
  Alert,
} from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useTheme, alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../context/AuthContext";

import HomeWorkIcon from "@mui/icons-material/HomeWork";
import FavoriteIcon from "@mui/icons-material/Favorite";
import ChatIcon from "@mui/icons-material/Chat";
import SettingsIcon from "@mui/icons-material/Settings";
import AddBusinessIcon from "@mui/icons-material/AddBusiness";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import LogoutIcon from "@mui/icons-material/Logout";

// The "My Account" hub. Every card routes to a real, already-working page
// (My Property/Collections->/saved/Messages->/chat/Settings->/user-profile/
// List a Property->/list-property/Admin Dashboard, all pre-existing routes -
// see App.js). Renter Profile and Rental Applications are intentionally left
// out until they have real functionality behind them - no placeholder
// "Coming soon" cards in production.
const AccountHubPage = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();
  const { isLoggedIn, user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  // Same in-component "please log in" pattern already used by Saved.js /
  // useProfileManagement.js - this project has no router-level
  // ProtectedRoute for account pages, so a new one isn't invented here.
  if (!isLoggedIn) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="warning">
          {t("please_log_in_account", "Please")}{" "}
          <RouterLink to="/login">{t("login", "Log in")}</RouterLink>{" "}
          {t("please_log_in_account_suffix", "to view your account.")}
        </Alert>
      </Container>
    );
  }

  const cards = [
    {
      key: "myProperty",
      icon: <HomeWorkIcon />,
      title: t("account_my_property", "My Property"),
      description: t("account_my_property_desc", "Manage your listings and property activity."),
      path: "/my-property",
    },
    {
      key: "collections",
      icon: <FavoriteIcon />,
      title: t("account_collections", "Collections"),
      description: t("account_collections_desc", "View and manage properties you've saved."),
      path: "/saved",
    },
    {
      key: "messages",
      icon: <ChatIcon />,
      title: t("nav_messages", "Messages"),
      description: t("account_messages_desc", "Manage your property enquiries and conversations."),
      path: "/chat",
    },
    {
      key: "settings",
      icon: <SettingsIcon />,
      title: t("account_settings", "Settings"),
      description: t("account_settings_desc", "Manage your profile, password and account."),
      path: "/user-profile",
    },
    {
      key: "listProperty",
      icon: <AddBusinessIcon />,
      title: t("account_list_property", "List a Property"),
      description: t("account_list_property_desc", "Advertise a property for sale or rent."),
      path: "/list-property",
    },
  ];

  // Reuses the exact same admin permission source ProfileMenu.js already
  // uses (user?.isAdmin, sourced from the backend UserProfile document via
  // AuthContext) - no second admin-role system, and the card is simply
  // absent from the array (not rendered-then-hidden) for non-admin users.
  if (user?.isAdmin) {
    cards.push({
      key: "admin",
      icon: <AdminPanelSettingsIcon />,
      title: t("admin_dashboard", "Admin Dashboard"),
      description: t("account_admin_desc", "Review approvals and manage platform administration."),
      path: "/admin/pending-approvals",
    });
  }

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Box
        sx={{
          display: "flex",
          alignItems: { xs: "flex-start", sm: "center" },
          justifyContent: "space-between",
          flexDirection: { xs: "column", sm: "row" },
          gap: 2,
          mb: 1,
        }}
      >
        <Typography variant="h4" component="h1" fontWeight={700}>
          {t("account_heading", "My Account")}
        </Typography>
        <Button
          variant="outlined"
          color="error"
          startIcon={<LogoutIcon />}
          onClick={handleLogout}
          sx={{ borderRadius: "8px", textTransform: "none", flexShrink: 0 }}
        >
          {t("nav_logout", "Logout")}
        </Button>
      </Box>

      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        {t("account_subtitle", "Manage your properties, saved homes, messages and account settings.")}
      </Typography>

      <Grid container spacing={3}>
        {cards.map((card) => (
          <Grid item xs={12} sm={6} md={4} key={card.key}>
            <ButtonBase
              component={RouterLink}
              to={card.path}
              sx={{
                display: "block",
                width: "100%",
                height: "100%",
                textAlign: "left",
                borderRadius: "14px",
              }}
            >
              <Paper
                elevation={0}
                sx={{
                  p: 3,
                  height: "100%",
                  width: "100%",
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: "14px",
                  transition: "all 0.2s ease",
                  "&:hover": {
                    borderColor: theme.palette.primary.main,
                    boxShadow: `0 8px 24px ${alpha(theme.palette.primary.main, 0.12)}`,
                  },
                }}
              >
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: "10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mb: 1.5,
                    color: theme.palette.primary.main,
                    backgroundColor: alpha(theme.palette.primary.main, 0.1),
                  }}
                >
                  {card.icon}
                </Box>
                <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                  {card.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {card.description}
                </Typography>
              </Paper>
            </ButtonBase>
          </Grid>
        ))}
      </Grid>
    </Container>
  );
};

export default AccountHubPage;
