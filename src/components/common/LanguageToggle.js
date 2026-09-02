import React from "react";
import { useTranslation } from "react-i18next";
import { Box, Button } from "@mui/material";
import { normalizeLang } from "../../shared/language";

const LanguageToggle = () => {
  const { i18n } = useTranslation();
  const currentLang = normalizeLang(i18n.resolvedLanguage || i18n.language);

  const handleToggle = () => {
    const newLang = currentLang === "en" ? "bn" : "en";
    i18n.changeLanguage(newLang);
  };

  const getLabel = () => {
    return currentLang === "en" ? "বাংলা" : "English";
  };

  return (
    <Box>
      <Button
        onClick={handleToggle}
        sx={{
          textTransform: "none",
          color: "text.primary",
          fontWeight: 600,
        }}
      >
        {getLabel()}
      </Button>
    </Box>
  );
};

export default LanguageToggle;
