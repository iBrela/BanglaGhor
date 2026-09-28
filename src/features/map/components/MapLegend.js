import React, { useState } from "react";
import { Box, Paper, Typography, IconButton, Collapse, useMediaQuery } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import MapIcon from "@mui/icons-material/Map";
import CloseIcon from "@mui/icons-material/Close";
import { PROPERTY_MARKER_ORDER, PROPERTY_MARKER_CONFIG } from "../config/propertyMarkerConfig";
import { POI_MARKER_CONFIG, POI_CATEGORY_ORDER } from "../config/poiMarkerConfig";

// Compact, floating legend - top-left of the map (top-right is MapLibre's
// own NavigationControl, bottom is PropertyInfoPanel's full-width sheet once
// a property is selected, so top-left is the one corner nothing else uses).
// Always shows the Buy/Rent/Sold key; only shows a "Nearby places" section
// when `poiCategories` is non-empty (i.e. recommendation mode actually has
// requested-amenity POIs on screen right now) - never every possible POI
// category, per the "don't show what isn't rendered" requirement.
const MapLegend = ({ poiCategories = [] }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [open, setOpen] = useState(!isMobile);

  const visiblePoiCategories = POI_CATEGORY_ORDER.filter((c) => poiCategories.includes(c));

  return (
    <Box
      sx={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 5,
        maxWidth: { xs: 190, sm: 210 },
      }}
    >
      <Paper
        elevation={3}
        sx={{
          borderRadius: "10px",
          overflow: "hidden",
          bgcolor: alpha(theme.palette.background.paper, 0.94),
          backdropFilter: "blur(4px)",
        }}
      >
        <Box
          onClick={() => setOpen((prev) => !prev)}
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            px: 1,
            py: 0.5,
            cursor: "pointer",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <MapIcon sx={{ fontSize: "1rem", color: "text.secondary" }} />
            <Typography variant="caption" sx={{ fontWeight: 700, fontSize: "0.7rem" }}>
              {t("map_legend_title", "Legend")}
            </Typography>
          </Box>
          <IconButton size="small" sx={{ p: 0.25 }}>
            {open ? (
              <CloseIcon sx={{ fontSize: "0.9rem" }} />
            ) : (
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  bgcolor: theme.palette.primary.main,
                }}
              />
            )}
          </IconButton>
        </Box>

        <Collapse in={open}>
          <Box sx={{ px: 1, pb: 1 }}>
            <Typography
              variant="caption"
              sx={{ display: "block", fontWeight: 700, fontSize: "0.62rem", color: "text.secondary", mt: 0.5 }}
            >
              {t("map_legend_properties", "Properties")}
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, mt: 0.25 }}>
              {PROPERTY_MARKER_ORDER.map((key) => {
                const cfg = PROPERTY_MARKER_CONFIG[key];
                return (
                  <Box key={key} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: "50% 50% 50% 0",
                        transform: "rotate(-45deg)",
                        bgcolor: cfg.color,
                        border: "1px solid #fff",
                        boxShadow: "0 0 0 1px rgba(0,0,0,0.15)",
                        flexShrink: 0,
                      }}
                    />
                    <Typography variant="caption" sx={{ fontSize: "0.68rem" }}>
                      {t(cfg.labelKey, cfg.labelFallback)}
                    </Typography>
                  </Box>
                );
              })}
            </Box>

            {visiblePoiCategories.length > 0 && (
              <>
                <Typography
                  variant="caption"
                  sx={{ display: "block", fontWeight: 700, fontSize: "0.62rem", color: "text.secondary", mt: 1 }}
                >
                  {t("map_legend_nearby_places", "Nearby places")}
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, mt: 0.25 }}>
                  {visiblePoiCategories.map((category) => {
                    const cfg = POI_MARKER_CONFIG[category];
                    if (!cfg) return null;
                    const Icon = cfg.Icon;
                    return (
                      <Box key={category} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                        <Box
                          sx={{
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            bgcolor: cfg.color,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <Icon sx={{ fontSize: "0.62rem", color: "#fff" }} />
                        </Box>
                        <Typography variant="caption" sx={{ fontSize: "0.68rem" }}>
                          {t(cfg.labelKey, cfg.labelFallback)}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              </>
            )}
          </Box>
        </Collapse>
      </Paper>
    </Box>
  );
};

export default MapLegend;
