// Markdown-safe rendering of text that came from agents or the repository.

// One line, no heading/list injection, pipes escaped for tables.
export function mdInline(text, max = 300) {
  const t = String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// Content for a `code span`: backticks and newlines cannot break out of it.
export function mdCode(text) {
  return String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/`/g, "'");
}

// Repository-relative path rule shared by findings and --files.
export function isSafeRelPath(p) {
  const s = String(p ?? '');
  if (!s || s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s) || s.includes('\0')) return false;
  return !s.split(/[\\/]/).includes('..');
}
