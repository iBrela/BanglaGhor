import React from "react";
import { Box } from "@mui/material";
import HeroSection from "./components/HeroSection";
import FeaturedProperties from "./components/FeaturedProperties";
import SupportingInfoCards from "./components/SupportingInfoCards";
import CallToAction from "./components/CallToAction";

// HomeSearchBar now renders from inside HeroSection itself (see
// HeroSection.js) so the search panel is genuinely part of the hero's
// centered column, not a separately-positioned sibling.
//
// QuickActions is intentionally NOT rendered here anymore - it duplicated
// the Buy/Rent/Sold tabs already prominent in the hero's own search panel.
// QuickActions.js itself is untouched and still exported normally in case
// it's needed again later.
//
// HomeMapPreview is intentionally NOT rendered here anymore - map discovery
// now lives behind the navbar's own "Map" link (-> the existing /map route,
// see Navbar.js/DesktopNav.js/MobileDrawer.js) and the "Explore areas and
// locations" supporting card below. HomeMapPreview.js itself is untouched
// and still exported normally in case it's needed again later.
const HomePage = () => {
  return (
    <Box>
      <HeroSection />
      <FeaturedProperties />
      <SupportingInfoCards />
      <CallToAction />
    </Box>
  );
};

export default HomePage;
