import { describe, expect, it } from 'vitest';
import { ticketSummaryCandidates, visibleCoManagedFields } from '../sharedWorkRead';

const row = { ticket_number: 'T-1', title: 'Printer', board_id: 'b1', board_name: 'Service Desk', status_id: 's1', status_name: 'Open',
  is_closed: false, priority_id: 'p1', priority_name: 'High', entered_at: new Date('2026-10-01T00:00:00Z'), updated_at: null, closed_at: null };
const candidates = ticketSummaryCandidates('00000000-0000-4000-8000-000000000001', row);

describe('shared work field redaction', () => {
  it('without redactions returns the allowlist, omitting empty values (no placeholder nulls)', () => {
    const fields = visibleCoManagedFields(candidates, []);
    expect(fields.status).toMatchObject({ kind: 'status', name: 'Open' });
    expect(Object.keys(fields)).not.toContain('closed_at');
    expect(Object.values(fields)).not.toContain(null);
  });

  it('a hidden status_id also removes the derived status.name and is_closed', () => {
    const fields = visibleCoManagedFields(candidates, ['status_id']);
    expect(fields).not.toHaveProperty('status');
    expect(fields).not.toHaveProperty('is_closed');
    expect(JSON.stringify(fields)).not.toContain('Open');
    expect(fields.title).toBe('Printer');
  });

  it('a nested redaction omits the whole display reference', () => {
    expect(visibleCoManagedFields(candidates, ['board.name'])).not.toHaveProperty('board');
  });

  it('two visible fields cannot reconstruct a hidden one', () => {
    const fields = visibleCoManagedFields(candidates, ['priority_id']);
    expect(fields).not.toHaveProperty('priority');
    expect(JSON.stringify(fields)).not.toMatch(/High|p1/);
  });

  it('wildcard hides everything', () => {
    expect(visibleCoManagedFields(candidates, ['*'])).toEqual({});
  });
});
