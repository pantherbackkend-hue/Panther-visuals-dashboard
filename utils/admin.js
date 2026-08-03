const IST_OFFSET_MINUTES = 330;

function toIstDateParts(date = new Date()) {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
  const istMs = utcMs + IST_OFFSET_MINUTES * 60000;
  const ist = new Date(istMs);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth(), day: ist.getUTCDate(), hour: ist.getUTCHours(), minute: ist.getUTCMinutes(), second: ist.getUTCSeconds() };
}

function fromIstParts(parts) {
  const utcMs = Date.UTC(parts.year, parts.month, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0, parts.millisecond || 0);
  return new Date(utcMs - IST_OFFSET_MINUTES * 60000);
}

export function startOfIstDay(date = new Date()) {
  const parts = toIstDateParts(date);
  return fromIstParts({ year: parts.year, month: parts.month, day: parts.day });
}

export function normalizeQuery(value) {
  return String(value || "").trim();
}

const PROJECT_TYPES = ["Short", "Long"];

/**
 * Normalizes a project type value to "Short" or "Long".
 * Invalid/missing values gracefully default to "Short".
 * @param {string} value - The value to normalize
 * @returns {string} - "Short" or "Long"
 */
export function normalizeProjectType(value) {
  return PROJECT_TYPES.includes(String(value || "").trim()) ? String(value).trim() : "Short";
}

/**
 * Normalizes a specialization or field value to a consistent format.
 * - Trims whitespace
 * - Collapses multiple spaces to single space
 * - Converts to Title Case for consistent display
 * - Handles common abbreviations (AI, VR, AR, UI, UX, ML)
 * @param {string} value - The value to normalize
 * @returns {string} - The normalized value
 */
export function normalizeField(value) {
  if (!value || typeof value !== "string") return "";

  // Step 1: Trim and collapse multiple spaces
  const trimmed = value.trim().replace(/\s+/g, " ");

  if (trimmed === "") return "";

  // Step 2: Convert to Title Case, preserving certain abbreviations
  const abbreviations = ["ai", "vr", "ar", "ui", "ux", "ml", "3d", "2d", "4k", "hd", "sd", "vfx", "cgi"];

  return trimmed
    .toLowerCase()
    .split(" ")
    .map((word) => {
      if (abbreviations.includes(word.toLowerCase())) {
        return word.toUpperCase();
      }
      // Handle hyphenated words (e.g., "long-form" -> "Long-Form")
      if (word.includes("-")) {
        return word
          .split("-")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
          .join("-");
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}


