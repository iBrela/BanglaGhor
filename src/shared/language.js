// ============================================================================
// Shared language normalization — the browser's detected language can be a
// full locale tag (e.g. "en-US", "en-GB", "bn-BD") rather than the bare
// "en"/"bn" resource keys this app registers (see src/i18n/i18n.js). Any
// code comparing i18n.language against an exact "en"/"bn" string can
// silently misbehave for locale variants it wasn't written to expect - use
// this helper instead of a raw === check wherever that distinction matters
// (language toggle, TTS language selection, bilingual content selection).
// ============================================================================

// Normalizes any BCP-47-ish language tag down to this app's two supported
// base languages. Defaults to "en" for anything that isn't Bangla, matching
// i18n.js's own fallbackLng: "en".
export function normalizeLang(lang) {
  const resolved = (lang || "en").toLowerCase();
  return resolved.startsWith("bn") ? "bn" : "en";
}
