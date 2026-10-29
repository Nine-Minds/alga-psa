import { describe, expect, it } from 'vitest';
import { createCoManagedSharedTicketDataSource } from '@/lib/co-managed/sharedTicketDataSource';

const summary = { revision: 1, resource: { tenant: 't1', relationshipId: 'r1', kind: 'ticket' as const, id: 'tk1' },
  fields: { ticket_number: 'T-1', title: 'Printer', status: { tenant: 't1', kind: 'status' as const, id: 's1', name: 'Open' } } };

describe('co-managed shared ticket data source', () => {
  const source = createCoManagedSharedTicketDataSource(summary, '/back');
  it('is read-only with no optional sections', () => {
    expect(source.screen.readOnly).toBe(true);
    expect(Object.values(source.capabilities).every(v => v === false)).toBe(true);
    expect(source.boundTicketId).toBe('tk1');
  });
  it('serves only the bound ticket and no comments', async () => {
    expect(await source.ticket.getTicketById('tk1')).toMatchObject({ ticket_id: 'tk1', title: 'Printer', status_name: 'Open' });
    expect(await source.ticket.getTicketById('other')).toBeNull();
    expect(await source.comments.findCommentsByTicketId('tk1')).toEqual([]);
  });
  it('refuses every write', () => {
    expect(() => (source.ticket.updateTicket as any)()).toThrow(/read-only/);
    expect(() => (source.comments.createComment as any)()).toThrow(/read-only/);
  });
});
