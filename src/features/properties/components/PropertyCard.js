import React from "react";
import { Link as RouterLink } from "react-router-dom";
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
import WishlistButton from "./WishlistButton";
 
const PropertyCard = ({ property, isWishlisted, onWishlistToggle }) => {
  const theme = useTheme();
 
  if (!property || typeof property !== "object" || !property._id) {
    return null;
  }
 
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
    [property.addressLine1, property.upazila, property.cityTown, property.district]
      .filter(Boolean)
      .join(", ") || "Location N/A";
 
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
 
          {/* Status badge — only when not available */}
          {property.listingStatus && property.listingStatus !== "available" && (
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
        </CardContent>
      </Card>
    </RouterLink>
  );
};
 
export default PropertyCard;