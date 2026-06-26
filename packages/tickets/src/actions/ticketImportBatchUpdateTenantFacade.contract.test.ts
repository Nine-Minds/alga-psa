// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const importActions = readFileSync(resolve(__dirname, 'ticketImportActions.ts'), 'utf8');

describe('ticket import batch update tenant facade contract', () => {
  it('routes raw batch update ticket scope through the tenant facade', () => {
    const helperStart = importActions.indexOf('function tenantScopedTicketBatchUpdateScopeSql');
    const batchStart = importActions.indexOf('// Batch post-creation updates');
    const batchEnd = importActions.indexOf('// Imported-closed tickets', batchStart);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(batchStart).toBeGreaterThanOrEqual(0);
    expect(batchEnd).toBeGreaterThan(batchStart);

    const helperSection = importActions.slice(helperStart, batchStart);
    const batchSection = importActions.slice(batchStart, batchEnd);

    expect(helperSection).toMatch(/tenantDb\(conn, tenant\)\s*\.table\('tickets'\)/);
    expect(batchSection).toContain('tenantScopedTicketBatchUpdateScopeSql(trx, tenant, batch.map((u) => u.ticket_id))');
    expect(batchSection).toContain('FROM ${ticketScope.sql}');
    expect(batchSection).toContain('JOIN (VALUES ${values}) AS v');
    expect(batchSection).toContain('target.tenant = scoped_tickets.tenant');
    expect(batchSection).not.toMatch(/UPDATE\s+tickets\s+t\b[\s\S]*?t\.tenant\s*=\s*\?/i);
    expect(batchSection).not.toContain('WHERE t.ticket_id = v.tid AND t.tenant = ?');
  });
});
