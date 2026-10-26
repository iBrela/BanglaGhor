import React from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardMedia,
  CardContent,
  Typography,
  Chip,
  Divider,
  alpha,
  useTheme,
} from "@mui/material";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RemoveShoppingCartIcon from "@mui/icons-material/RemoveShoppingCart";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import BedIcon from "@mui/icons-material/Bed";
import BathtubIcon from "@mui/icons-material/Bathtub";
import SquareFootIcon from "@mui/icons-material/SquareFoot";
import HomeWorkIcon from "@mui/icons-material/HomeWork";
import MapIcon from "@mui/icons-material/Map";
import BookmarkRemoveIcon from "@mui/icons-material/BookmarkRemove";
import WishlistButton from "./WishlistButton";
import { getPropertyCoordinates, formatPropertyAddress } from "../../../shared/propertyLocation";

// showViewOnMap and onUntrack are both optional, off by default - only the
// callers that need them (FeaturedProperties.js for showViewOnMap,
// MyPropertyPage.js's Tracked Properties section for onUntrack) pass them.
// The other existing PropertyCard usages (PropertiesPage.js, Saved.js,
// MyListingsPage.js) are unaffected either way. onUntrack is deliberately
// NOT wired to the wishlist - it's for the separate TrackedProperty feature
// (see server/models/TrackedProperty.js), never the wishlist.
const PropertyCard = ({
  property,
  isWishlisted,
  onWishlistToggle,
  showViewOnMap = false,
  onUntrack,
  untracking = false,
}) => {
  const theme = useTheme();
  const navigate = useNavigate();

  if (!property || typeof property !== "object" || !property._id) {
    return null;
  }

  // Same safety gate already used by ai_chatbot.js's individual "View on
  // map" button and MapPage.js's recommendationData: locationAccuracy must
  // be precise/approximate (a district-level property's geoLocation already
  // holds a real-looking but generic backend-fallback centroid, which
  // getPropertyCoordinates() alone can't tell apart from a genuine geocode)
  // AND getPropertyCoordinates() must return a real coordinate. Never
  // getPropertyDisplayCoordinates() (division/district centroid fallback).
  const isVerifiableAccuracy =
    property.locationAccuracy === "precise" || property.locationAccuracy === "approximate";
  const canShowOnMap = showViewOnMap && isVerifiableAccuracy && !!getPropertyCoordinates(property);

  // Reuses the exact same router-state contract as ai_chatbot.js's
  // individual property "View on map" button and MapPage.js's
  // recommendationData - no new map state format invented.
  const handleViewOnMap = (event) => {
    event.preventDefault();
    event.stopPropagation();
    navigate("/map", {
      state: {
        recommendedProperties: [property],
        recommendationLocation: null,
      },
    });
  };

  const handleUntrackClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (onUntrack && !untracking) onUntrack(property);
  };

  const placeholderImg = `/pictures/placeholder.png`;
 
  let imgSrc = placeholderImg;
  if (Array.isArray(property.images) && property.images.length > 0) {
    const firstImage = property.images[0];
    if (firstImage && (firstImage.startsWith("http://") || firstImage.startsWith("https://"))) {
      imgSrc = firstImage;
    }
  }
 
  const handleImageError = (e) => {
    e.target.onerror = null;
    e.target.src = placeholderImg;
  };
 
  const displayPrice =
    property.price !== null && property.price !== undefined
      ? `৳ ${Number(property.price).toLocaleString()}${property.listingType === "rent" ? "/mo" : ""}`
      : "Price N/A";
 
  let statusChipColor = "default";
  let statusChipIcon = <HelpOutlineIcon />;
  let statusLabel = property.listingStatus
    ? property.listingStatus.charAt(0).toUpperCase() + property.listingStatus.slice(1)
    : "Unknown";
 
  switch (property.listingStatus) {
    case "available":
      statusChipColor = "success";
      statusChipIcon = <CheckCircleIcon />;
      statusLabel = "Available";
      break;
    case "sold":
      statusChipColor = "error";
      statusChipIcon = <RemoveShoppingCartIcon />;
      statusLabel = "Sold";
      break;
    case "rented":
      statusChipColor = "warning";
      statusChipIcon = <EventBusyIcon />;
      statusLabel = "Rented";
      break;
    case "unavailable":
      statusChipColor = "default";
      statusChipIcon = <HelpOutlineIcon />;
      statusLabel = "Unavailable";
      break;
    default:
      break;
  }
 
  const locationString =
    formatPropertyAddress([
      property.addressLine1,
      property.upazila,
      property.cityTown,
      property.district,
    ]) || "Location N/A";
 
  const detailUrl = `/properties/details/${property._id}`;
  const isLandOrCommercial =
    property.propertyType === "land" || property.propertyType === "commercial";
 
  // Listing type badge — use theme secondary (coral) for rent, primary (cyan) for buy
  const listingTypeBg =
    property.listingType === "rent"
      ? alpha(theme.palette.secondary.main, 0.85)
      : alpha(theme.palette.primary.main, 0.85);
 
  return (
    <RouterLink to={detailUrl} style={{ textDecoration: "none", display: "block", height: "100%" }}>
      <Card
        sx={{
          borderRadius: "14px",
          overflow: "hidden",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          transition: "all 0.25s ease",
          backgroundColor: "background.paper",
          border: `1px solid ${theme.palette.divider}`,
          boxShadow: "none",
          "&:hover": {
            transform: "translateY(-6px)",
            borderColor: theme.palette.primary.main,
            boxShadow: `0 12px 40px ${alpha(theme.palette.primary.main, 0.15)}`,
          },
        }}
      >
        {/* ── Image area ── */}
        <Box sx={{ position: "relative", width: "100%" }}>
          {onWishlistToggle && (
            <WishlistButton
              isWishlisted={isWishlisted}
              onClick={onWishlistToggle}
              sx={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}
            />
          )}
 
          <CardMedia
            component="img"
            image={imgSrc}
            alt={property.title || "Property image"}
            onError={handleImageError}
            sx={{ objectFit: "cover", aspectRatio: "16/9", width: "100%" }}
          />
 
          {/* Listing type badge — Buy / Rent */}
          {property.listingType && (
            <Chip
              label={property.listingType.charAt(0).toUpperCase() + property.listingType.slice(1)}
              size="small"
              sx={{
                position: "absolute",
                top: 10,
                left: 10,
                zIndex: 1,
                bgcolor: listingTypeBg,
                color: "#fff",
                fontWeight: 700,
                fontSize: "0.75rem",
                borderRadius: "6px",
                backdropFilter: "blur(4px)",
                border: "none",
              }}
            />
          )}
 
          {/* Status badge — only when not available, and not when it would
              duplicate the listing-type badge above (which already reads
              "Sold" when listingType === "sold" - a property can also have
              listingStatus === "sold" independently, e.g. a "Buy" listing
              marked sold, where this badge is still the only Sold
              indicator and must keep rendering). */}
          {property.listingStatus &&
            property.listingStatus !== "available" &&
            !(property.listingType === "sold" && property.listingStatus === "sold") && (
            <Chip
              icon={statusChipIcon}
              label={statusLabel}
              size="small"
              color={statusChipColor}
              variant="filled"
              sx={{
                position: "absolute",
                bottom: 10,
                left: 10,
                zIndex: 1,
                fontWeight: 600,
                borderRadius: "6px",
                backdropFilter: "blur(4px)",
              }}
            />
          )}
        </Box>
 
        {/* ── Card body ── */}
        <CardContent
          sx={{
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            p: 2,
            "&:last-child": { pb: 2 },
          }}
        >
          {/* Title */}
          <Typography
            variant="h6"
            sx={{
              fontWeight: 700,
              mb: 0.75,
              fontSize: "1rem",
              color: "text.primary",
              lineHeight: 1.3,
            }}
            noWrap
          >
            {property.title || "Untitled Property"}
          </Typography>
 
          {/* Location */}
          <Box sx={{ display: "flex", alignItems: "center", mb: 1.5, gap: 0.5 }}>
            <LocationOnIcon sx={{ fontSize: "0.95rem", color: "primary.main", flexShrink: 0 }} />
            <Typography
              variant="body2"
              noWrap
              title={locationString}
              sx={{ color: "text.secondary", fontSize: "0.82rem" }}
            >
              {locationString}
            </Typography>
          </Box>
 
          {/* Beds / Baths / Area */}
          {!isLandOrCommercial ? (
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 1,
                mb: 1.5,
              }}
            >
              {[
                { Icon: BedIcon,        value: `${property.bedrooms ?? "?"} Beds`,   color: theme.palette.info.main },
                { Icon: BathtubIcon,    value: `${property.bathrooms ?? "?"} Baths`, color: theme.palette.primary.main },
                { Icon: SquareFootIcon, value: `${property.area ?? "?"} sqft`,        color: theme.palette.warning.main },
              ].map(({ Icon, value, color }) => (
                <Box key={value} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Icon sx={{ fontSize: "1rem", color }} />
                  <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem" }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1.5 }}>
              <SquareFootIcon sx={{ fontSize: "1rem", color: "success.main" }} />
              <Typography variant="body2" sx={{ color: "text.secondary", fontSize: "0.82rem" }}>
                Area: {property.area ?? "?"} sqft
              </Typography>
            </Box>
          )}
 
          <Box sx={{ flexGrow: 1 }} />
 
          <Divider sx={{ my: 1 }} />
 
          {/* Price + property type */}
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography
              variant="h6"
              sx={{
                color: "primary.main",
                fontWeight: 800,
                fontSize: "1.05rem",
                letterSpacing: "-0.01em",
              }}
            >
              {displayPrice}
            </Typography>
 
            {property.propertyType && (
              <Chip
                icon={<HomeWorkIcon sx={{ fontSize: "0.85rem !important" }} />}
                label={property.propertyType.charAt(0).toUpperCase() + property.propertyType.slice(1)}
                size="small"
                color="primary"
                sx={{
                  fontWeight: 600,
                  fontSize: "0.72rem",
                  borderRadius: "6px",
                }}
              />
            )}
          </Box>

          {/* View on Map / Untrack - compact, sits below price/type rather
              than beside them so neither ever covers the favourite button,
              Buy/Rent badge, property-type badge, price, or bed/bath/area
              figures. Wraps if both are present. */}
          {(canShowOnMap || onUntrack) && (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1 }}>
              {canShowOnMap && (
                <Chip
                  icon={<MapIcon sx={{ fontSize: "0.8rem !important" }} />}
                  label="View on Map"
                  size="small"
                  onClick={handleViewOnMap}
                  clickable
                  variant="outlined"
                  sx={{
                    fontWeight: 600,
                    fontSize: "0.7rem",
                    height: 24,
                    borderRadius: "6px",
                    color: "primary.main",
                    borderColor: "primary.main",
                    bgcolor: alpha(theme.palette.primary.main, 0.06),
                  }}
                />
              )}
              {onUntrack && (
                <Chip
                  icon={<BookmarkRemoveIcon sx={{ fontSize: "0.8rem !important" }} />}
                  label={untracking ? "Untracking…" : "Untrack"}
                  size="small"
                  onClick={handleUntrackClick}
                  disabled={untracking}
                  clickable
                  variant="outlined"
                  sx={{
                    fontWeight: 600,
                    fontSize: "0.7rem",
                    height: 24,
                    borderRadius: "6px",
                    color: theme.palette.secondary.main,
                    borderColor: theme.palette.secondary.main,
                    bgcolor: alpha(theme.palette.secondary.main, 0.06),
                  }}
                />
              )}
            </Box>
          )}
        </CardContent>
      </Card>
    </RouterLink>
  );
};
 
export default PropertyCard;