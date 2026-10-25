import type { AlgaProfileState, ImportInputRow } from './stripeImportClassifier';

/** A row as typed or uploaded by the operator: client / profile may be names or ids. */
export interface RawImportRow {
  client: string;
  profile?: string;
  customerId: string;
  source?: 'mapping' | 'assisted';
}

/** Parses `client,profile,customer_id` CSV (profile optional; header optional). Quotes are honoured. */
export function parseImportCsv(text: string): RawImportRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const split = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted;
      } else if (ch === ',' && !quoted) { cells.push(current.trim()); current = ''; } else current += ch;
    }
    cells.push(current.trim());
    return cells;
  };
  const rows = lines.map(split);
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.toLowerCase().replace(/[\s-]+/g, '_'));
  const hasHeader = header.includes('customer_id') || header.includes('customer');
  const col = (names: string[], fallback: number) => {
    const idx = hasHeader ? header.findIndex((cell) => names.includes(cell)) : fallback;
    return idx;
  };
  const clientCol = col(['client', 'client_name', 'client_id'], 0);
  const profileCol = hasHeader ? col(['profile', 'billing_profile', 'billing_profile_name', 'billing_profile_id'], -1) : (rows[0].length >= 3 ? 1 : -1);
  const customerCol = hasHeader ? col(['customer_id', 'customer'], -1) : (rows[0].length >= 3 ? 2 : 1);
  return rows.slice(hasHeader ? 1 : 0).map((cells) => ({
    client: cells[clientCol] ?? '',
    profile: profileCol >= 0 ? cells[profileCol] || undefined : undefined,
    customerId: cells[customerCol] ?? '',
    source: 'mapping' as const,
  }));
}

/**
 * Turns names/ids into the ids the classifier takes. Resolution only: it makes no import decisions.
 * Anything not resolved unambiguously gets empty ids, which the classifier reports as `profile-not-found`.
 * A client without a profile column resolves to its default (first active) profile only when it has exactly one.
 */
export function resolveImportRows(raw: RawImportRow[], profiles: AlgaProfileState[]): ImportInputRow[] {
  const norm = (value: string) => value.trim().toLowerCase();
  return raw.map((row, index) => {
    const rowId = `row-${index}`;
    const clientMatches = profiles.filter((p) => p.clientId === row.client.trim() || norm(p.clientName) === norm(row.client));
    const clientIds = [...new Set(clientMatches.map((p) => p.clientId))];
    let match: AlgaProfileState | undefined;
    if (clientIds.length === 1) {
      const candidates = clientMatches.filter((p) => p.isActive);
      if (row.profile) {
        const byProfile = candidates.filter((p) => p.billingProfileId === row.profile!.trim() || norm(p.profileName) === norm(row.profile!));
        match = byProfile.length === 1 ? byProfile[0] : undefined;
      } else {
        match = candidates.length === 1 ? candidates[0] : undefined;
      }
    }
    return { rowId, clientId: match?.clientId ?? '', billingProfileId: match?.billingProfileId ?? '', customerId: row.customerId.trim(), source: row.source ?? 'mapping' };
  });
}
