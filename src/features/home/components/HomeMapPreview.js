import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Container,
  Paper,
  CircularProgress,
  Alert,
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import MapComponent from "../../map/components/MapComponent";
import { getPropertyCoordinates } from "../../../shared/propertyLocation";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:5001/api";
 
const HomeMapPreview = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
 
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
 
  useEffect(() => {
    const fetchPreviewProperties = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get(`${API_BASE_URL}/properties`, {
          params: { limit: 10, featured: true },
        });
 
        const mappableProperties = (response.data || [])
          .map((prop) => {
            const property = prop.toObject ? prop.toObject() : prop;
            const coords = getPropertyCoordinates(property);
            if (coords) {
              property.position = coords;
            }
            return property;
          })
          .filter((p) => p.position && p.position.lat && p.position.lng);
 
        setProperties(mappableProperties);
      } catch (err) {
        console.error("Error fetching preview properties:", err);
        setError(
          t("map_preview_load_error", "Could not load properties for map preview.")
        );
      } finally {
        setLoading(false);
      }
    };
 
    fetchPreviewProperties();
  }, [t]);
 
  return (
    <Box
      sx={{
        py: { xs: 4, md: 5 },
        background: isDark
          ? `linear-gradient(180deg, ${theme.palette.background.default} 0%, ${theme.palette.background.paper} 100%)`
          : `linear-gradient(180deg, ${theme.palette.background.default} 0%, ${alpha(theme.palette.primary.main, 0.04)} 100%)`,
        position: "relative",
        overflow: "hidden",
        "&::before": {
          content: '""',
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "600px",
          height: "1px",
          background: `linear-gradient(90deg, transparent, ${alpha(theme.palette.primary.main, 0.3)}, transparent)`,
        },
      }}
    >
      <Container maxWidth="lg">
        <Typography
          variant="h4"
          component="h2"
          fontWeight={700}
          gutterBottom
          align="center"
          sx={{ color: "text.primary" }}
        >
          {t("explore_on_map_title")}
        </Typography>
        <Typography
          variant="body1"
          align="center"
          sx={{ mb: 4, color: "text.secondary" }}
        >
          {t("explore_on_map_subtitle")}
        </Typography>
 
        <Paper
          elevation={0}
          sx={{
            height: { xs: "300px", sm: "400px", md: "500px" },
            width: "100%",
            borderRadius: "16px",
            overflow: "hidden",
            border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
            boxShadow: isDark
              ? `0 0 40px ${alpha(theme.palette.primary.main, 0.08)}, 0 8px 32px rgba(0,0,0,0.4)`
              : `0 4px 24px ${alpha(theme.palette.primary.main, 0.1)}`,
            mb: 4,
            position: "relative",
          }}
        >
          {loading ? (
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100%",
                backgroundColor: "background.paper",
              }}
            >
              <CircularProgress color="primary" />
              <Typography sx={{ ml: 2, color: "text.secondary" }}>
                {t("loading_map_preview", "Loading Map...")}
              </Typography>
            </Box>
          ) : error ? (
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100%",
                p: 2,
                backgroundColor: "background.paper",
              }}
            >
              <Alert severity="error" sx={{ width: "100%" }}>
                {error}
              </Alert>
            </Box>
          ) : (
            <MapComponent
              properties={properties}
              mapCenter={[23.8103, 90.4125]}
              mapZoom={7}
              // Tighter than MapComponent's own default (32px) - this is a
              // small preview box, so Bangladesh should fill more of it,
              // without affecting the full /map page's fit.
              fitPadding={10}
            />
          )}
        </Paper>
 
        <Box sx={{ textAlign: "center" }}>
          <Button
            variant="contained"
            color="primary"
            onClick={() => navigate("/map")}
            sx={{ borderRadius: "10px", textTransform: "none", px: 4, py: 1.2 }}
          >
            {t("open_full_map", "Open Full Map")}
          </Button>
        </Box>
      </Container>
    </Box>
  );
};
 
export default HomeMapPreview;