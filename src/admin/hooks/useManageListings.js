import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import axios from "axios";
import { debounce } from "@mui/material";
import { useAuth } from "../../context/AuthContext";
import { useSnackbar } from "../../context/SnackbarContext";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:5001/api";

export const useManageListings = () => {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const { idToken } = useAuth();
  const { showSnackbar } = useSnackbar();

  // "active" = normal Manage Listings view, "trash" = Recycle Bin view
  const [viewMode, setViewModeState] = useState("active");

  // State for Pagination, Sorting, Filtering
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [totalListings, setTotalListings] = useState(0);
  const [order, setOrder] = useState("desc");
  const [orderBy, setOrderBy] = useState("createdAt");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPropertyType, setFilterPropertyType] = useState("");
  const [filterListingType, setFilterListingType] = useState("");
  const [filterVisibility, setFilterVisibility] = useState("");
  const [filterFeatured, setFilterFeatured] = useState("");

  // State for Actions
  const [actionLoading, setActionLoading] = useState({});
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [selected, setSelected] = useState([]);
  // { type: "softDelete" | "permanentDelete", ids: string[], context: "selected" | "all" } | null
  const [confirmAction, setConfirmAction] = useState(null);

  const resetPage = useCallback(() => {
    setPage(0);
  }, [setPage]);

  const debouncedResetPage = useMemo(() => {
    return debounce(resetPage, 500);
  }, [resetPage]);

  // Debounce cleanup on unmount
  useEffect(() => {
    return () => {
      debouncedResetPage.clear();
    };
  }, [debouncedResetPage]);

  const setViewMode = useCallback((mode) => {
    setViewModeState(mode);
    setPage(0);
    setSelected([]);
    setConfirmAction(null);
  }, []);

  // Filter/Search Handlers
  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    debouncedResetPage(); // Call memoized debounced function
  };

  const handleFilterChange = (setter) => (event) => {
    setter(event.target.value);
    debouncedResetPage(); // Call memoized debounced function
  };

  // Guards against an older, slower in-flight request resolving AFTER a
  // newer one and clobbering its result with stale data.
  const latestRequestIdRef = useRef(0);

  const fetchListings = useCallback(async (pageOverride) => {
    if (!idToken) return;
    const requestId = ++latestRequestIdRef.current;
    setLoading(true);
    setFetchError(null);
    const effectivePage = pageOverride !== undefined ? pageOverride : page;
    const params = new URLSearchParams({
      page: effectivePage + 1,
      limit: rowsPerPage,
      sort: orderBy,
      order,
      search: searchTerm,
      deleted: viewMode === "trash" ? "true" : "false",
    });
    if (filterPropertyType) params.append("propertyType", filterPropertyType);
    if (filterListingType) params.append("listingType", filterListingType);
    if (filterVisibility) params.append("isHidden", filterVisibility);
    if (filterFeatured) params.append("isFeatured", filterFeatured);

    try {
      const response = await axios.get(
        `${API_BASE_URL}/admin/listings?${params.toString()}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      if (requestId !== latestRequestIdRef.current) return; // stale response - ignore
      setListings(response.data.listings || []);
      setTotalListings(response.data.totalListings || 0);
      setSelected([]);
    } catch (err) {
      if (requestId !== latestRequestIdRef.current) return; // stale error - ignore
      console.error("Error fetching listings:", err);
      setFetchError(
        err.response?.data?.message || "Failed to fetch listings."
      );
      setListings([]);
      setTotalListings(0);
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [
    idToken,
    page,
    rowsPerPage,
    orderBy,
    order,
    searchTerm,
    filterPropertyType,
    filterListingType,
    filterVisibility,
    filterFeatured,
    viewMode,
  ]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  const handleSelectAllClick = (event) => {
    if (event.target.checked) {
      const newSelecteds = listings.map((n) => n._id);
      setSelected(newSelecteds);
      return;
    }
    setSelected([]);
  };

  const handleRowClick = (event, id) => {
    const selectedIndex = selected.indexOf(id);
    let newSelected = [];
    if (selectedIndex === -1) newSelected = newSelected.concat(selected, id);
    else if (selectedIndex === 0)
      newSelected = newSelected.concat(selected.slice(1));
    else if (selectedIndex === selected.length - 1)
      newSelected = newSelected.concat(selected.slice(0, -1));
    else if (selectedIndex > 0)
      newSelected = newSelected.concat(
        selected.slice(0, selectedIndex),
        selected.slice(selectedIndex + 1)
      );
    setSelected(newSelected);
  };

  const isSelected = (id) => selected.indexOf(id) !== -1;

  const handleRequestSort = (event, property) => {
    const isAsc = orderBy === property && order === "asc";
    setOrder(isAsc ? "desc" : "asc");
    setOrderBy(property);
    setPage(0);
  };
  const handleChangePage = (e, newPage) => setPage(newPage);
  const handleChangeRowsPerPage = (e) => {
    setRowsPerPage(parseInt(e.target.value, 10));
    setPage(0);
  };

  const handleVisibilityToggle = useCallback(
    async (id, isHidden) => {
      if (!idToken) {
        showSnackbar("Authentication token missing.", "error");
        return;
      }
      const currentActionKey = `visibility-${id}`;
      setActionLoading((prev) => ({ ...prev, [currentActionKey]: true }));
      try {
        await axios.put(
          `${API_BASE_URL}/admin/listings/${id}/visibility`,
          { isHidden: !isHidden },
          { headers: { Authorization: `Bearer ${idToken}` } }
        );
        setListings((lst) =>
          lst.map((l) => (l._id === id ? { ...l, isHidden: !isHidden } : l))
        );
        showSnackbar(`Listing visibility updated successfully.`, "success");
      } catch (err) {
        console.error("Visibility toggle error:", err);
        showSnackbar(
          err.response?.data?.message || "Failed to update visibility.",
          "error"
        );
      } finally {
        setActionLoading((prev) => ({ ...prev, [currentActionKey]: false }));
      }
    },
    [idToken, showSnackbar, setListings, setActionLoading]
  );

  const handleFeatureToggle = useCallback(
    async (id, featuredAt) => {
      if (!idToken) {
        showSnackbar("Authentication token missing.", "error");
        return;
      }
      const isCurrentlyFeatured = featuredAt != null;
      const currentActionKey = `feature-${id}`;
      setActionLoading((prev) => ({ ...prev, [currentActionKey]: true }));
      try {
        const resp = await axios.put(
          `${API_BASE_URL}/admin/listings/${id}/feature`,
          { feature: !isCurrentlyFeatured },
          { headers: { Authorization: `Bearer ${idToken}` } }
        );
        setListings((lst) =>
          lst.map((l) =>
            l._id === id
              ? { ...l, featuredAt: resp.data.listing.featuredAt }
              : l
          )
        );
        showSnackbar(
          `Listing ${
            !isCurrentlyFeatured ? "featured" : "unfeatured"
          } successfully.`,
          "success"
        );
      } catch (err) {
        console.error("Feature toggle error:", err);
        showSnackbar(
          err.response?.data?.message || "Failed to update feature status.",
          "error"
        );
      } finally {
        setActionLoading((prev) => ({ ...prev, [currentActionKey]: false }));
      }
    },
    [idToken, showSnackbar, setListings, setActionLoading]
  );

  // Single-row restore (no confirmation - non-destructive, reversible by
  // deleting again)
  const handleRestoreSingle = useCallback(
    async (id) => {
      if (!idToken) {
        showSnackbar("Authentication token missing.", "error");
        return;
      }
      const currentActionKey = `restore-${id}`;
      setActionLoading((prev) => ({ ...prev, [currentActionKey]: true }));
      try {
        await axios.put(
          `${API_BASE_URL}/admin/listings/${id}/restore`,
          {},
          { headers: { Authorization: `Bearer ${idToken}` } }
        );
        setListings((prev) => prev.filter((l) => l._id !== id));
        setTotalListings((prev) => Math.max(0, prev - 1));
        showSnackbar("Listing restored successfully.", "success");
      } catch (err) {
        console.error("Restore error:", err);
        showSnackbar(
          err.response?.data?.message || "Failed to restore listing.",
          "error"
        );
      } finally {
        setActionLoading((prev) => ({ ...prev, [currentActionKey]: false }));
      }
    },
    [idToken, showSnackbar]
  );

  // --- Confirmation-gated actions: move to bin, permanent delete, empty bin ---

  const handleMoveSelectedToBin = () => {
    if (selected.length === 0 || !idToken) return;
    setConfirmAction({ type: "softDelete", ids: selected, context: "selected" });
  };

  const handlePermanentDeleteSelected = () => {
    if (selected.length === 0 || !idToken) return;
    setConfirmAction({
      type: "permanentDelete",
      ids: selected,
      context: "selected",
    });
  };

  const handlePermanentDeleteSingle = (id) => {
    if (!id || !idToken) return;
    setConfirmAction({
      type: "permanentDelete",
      ids: [id],
      context: "selected",
    });
  };

  // Empties the ENTIRE Recycle Bin server-side (every isDeleted:true listing,
  // across all pages) - no ID list is sent, so this isn't limited to what's
  // currently loaded on screen.
  const handleEmptyRecycleBin = () => {
    if (listings.length === 0 || !idToken) return;
    setConfirmAction({ type: "emptyBin" });
  };

  const closeConfirmDialog = () => {
    setConfirmAction(null);
  };

  const executeConfirmedAction = async () => {
    if (!confirmAction) return;
    setBulkActionLoading(true);
    try {
      if (confirmAction.type === "softDelete") {
        const response = await axios.post(
          `${API_BASE_URL}/admin/listings/delete-multiple`,
          { listingIds: confirmAction.ids },
          { headers: { Authorization: `Bearer ${idToken}` } }
        );
        showSnackbar(
          `${response.data.deletedCount} listing(s) moved to the Recycle Bin.`,
          "success"
        );
        await fetchListings();
      } else if (confirmAction.type === "permanentDelete") {
        const response = await axios.post(
          `${API_BASE_URL}/admin/listings/permanent-delete`,
          { listingIds: confirmAction.ids },
          { headers: { Authorization: `Bearer ${idToken}` } }
        );
        showSnackbar(
          `${response.data.deletedCount} listing(s) permanently deleted.`,
          "success"
        );
        await fetchListings();
      } else if (confirmAction.type === "emptyBin") {
        const response = await axios.post(
          `${API_BASE_URL}/admin/listings/empty-recycle-bin`,
          {},
          { headers: { Authorization: `Bearer ${idToken}` } }
        );
        showSnackbar(
          `${response.data.deletedCount} listing(s) permanently deleted.`,
          "success"
        );
        setPage(0);
        await fetchListings(0);
      }
      setSelected([]);
    } catch (err) {
      console.error("Error performing listing action:", err);
      showSnackbar(
        err.response?.data?.message || "Action failed.",
        "error"
      );
    } finally {
      setBulkActionLoading(false);
      setConfirmAction(null);
    }
  };

  return {
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
  };
};
