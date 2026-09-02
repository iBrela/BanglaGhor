// ============================================================================
// Shared property-description selection — picks the right language version
// of a property's description with a fallback chain, so a property that
// doesn't have both bilingual fields yet (older records, or a translation
// that failed at creation time) never shows a blank description.
//
// This is a pure field-selection operation: no AI or translation call ever
// happens here. Language toggle should be instant.
// ============================================================================

// language: the current i18n.language value ("en" or "bn").
export function getDisplayDescription(property, language) {
  if (!property) return "";

  if (language === "bn") {
    return (
      property.description_bn ||
      property.description_en ||
      property.description ||
      ""
    );
  }

  return (
    property.description_en ||
    property.description ||
    property.description_bn ||
    ""
  );
}
