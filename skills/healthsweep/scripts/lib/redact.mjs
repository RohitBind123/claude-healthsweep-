// Best-effort secret redaction for everything healthsweep writes to disk or commits.
// Findings quote code verbatim, and a finding about a hard-coded key would otherwise copy the key
// into REPORT.md and into HEALTHSWEEP_LOG.md, which is committed. This is a safety net, not a guarantee.

const MARK = '[REDACTED]';

const TOKENS = [
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
];

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
// key = "value" / key: 'value' / KEY=value for secret-looking key names.
const ASSIGNED = /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth)[A-Za-z0-9_.-]*)(\s*[:=]\s*)(["']?)([^\s"'`,;]{6,})\3/gi;
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)([^@\s/]+)(@)/gi;

export function redactSecrets(text, extraValues = []) {
  let t = String(text ?? '');
  t = t.replace(PRIVATE_KEY, '[REDACTED PRIVATE KEY]');
  for (const re of TOKENS) t = t.replace(re, MARK);
  t = t.replace(URL_PASSWORD, `$1${MARK}$3`);
  t = t.replace(ASSIGNED, (m, key, sep, q, val) => (val === MARK ? m : `${key}${sep}${q}${MARK}${q}`));
  for (const v of extraValues) {
    if (typeof v === 'string' && v.length >= 6) t = t.split(v).join(MARK);
  }
  return t;
}
