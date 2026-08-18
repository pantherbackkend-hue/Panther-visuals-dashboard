// Minimal http(s) URL check — no provider logic; the link is stored as entered.
// Returns an error message, or "" when valid.
export function validateUrl(value) {
  const raw = (value || "").trim();
  if (!raw) return "Tutorial link is required.";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Use an http(s) URL.";
  } catch {
    return "Enter a valid URL.";
  }
  return "";
}