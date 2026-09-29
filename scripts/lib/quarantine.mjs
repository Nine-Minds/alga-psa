/**
 * Owned, expiring quarantine for a mandatory readiness requirement (F009).
 *
 * A quarantined requirement still executes, still produces its verdict and is
 * still reported; it simply does not veto readiness while its entry is valid.
 * Everything that could turn that into a silent hole is a hard failure instead:
 * a missing owner or reason, an absent or malformed expiry, an expiry that has
 * passed, an entry naming an unknown requirement, a duplicate entry, and any
 * attempt to quarantine a P0 customer journey.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseExpiry(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return parsed;
}

export function resolveQuarantine({ registry, requirements, now }) {
  const failures = [];
  const entries = new Map();
  if (!registry || registry.schemaVersion !== 1 || !Array.isArray(registry.entries)) {
    return { entries, failures: ['Quarantine registry is missing or unsupported'] };
  }
  const today = parseExpiry(now) ?? (now instanceof Date ? now : null);
  if (!today) return { entries, failures: ['Quarantine evaluation date is invalid'] };
  const known = new Map(requirements.map(requirement => [requirement.artifact, requirement]));
  for (const entry of registry.entries) {
    const artifact = entry?.artifact;
    const label = typeof artifact === 'string' && artifact ? artifact : '(unnamed)';
    const requirement = known.get(artifact);
    if (!requirement) { failures.push(`Quarantine names an unknown requirement: ${label}`); continue; }
    if (entries.has(artifact)) { failures.push(`Duplicate quarantine entry: ${label}`); continue; }
    const problems = [];
    if (typeof entry.owner !== 'string' || !entry.owner.trim()) problems.push('owner');
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) problems.push('reason');
    const expires = parseExpiry(entry.expires);
    if (!expires) problems.push('expiry');
    if (problems.length) { failures.push(`Quarantine entry is missing ${problems.join(', ')}: ${label}`); continue; }
    if (requirement.p0Journey) { failures.push(`P0 journey cannot be quarantined: ${label}`); continue; }
    if (expires <= today) { failures.push(`Quarantine expired on ${entry.expires}: ${label}`); continue; }
    entries.set(artifact, { owner: entry.owner.trim(), reason: entry.reason.trim(), expires: entry.expires,
      tracking: typeof entry.tracking === 'string' ? entry.tracking : undefined });
  }
  return { entries, failures };
}
