// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const importActions = readFileSync(resolve(__dirname, 'ticketImportActions.ts'), 'utf8');

/**
 * Replaces the old batch-UPDATE tenant-facade contract: the import no longer
 * rewrites entered_at / closed_* with raw UPDATE batches. TicketModel owns
 * historical creation through the `historical` input.
 */
describe('ticket CSV import historical creation contract', () => {
  it('hands entered_at / closed_* to TicketModel.createTicket via historical', () => {
    expect(importActions).toMatch(/historical: isClosed[\s\S]{0,400}closed_by: user\.user_id/);
    expect(importActions).toMatch(/: ticket\.entered_at\s*\? \{ entered_at: ticket\.entered_at \}/);
    expect(importActions).toMatch(/TicketModel\.createTicket\([\s\S]{0,400}silentTicketCreation\('[^']+'\)/);
  });

  it('has no raw post-creation UPDATE of tickets', () => {
    expect(importActions).not.toMatch(/UPDATE\s+tickets/i);
    expect(importActions).not.toContain('enteredAtUpdates');
    expect(importActions).not.toContain('tenantScopedTicketBatchUpdateScopeSql');
  });

  it('still records the close-rules bypass for imported-closed tickets', () => {
    expect(importActions).toMatch(/CLOSE_RULES_BYPASSED[\s\S]{0,300}bypass_source: 'import'/);
  });
});
