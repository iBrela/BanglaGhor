// ============================================================================
// PRICE PARSER — deterministic Bangladeshi price-word normalization
// ============================================================================
// A small, pure, side-effect-free helper extracted out of intentService.js's
// prompt-only approach: the LLM already converts price words in most cases,
// but "harden price parsing" per the chatbot audit means having a real,
// independently testable deterministic function too - not just trusting a
// probabilistic model's arithmetic. Used two ways:
//   1. server/tests/priceParser.test.js exercises this directly with real
//      assertions (deterministic, no Groq call needed).
//   2. intentService.js can optionally cross-check the LLM's own maxPrice/
//      minPrice against this parser's own read of the raw message (see
//      crossCheckPrice below) - informational only, never silently
//      overrides the LLM's extraction (which has real contextual advantages
//      a regex can't have, e.g. telling "budget" apart from "bedroom
//      count"), just logs a warning if they disagree so a real mismatch is
//      visible in development, not silently wrong.
// ============================================================================

// Bangladeshi numbering-system multipliers. Order matters for regex
// alternation (longest/most-specific match first) - "crore"/"কোটি" must be
// checked before "core" typos etc. never occur here since we match on exact
// tokens, but keeping the biggest units first is still the safer habit.
const UNIT_MULTIPLIERS = [
  { pattern: /crore|কোটি/i, multiplier: 10000000 },
  { pattern: /lakh|lac|lacs|লাখ|লাক্ষ/i, multiplier: 100000 },
  { pattern: /hazar|hajar|thousand|হাজার/i, multiplier: 1000 },
  { pattern: /\bk\b/i, multiplier: 1000 },
];

// Bangla digits (০-৯) -> ASCII digits, so "৫০,০০০" parses the same as
// "50,000". Real Bangla numerals a user might actually type, not a
// hypothetical - the SYSTEM_PROMPT's own examples already show them.
const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";
function banglaDigitsToAscii(str) {
  return str.replace(/[০-৯]/g, (ch) => String(BANGLA_DIGITS.indexOf(ch)));
}

// Matches a number (with optional Bangla digits, commas, decimals) followed
// by an optional unit word, and an optional currency symbol/word before or
// after - e.g. "40 lakh", "৪০ লাখ", "৳50,000", "50k", "1 crore", "60
// thousand". Intentionally permissive on whitespace/punctuation between the
// number and the unit since real messages are inconsistent about it.
const PRICE_TOKEN_REGEX =
  /(?:৳\s*)?([0-9০-৯][0-9০-৯,.]*)\s*(crore|কোটি|lakh|lac|lacs|লাখ|লাক্ষ|hazar|hajar|thousand|হাজার|k\b)?/gi;

/**
 * Extract every price-like number mentioned in a message, normalized to a
 * plain BDT numeric value. Returns an array (a message can mention more than
 * one price, e.g. "between 30 and 40 lakh") - callers decide which one (if
 * any) is the min/max they care about; this function only does the
 * unit-word -> number conversion, never guesses intent.
 *
 * @param {string} text
 * @returns {number[]}
 */
function extractPriceMentions(text) {
  if (!text || typeof text !== "string") return [];

  const results = [];
  const normalized = banglaDigitsToAscii(text);
  let match;
  PRICE_TOKEN_REGEX.lastIndex = 0;
  while ((match = PRICE_TOKEN_REGEX.exec(normalized)) !== null) {
    const rawNumber = match[1];
    const unitWord = match[2];
    if (!rawNumber) continue;

    const cleaned = rawNumber.replace(/,/g, "");
    const base = parseFloat(cleaned);
    if (!Number.isFinite(base) || base <= 0) continue;

    let multiplier = 1;
    if (unitWord) {
      const unitMatch = UNIT_MULTIPLIERS.find((u) => u.pattern.test(unitWord));
      if (unitMatch) multiplier = unitMatch.multiplier;
    }

    // A bare small number with no unit word and no currency symbol (e.g.
    // "3" from "3 bedroom") is almost never a real price mention on its
    // own - only keep unitless numbers when they're already large enough to
    // plausibly be a raw BDT amount (avoids false positives like bedroom/
    // bathroom counts). Numbers with an explicit unit word or ৳ symbol are
    // always kept regardless of size.
    const hasCurrencyContext = unitWord || /৳/.test(match[0]);
    if (!hasCurrencyContext && base < 1000) continue;

    results.push(Math.round(base * multiplier));
  }

  return results;
}

/**
 * Distinguishes a rental (monthly) price mention from a purchase price using
 * the same listing-type signal intentService.js's own prompt already keys
 * off ("rent"/"ভাড়া"/"vara"/"monthly" vs "buy"/"kinbo"/"কিনব"/"purchase"/
 * "sale"). Never invents a listing type from the price alone - if the
 * message gives no rent/buy signal, returns null (caller should defer to
 * whatever the LLM's own intent.filters.listingType already said).
 *
 * @param {string} text
 * @returns {"rent" | "buy" | null}
 */
function inferListingTypeFromText(text) {
  if (!text || typeof text !== "string") return null;
  const lower = text.toLowerCase();
  const rentSignal = /rent|ভাড়া|vara|monthly|\/mo\b/i.test(lower);
  const buySignal = /\bbuy\b|kinbo|কিনব|purchase|\bsale\b/i.test(lower);
  if (rentSignal && !buySignal) return "rent";
  if (buySignal && !rentSignal) return "buy";
  return null; // ambiguous or unstated - not this function's call to make
}

/**
 * Cross-checks the LLM-extracted min/max price against this deterministic
 * parser's own read of the raw message. Never overrides the LLM's value -
 * only returns a warning string (or null when they agree / there's nothing
 * to compare) so a real disagreement is visible in server logs during
 * development rather than silently trusted either way.
 *
 * @param {string} rawMessage
 * @param {{minPrice: number|null, maxPrice: number|null}} extractedFilters
 * @returns {string | null}
 */
function crossCheckPrice(rawMessage, extractedFilters) {
  const mentions = extractPriceMentions(rawMessage);
  if (mentions.length === 0) return null;

  const llmPrice = extractedFilters?.maxPrice ?? extractedFilters?.minPrice ?? null;
  if (llmPrice === null) {
    return `Price parser found ${JSON.stringify(mentions)} in the message but the LLM extracted no min/max price.`;
  }
  const closeEnough = mentions.some((m) => Math.abs(m - llmPrice) / Math.max(m, llmPrice) < 0.02);
  if (!closeEnough) {
    return `Price parser found ${JSON.stringify(mentions)} but LLM extracted ${llmPrice} - possible mismatch.`;
  }
  return null;
}

module.exports = {
  extractPriceMentions,
  inferListingTypeFromText,
  crossCheckPrice,
};
