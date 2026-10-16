import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every production site that writes tickets.status_id / board_id must go
 * through publishTicketTransitionsAfterCommit (or be an explicit, justified
 * exception). A new write site that skips the helper fails this test.
 */
const repoRoot = path.resolve(__dirname, '../../../..');
const ROOTS = ['packages', 'shared', 'server/src', 'ee/packages'];
const HELPER = 'publishTicketTransitionsAfterCommit';

// Files that write ticket status but are intentionally exempt.
const EXEMPT: Record<string, string> = {
  'shared/lib/tickets/ticketLifecycleEvents.ts': 'the engine itself',
  'shared/models/ticketModel.ts': 'creation writes the initial status; updateTicket callers publish transitions',
  'packages/tickets/src/actions/ticketImportActions.ts': 'bulk import is silent by design (silentTicketCreation)',
  'server/src/lib/migrations/appliers/entityAppliers.ts': 'data migration is silent by design (silentTicketCreation)',
};

function walk(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.|\.d\.ts$/.test(entry.name)) out.push(full);
  }
}

// `.update({ ... status_id ... })` / updateTicket(...) on a tickets table.
const TICKET_STATUS_WRITE =
  /(table\(\s*['"]tickets['"]\s*\)|tenantScopedTable\([^)]*['"]tickets['"][^)]*\))[\s\S]{0,400}?\.update\(\s*\{[^}]*\b(status_id|board_id)\b/;
const MODEL_UPDATE = /TicketModel\.updateTicket\(/;

describe('ticket status write sites publish lifecycle transitions', () => {
  it('every status/board write site uses publishTicketTransitionsAfterCommit', () => {
    const files: string[] = [];
    for (const r of ROOTS) walk(path.join(repoRoot, r), files);

    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(repoRoot, file);
      if (EXEMPT[rel]) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (!TICKET_STATUS_WRITE.test(src) && !MODEL_UPDATE.test(src)) continue;
      if (!src.includes(HELPER)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
