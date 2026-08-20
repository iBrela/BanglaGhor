import React from "react";
import { Toolbar, Typography, Tooltip, IconButton, Button, Paper } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";

const BulkActionsToolbar = ({
  mode = "active",
  numSelected,
  hasListings,
  onMoveToBin,
  onPermanentDeleteSelected,
  onEmptyBin,
  isLoading,
}) => {
  const showSelectionBar = numSelected > 0;
  const showEmptyBin = mode === "trash" && hasListings;

  if (!showSelectionBar && !showEmptyBin) {
    return null;
  }

  return (
    <Paper sx={{ width: "100%", mb: 2 }} elevation={1}>
      <Toolbar
        sx={{
          pl: { sm: 2 },
          pr: { xs: 1, sm: 1 },
          bgcolor: (theme) =>
            theme.palette.mode === "light"
              ? theme.palette.secondary.lighter // Use theme colors if defined, or fallback
              : theme.palette.secondary.darker,
          display: "flex",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <Typography
          sx={{ flex: "1 1 100%" }}
          color="inherit"
          variant="subtitle1"
          component="div"
        >
          {showSelectionBar ? `${numSelected} selected` : "Recycle Bin"}
        </Typography>

        {showSelectionBar && mode === "active" && (
          <Tooltip title="Move to Recycle Bin">
            <span>
              <IconButton onClick={onMoveToBin} disabled={isLoading}>
                <DeleteIcon />
              </IconButton>
            </span>
          </Tooltip>
        )}

        {showSelectionBar && mode === "trash" && (
          <Tooltip title="Permanently Delete Selected">
            <span>
              <IconButton
                onClick={onPermanentDeleteSelected}
                disabled={isLoading}
                color="error"
              >
                <DeleteForeverIcon />
              </IconButton>
            </span>
          </Tooltip>
        )}

        {showEmptyBin && (
          <Tooltip title="Permanently delete every listing currently shown in the Recycle Bin">
            <span>
              <Button
                onClick={onEmptyBin}
                disabled={isLoading}
                color="error"
                size="small"
                startIcon={<DeleteSweepIcon />}
                sx={{ textTransform: "none" }}
              >
                Empty Recycle Bin
              </Button>
            </span>
          </Tooltip>
        )}
      </Toolbar>
    </Paper>
  );
};

export default BulkActionsToolbar;
