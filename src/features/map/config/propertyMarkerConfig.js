// ============================================================================
// PROPERTY MARKER CONFIG — single source of truth for Buy/Rent/Sold marker
// colour across every map mode (normal /map browsing, chatbot individual
// "View on Map", chatbot "View all on map"). Every consumer (MapComponent,
// MapLegend) reads from here rather than hardcoding its own colour, so the
// three listing-type colours can never drift apart between modes.
//
// Colours match the convention already used for the Rent/For Sale/Sold
// chips elsewhere in the app (see PropertyInfoPanel.js's own RENT_COLOR/
// BUY_COLOR/SOLD_COLOR, which this simply centralizes) - not invented here.
// ============================================================================

export const SELECTED_PROPERTY_COLOR = "#E91E63";

export const PROPERTY_MARKER_CONFIG = {
  rent: {
    key: "rent",
    labelKey: "nav_rent",
    labelFallback: "Rent",
    color: "#0288D1", // MUI info.main
    icon: "pin-rent",
  },
  buy: {
    key: "buy",
    labelKey: "nav_buy",
    labelFallback: "Buy",
    color: "#2E7D32", // MUI success.main
    icon: "pin-buy",
  },
  sold: {
    key: "sold",
    labelKey: "nav_sold",
    labelFallback: "Sold",
    color: "#757575", // MUI grey (default)
    icon: "pin-sold",
  },
};

export const PROPERTY_MARKER_ORDER = ["buy", "rent", "sold"];

export function getPropertyMarkerConfig(listingType) {
  return PROPERTY_MARKER_CONFIG[listingType] || PROPERTY_MARKER_CONFIG.buy;
}
