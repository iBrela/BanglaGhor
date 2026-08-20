import React from "react";
import PropTypes from "prop-types";
import { IconButton, Tooltip } from "@mui/material";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
 
const WishlistButton = ({ isWishlisted, onClick, sx = {} }) => {
  const { t } = useTranslation();
 
  const handleClick = (event) => {
    event.stopPropagation();
    event.preventDefault();
    onClick();
  };
 
  return (
    <Tooltip
      title={isWishlisted ? "Remove from Wishlist" : "Add to Wishlist"}
      arrow
    >
      <IconButton
        aria-label={isWishlisted ? "remove from favorites" : "add to favorites"}
        onClick={handleClick}
        sx={{
          color: isWishlisted ? "#FF5F40" : "#7BAFC0",           // coral when saved, muted teal when not
          bgcolor: alpha("#071318", 0.75),                        // dark bg instead of white
          backdropFilter: "blur(4px)",
          border: `1px solid ${isWishlisted ? alpha("#FF5F40", 0.4) : alpha("#1C3F4E", 0.8)}`,
          transition: "all 0.2s ease",
          "&:hover": {
            bgcolor: alpha("#071318", 0.9),
            color: isWishlisted ? "#FF8060" : "#00D4E8",          // lighten coral / go cyan on hover
            border: `1px solid ${isWishlisted ? alpha("#FF5F40", 0.7) : alpha("#00D4E8", 0.5)}`,
            transform: "scale(1.1)",
          },
          ...sx,
        }}
      >
        {isWishlisted ? (
          <FavoriteIcon sx={{ fontSize: "1.1rem" }} />
        ) : (
          <FavoriteBorderIcon sx={{ fontSize: "1.1rem" }} />
        )}
      </IconButton>
    </Tooltip>
  );
};
 
WishlistButton.propTypes = {
  isWishlisted: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
  sx: PropTypes.object,
};
 
export default WishlistButton;
 