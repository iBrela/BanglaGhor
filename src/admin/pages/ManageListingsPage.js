import React from "react";
import { Typography, Container, Alert, TablePagination, Tabs, Tab } from "@mui/material";
import { useManageListings } from "../hooks/useManageListings";
import ListingFilters from "../components/listings/ListingFilters";
import BulkActionsToolbar from "../components/listings/BulkActionsToolbar";
import ListingsTable from "../components/listings/ListingsTable";
import ConfirmationDialog from "../../components/common/ConfirmationDialog";

const CONFIRM_DIALOG_CONTENT = {
  softDelete: {
    title: "Move to Recycle Bin",
    confirmText: "Move to Recycle Bin",
    confirmButtonProps: { color: "warning", variant: "contained" },
    message: (count) =>
      `Move ${count} selected listing(s) to the Recycle Bin? They will be hidden from the website and can be restored later.`,
  },
  permanentDeleteSelected: {
    title: "Permanently Delete Listings",
    confirmText: "Permanently Delete",
    confirmButtonProps: { color: "error", variant: "contained" },
    message: (count) =>
      `Permanently delete ${count} listing(s)? This cannot be undone and will also remove their images.`,
  },
  emptyBin: {
    title: "Empty Recycle Bin",
    confirmText: "Empty Recycle Bin",
    confirmButtonProps: { color: "error", variant: "contained" },
    message: () =>
      "Permanently delete ALL listings currently in the Recycle Bin, across every page? This cannot be undone.",
  },
};

const getDialogContent = (confirmAction) => {
  if (!confirmAction) return null;
  if (confirmAction.type === "softDelete") {
    return CONFIRM_DIALOG_CONTENT.softDelete;
  }
  if (confirmAction.type === "permanentDelete") {
    return CONFIRM_DIALOG_CONTENT.permanentDeleteSelected;
  }
  if (confirmAction.type === "emptyBin") {
    return CONFIRM_DIALOG_CONTENT.emptyBin;
  }
  return null;
};

const ManageListingsPage = () => {
  const {
    listings,
    loading,
    fetchError,
    viewMode,
    setViewMode,
    page,
    rowsPerPage,
    totalListings,
    order,
    orderBy,
    searchTerm,
    filterPropertyType,
    filterListingType,
    filterVisibility,
    filterFeatured,
    actionLoading,
    bulkActionLoading,
    selected,
    confirmAction,
    isSelected,
    handleSearchChange,
    handleFilterChange,
    handleSelectAllClick,
    handleRowClick,
    handleRequestSort,
    handleChangePage,
    handleChangeRowsPerPage,
    handleVisibilityToggle,
    handleFeatureToggle,
    handleRestoreSingle,
    handleMoveSelectedToBin,
    handlePermanentDeleteSelected,
    handlePermanentDeleteSingle,
    handleEmptyRecycleBin,
    executeConfirmedAction,
    closeConfirmDialog,
    setFilterPropertyType,
    setFilterListingType,
    setFilterVisibility,
    setFilterFeatured,
  } = useManageListings();

  const dialogContent = getDialogContent(confirmAction);

  return (
    <Container maxWidth="xl">
      <Typography variant="h4" gutterBottom sx={{ mt: 2, mb: 2 }}>
        Manage Listings
      </Typography>

      <Tabs
        value={viewMode}
        onChange={(e, newValue) => setViewMode(newValue)}
        sx={{ mb: 2 }}
      >
        <Tab label="Active Listings" value="active" />
        <Tab label="Recycle Bin" value="trash" />
      </Tabs>

      <ListingFilters
        searchTerm={searchTerm}
        filterPropertyType={filterPropertyType}
        filterListingType={filterListingType}
        filterVisibility={filterVisibility}
        filterFeatured={filterFeatured}
        onSearchChange={handleSearchChange}
        onFilterChange={handleFilterChange}
        setFilterPropertyType={setFilterPropertyType}
        setFilterListingType={setFilterListingType}
        setFilterVisibility={setFilterVisibility}
        setFilterFeatured={setFilterFeatured}
      />

      <BulkActionsToolbar
        mode={viewMode}
        numSelected={selected.length}
        hasListings={listings.length > 0}
        onMoveToBin={handleMoveSelectedToBin}
        onPermanentDeleteSelected={handlePermanentDeleteSelected}
        onEmptyBin={handleEmptyRecycleBin}
        isLoading={bulkActionLoading}
      />

      {fetchError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {fetchError}
        </Alert>
      )}

      <ListingsTable
        mode={viewMode}
        listings={listings}
        loading={loading}
        order={order}
        orderBy={orderBy}
        selected={selected}
        actionLoading={actionLoading}
        isSelected={isSelected}
        onSelectAllClick={handleSelectAllClick}
        onRowClick={handleRowClick}
        onRequestSort={handleRequestSort}
        onVisibilityToggle={handleVisibilityToggle}
        onFeatureToggle={handleFeatureToggle}
        onRestoreSingle={handleRestoreSingle}
        onPermanentDeleteSingle={handlePermanentDeleteSingle}
        bulkDeleteLoading={bulkActionLoading}
      />

      {/* Pagination */}
      <TablePagination
        rowsPerPageOptions={[10, 25, 50, 100]}
        component="div"
        count={totalListings}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />

      {/* Confirmation Dialog - shared by soft delete, permanent delete, and empty bin */}
      <ConfirmationDialog
        open={!!confirmAction}
        onClose={closeConfirmDialog}
        onConfirm={executeConfirmedAction}
        title={dialogContent?.title || "Confirm"}
        message={dialogContent?.message(confirmAction?.ids?.length || 0) || ""}
        confirmText={dialogContent?.confirmText || "Confirm"}
        cancelText="Cancel"
        confirmButtonProps={dialogContent?.confirmButtonProps}
        isConfirming={bulkActionLoading}
      />
    </Container>
  );
};

export default ManageListingsPage;
