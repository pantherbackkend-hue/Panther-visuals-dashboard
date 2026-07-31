// Render notes stored as plain text into HTML.
//
// Notes continue to be stored in MongoDB as plain text, exactly as the user
// typed them. This helper is applied only at render time:
//   - all user text is HTML-escaped (prevents XSS)
//   - only detected http(s) URLs become <a> tags
//   - formatting (paragraphs, blank lines, line breaks) is preserved
//
// Views should output the result with the unescaped EJS tag: <%- renderNotes(x) %>

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

// `)` is excluded from the punctuation class so balanced parentheses inside
// URLs (e.g. Wikipedia links) survive; unbalanced ones are trimmed below.
const TRAILING_URL_PUNCTUATION = /[\]}>.,;:!?'"]+$/;

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Trim characters that are sentence punctuation rather than part of the URL,
// and drop unbalanced closing parentheses.
function cleanUrl(raw) {
  let url = raw.replace(TRAILING_URL_PUNCTUATION, "");
  while ((url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
    url = url.slice(0, -1);
  }
  return url;
}

export function linkifyUrls(text) {
  const source = String(text || "");
  const re = new RegExp(URL_PATTERN.source, URL_PATTERN.flags);
  let result = "";
  let lastIndex = 0;
  let match;

  while ((match = re.exec(source)) !== null) {
    const url = cleanUrl(match[0]);
    if (!url) {
      lastIndex = re.lastIndex;
      continue;
    }
    const start = match.index;
    result += escapeHtml(source.slice(lastIndex, start));
    result += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    lastIndex = start + url.length;
    re.lastIndex = lastIndex;
  }

  result += escapeHtml(source.slice(lastIndex));
  return result;
}

export function renderNotes(text) {
  return linkifyUrls(text);
}
