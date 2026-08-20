import React from "react";
import { IconButton, Tooltip } from "@mui/material";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import { useThemeMode } from "../../context/ThemeContext";
 
const ThemeToggle = () => {
  const { mode, toggleMode } = useThemeMode();
 
  return (
    <Tooltip title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
      <IconButton
        onClick={toggleMode}
        size="medium"
        aria-label="toggle theme"
        sx={{
          transition: "all 0.2s ease",
          color: "text.secondary",
          "&:hover": {
            color: "primary.main",
            backgroundColor: "action.hover",
          },
        }}
      >
        {mode === "dark" ? (
          <LightModeIcon fontSize="small" />
        ) : (
          <DarkModeIcon fontSize="small" />
        )}
      </IconButton>
    </Tooltip>
  );
};
 
export default ThemeToggle;