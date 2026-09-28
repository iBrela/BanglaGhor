// ============================================================================
// POI MARKER CONFIG — single source of truth for nearby-amenity marker
// icon + colour, shared by every map mode (individual chatbot "View on Map",
// "View all on map", the legend, and POI popups).
//
// Exactly the 16 categories PointOfInterest.CATEGORIES supports server-side
// (server/models/PointOfInterest.js) - no frontend-only category invented.
//
// Each category gets a stable colour AND a distinct icon glyph, so no two
// categories are distinguishable by colour alone (categories are never
// meant to be told apart by hue alone - see MapComponent's marker-image
// generation, which bakes both the colour and the glyph into one image).
// Colours deliberately avoid the basemap's own warm amber/orange road
// palette (see mapBasemapStyle.js / MapComponent's ROUTE_LINE_COLOR comment)
// so markers stay legible against roads, and avoid the exact property-pin
// colours (rent/buy/sold/selected, see propertyMarkerConfig.js) so a POI can
// never be mistaken for a property at a glance even before shape is considered.
//
// Icon glyphs are the *exact* path data @mui/icons-material already ships
// for these icons (read directly from node_modules - not hand-approximated),
// reused both as real MUI icon components for DOM/legend/popup UI AND as raw
// SVG path strings for the canvas-rasterized MapLibre marker images (see
// mapMarkerIcons.js) - no new icon library, no emoji, one shared source of
// truth for both renderings of the same glyph.
// ============================================================================

import LocalHospitalIcon from "@mui/icons-material/LocalHospital";
import MedicalServicesIcon from "@mui/icons-material/MedicalServices";
import LocalPharmacyIcon from "@mui/icons-material/LocalPharmacy";
import SchoolIcon from "@mui/icons-material/School";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import CastForEducationIcon from "@mui/icons-material/CastForEducation";
import ParkIcon from "@mui/icons-material/Park";
import StorefrontIcon from "@mui/icons-material/Storefront";
import ChurchIcon from "@mui/icons-material/Church";
import LocalPoliceIcon from "@mui/icons-material/LocalPolice";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import DirectionsBusIcon from "@mui/icons-material/DirectionsBus";
import TrainIcon from "@mui/icons-material/Train";
import DirectionsBoatIcon from "@mui/icons-material/DirectionsBoat";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import LocalAtmIcon from "@mui/icons-material/LocalAtm";

