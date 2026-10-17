// Merge findings from every tier into one deduplicated, ranked list.

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
export const CATEGORIES = ['bug', 'security', 'latency', 'maintainability'];
const RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));
const LINE_WINDOW = 3;

function cleanPath(p) {
  return String(p ?? '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/');
}

export function normalizeFinding(raw) {
  const severity = String(raw.severity ?? '').toUpperCase();
  const category = String(raw.category ?? '').toLowerCase();
  const evidence = String(raw.evidence ?? '').trim();
  const file = cleanPath(raw.file);
  if (!SEVERITIES.includes(severity)) throw new Error(`invalid severity "${raw.severity}" for ${file}`);
  if (!CATEGORIES.includes(category)) throw new Error(`invalid category "${raw.category}" for ${file}`);
  if (!file) throw new Error('finding has no file');
  if (!evidence) throw new Error(`finding at ${file}:${raw.line} has no evidence`);
  const line = Number.isInteger(raw.line) ? raw.line : Number.parseInt(raw.line, 10) || 0;
  return {
    file, line, category, severity, evidence,
    title: String(raw.title ?? '').trim() || '(untitled)',
    rationale: String(raw.rationale ?? '').trim(),
    confidence: raw.confidence ? String(raw.confidence).toUpperCase() : null,
    cwe: raw.cwe ?? null,
    externalId: raw.externalId ?? null,
    source: String(raw.source ?? 'unknown'),
  };
}

export function fromClaudeSecurity(rec) {
  return normalizeFinding({
    file: rec.file,
    line: rec.line,
    category: 'security',
    severity: rec.severity,
    title: rec.title,
    evidence: rec.evidence || rec.snippet || rec.rationale,
    rationale: [rec.rationale, rec.impact, rec.exploitScenario].filter(Boolean).join(' '),
    confidence: rec.confidence,
    cwe: rec.cweId ?? null,
    externalId: rec.claudeSecurityPluginFindingId ?? null,
    source: 'tier3:claude-security',
  });
}

function sameIssue(a, b) {
  return a.file === b.file && a.category === b.category && Math.abs(a.line - b.line) <= LINE_WINDOW;
}

function merge(a, b) {
  const keep = RANK[b.severity] < RANK[a.severity] ? b : a;
  const other = keep === a ? b : a;
  return {
    ...keep,
    sources: [...new Set([...(a.sources ?? [a.source]), ...(b.sources ?? [b.source])])],
    evidence: keep.evidence.includes(other.evidence) ? keep.evidence : `${keep.evidence}\n---\n${other.evidence}`,
    cwe: keep.cwe ?? other.cwe,
    externalId: keep.externalId ?? other.externalId,
  };
}

export function consolidate(rawFindings) {
  const merged = [];
  for (const raw of rawFindings) {
    const n = { ...normalizeFinding(raw) };
    const idx = merged.findIndex((m) => sameIssue(m, n));
    if (idx === -1) merged.push({ ...n, sources: [n.source] });
    else merged[idx] = merge(merged[idx], n);
  }
  const sorted = [...merged].sort((a, b) =>
    RANK[a.severity] - RANK[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
  return sorted.map((m, i) => {
    const { source, ...rest } = m;
    return { id: `HS-${String(i + 1).padStart(3, '0')}`, ...rest };
  });
}

export function countBySeverity(findings) {
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    byCategory[f.category] += 1;
  }
  return { total: findings.length, bySeverity, byCategory };
}