// 24x24 viewBox path data, copied verbatim from the corresponding
// @mui/icons-material/*.js source (node_modules) - some Material icons are
// drawn as two stacked <path> elements (fire station, college); those carry
// an array here instead of a single string, and every consumer that fills
// these paths onto canvas (mapMarkerIcons.js) fills each entry in the array.
export const POI_MARKER_CONFIG = {
  hospital: {
    labelKey: "poi_category_hospital",
    labelFallback: "Hospital",
    color: "#D32F2F",
    Icon: LocalHospitalIcon,
    pathD: "M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4z",
  },
  clinic: {
    labelKey: "poi_category_clinic",
    labelFallback: "Clinic",
    color: "#EC407A",
    Icon: MedicalServicesIcon,
    pathD: "M20 6h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2M10 4h4v2h-4zm6 11h-3v3h-2v-3H8v-2h3v-3h2v3h3z",
  },
  pharmacy: {
    labelKey: "poi_category_pharmacy",
    labelFallback: "Pharmacy",
    color: "#AB47BC",
    Icon: LocalPharmacyIcon,
    pathD: "M21 5h-2.64l1.14-3.14L17.15 1l-1.46 4H3v2l2 6-2 6v2h18v-2l-2-6 2-6zm-5 9h-3v3h-2v-3H8v-2h3V9h2v3h3z",
  },
  school: {
    labelKey: "poi_category_school",
    labelFallback: "School",
    color: "#1E88E5",
    Icon: SchoolIcon,
    pathD: "M5 13.18v4L12 21l7-3.82v-4L12 17zM12 3 1 9l11 6 9-4.91V17h2V9z",
  },
  college: {
    labelKey: "poi_category_college",
    labelFallback: "College",
    color: "#3949AB",
    Icon: MenuBookIcon,
    pathD: [
      "M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1m0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5z",
      "M17.5 10.5c.88 0 1.73.09 2.5.26V9.24c-.79-.15-1.64-.24-2.5-.24-1.7 0-3.24.29-4.5.83v1.66c1.13-.64 2.7-.99 4.5-.99M13 12.49v1.66c1.13-.64 2.7-.99 4.5-.99.88 0 1.73.09 2.5.26V11.9c-.79-.15-1.64-.24-2.5-.24-1.7 0-3.24.3-4.5.83m4.5 1.84c-1.7 0-3.24.29-4.5.83v1.66c1.13-.64 2.7-.99 4.5-.99.88 0 1.73.09 2.5.26v-1.52c-.79-.16-1.64-.24-2.5-.24",
    ],
  },
  university: {
    labelKey: "poi_category_university",
    labelFallback: "University",
    color: "#7B1FA2",
    Icon: CastForEducationIcon,
    pathD: "M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2M1 18v3h3c0-1.66-1.34-3-3-3m0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7m0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11m10 1.09v2L14.5 15l3.5-1.91v-2L14.5 13zM14.5 6 9 9l5.5 3L20 9z",
  },
  park: {
    labelKey: "poi_category_park",
    labelFallback: "Park",
    color: "#43A047",
    Icon: ParkIcon,
    pathD: "M17 12h2L12 2 5.05 12H7l-3.9 6h6.92v4h3.96v-4H21z",
  },
  marketplace: {
    labelKey: "poi_category_marketplace",
    labelFallback: "Marketplace",
    color: "#6D4C41",
    Icon: StorefrontIcon,
    pathD:
      "m21.9 8.89-1.05-4.37c-.22-.9-1-1.52-1.91-1.52H5.05c-.9 0-1.69.63-1.9 1.52L2.1 8.89c-.24 1.02-.02 2.06.62 2.88.08.11.19.19.28.29V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-6.94c.09-.09.2-.18.28-.28.64-.82.87-1.87.62-2.89m-2.99-3.9 1.05 4.37c.1.42.01.84-.25 1.17-.14.18-.44.47-.94.47-.61 0-1.14-.49-1.21-1.14L16.98 5zM13 5h1.96l.54 4.52c.05.39-.07.78-.33 1.07-.22.26-.54.41-.95.41-.67 0-1.22-.59-1.22-1.31zM8.49 9.52 9.04 5H11v4.69c0 .72-.55 1.31-1.29 1.31-.34 0-.65-.15-.89-.41-.25-.29-.37-.68-.33-1.07m-4.45-.16L5.05 5h1.97l-.58 4.86c-.08.65-.6 1.14-1.21 1.14-.49 0-.8-.29-.93-.47-.27-.32-.36-.75-.26-1.17M5 19v-6.03c.08.01.15.03.23.03.87 0 1.66-.36 2.24-.95.6.6 1.4.95 2.31.95.87 0 1.65-.36 2.23-.93.59.57 1.39.93 2.29.93.84 0 1.64-.35 2.24-.95.58.59 1.37.95 2.24.95.08 0 .15-.02.23-.03V19z",
  },
  place_of_worship: {
    labelKey: "poi_category_place_of_worship",
    labelFallback: "Place of Worship",
    color: "#607D8B",
    Icon: ChurchIcon,
    pathD: "M18 12.22V9l-5-2.5V5h2V3h-2V1h-2v2H9v2h2v1.5L6 9v3.22L2 14v8h8v-3c0-1.1.9-2 2-2s2 .9 2 2v3h8v-8zm-6 1.28c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5",
  },
  police: {
    labelKey: "poi_category_police",
    labelFallback: "Police",
    color: "#283593",
    Icon: LocalPoliceIcon,
    pathD: "M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5zm2.5 11.59.9 3.88-3.4-2.05-3.4 2.05.9-3.87-3-2.59 3.96-.34L12 6.02l1.54 3.64 3.96.34z",
  },
  fire_station: {
    labelKey: "poi_category_fire_station",
    labelFallback: "Fire Station",
    color: "#BF360C",
    Icon: LocalFireDepartmentIcon,
    pathD: [
      "m12 12.9-2.13 2.09c-.56.56-.87 1.29-.87 2.07C9 18.68 10.35 20 12 20s3-1.32 3-2.94c0-.78-.31-1.52-.87-2.07z",
      "m16 6-.44.55C14.38 8.02 12 7.19 12 5.3V2S4 6 4 13c0 2.92 1.56 5.47 3.89 6.86-.56-.79-.89-1.76-.89-2.8 0-1.32.52-2.56 1.47-3.5L12 10.1l3.53 3.47c.95.93 1.47 2.17 1.47 3.5 0 1.02-.31 1.96-.85 2.75 1.89-1.15 3.29-3.06 3.71-5.3.66-3.55-1.07-6.9-3.86-8.52",
    ],
  },
  bus_station: {
    labelKey: "poi_category_bus_station",
    labelFallback: "Bus Station",
    color: "#00838F",
    Icon: DirectionsBusIcon,
    pathD: "M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17m9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5m1.5-6H6V6h12z",
  },
  railway_station: {
    labelKey: "poi_category_railway_station",
    labelFallback: "Railway Station",
    color: "#37474F",
    Icon: TrainIcon,
    pathD: "M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4M7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17m3.5-7H6V6h5zm2 0V6h5v4zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5",
  },
  ferry_terminal: {
    labelKey: "poi_category_ferry_terminal",
    labelFallback: "Ferry Terminal",
    color: "#01579B",
    Icon: DirectionsBoatIcon,
    pathD:
      "M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78zM6 6h12v3.97L12 8 6 9.97z",
  },
  bank: {
    labelKey: "poi_category_bank",
    labelFallback: "Bank",
    color: "#00695C",
    Icon: AccountBalanceIcon,
    pathD: "M4 10h3v7H4zm6.5 0h3v7h-3zM2 19h20v3H2zm15-9h3v7h-3zm-5-9L2 6v2h20V6z",
  },
  atm: {
    labelKey: "poi_category_atm",
    labelFallback: "ATM",
    color: "#00897B",
    Icon: LocalAtmIcon,
    pathD: "M11 17h2v-1h1c.55 0 1-.45 1-1v-3c0-.55-.45-1-1-1h-3v-1h4V8h-2V7h-2v1h-1c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1h3v1H9v2h2zm9-13H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2m0 14H4V6h16z",
  },
};

export const POI_CATEGORY_ORDER = [
  "school",
  "college",
  "university",
  "hospital",
  "clinic",
  "pharmacy",
  "park",
  "marketplace",
  "place_of_worship",
  "police",
  "fire_station",
  "bus_station",
  "railway_station",
  "ferry_terminal",
  "bank",
  "atm",
];

export function getPoiMarkerConfig(category) {
  return POI_MARKER_CONFIG[category] || null;
}
