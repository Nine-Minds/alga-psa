import { describe, expect, it, vi } from 'vitest';
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

describe('co-managed shared ticket data source write path', () => {
  const build = (results: Array<{ ok: true } | { ok: false; code: string }>) => {
    const save = vi.fn(async () => results.shift() ?? { ok: true as const });
    let n = 0;
    const edit = { editableFields: ['title', 'status_id'] as const, baselines: { title: 'Printer', status_id: 's1' }, save, newOperationId: () => `op-${++n}` };
    return { save, edit, source: createCoManagedSharedTicketDataSource(summary, '/back', edit as never) };
  };

  it('is writable only for the allowlisted fields and still has no optional sections', () => {
    const { source } = build([]);
    expect(source.screen.readOnly).toBe(false);
    expect(source.screen.frozenFields).toContain('board_id');
    expect(source.screen.frozenFields).toContain('assigned_to');
    expect(source.screen.frozenFields).not.toContain('title');
    expect(Object.values(source.capabilities).every(v => v === false)).toBe(true);
    expect(() => (source.comments.createComment as any)()).toThrow(/read-only/);
  });

  it('sends the field baseline with the patch and advances it on success', async () => {
    const { source, save, edit } = build([{ ok: true }]);
    expect(await (source.ticket.updateTicket as any)('tk1', { title: 'Scanner' })).toBe('success');
    expect(save).toHaveBeenCalledWith({ operationId: 'op-1', expected: { title: 'Printer' }, patch: { title: 'Scanner' } });
    expect(edit.baselines.title).toBe('Scanner');
  });

  it('refuses fields the shared model cannot write and other tickets', async () => {
    const { source, save } = build([]);
    await expect((source.ticket.updateTicket as any)('tk1', { assigned_to: 'u1' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect((source.ticket.updateTicket as any)('tk1', { priority_id: 'p1' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect((source.ticket.updateTicket as any)('other', { title: 'x' })).rejects.toThrow(/read-only/);
    expect(save).not.toHaveBeenCalled();
  });

  it('surfaces a stale baseline as a conflict and does not advance the baseline', async () => {
    const { source, edit } = build([{ ok: false, code: 'conflict' }]);
    await expect((source.ticket.updateTicket as any)('tk1', { title: 'Scanner' })).rejects.toMatchObject({ code: 'conflict' });
    expect(edit.baselines.title).toBe('Printer');
  });

  it('retries an unknown outcome with the exact request id and baseline, then starts fresh', async () => {
    const { source, save } = build([{ ok: false, code: 'unknownOutcome' }, { ok: true }, { ok: true }]);
    await expect((source.ticket.updateTicket as any)('tk1', { title: 'Scanner' })).rejects.toMatchObject({ code: 'unknownOutcome' });
    expect(await (source.ticket.updateTicket as any)('tk1', { title: 'Scanner' })).toBe('success');
    expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
    expect(save.mock.calls[0][0].operationId).toBe('op-1');
    // A later, different edit never reuses the settled operation id.
    await (source.ticket.updateTicket as any)('tk1', { status_id: 's2' });
    expect(save.mock.calls[2][0].operationId).toBe('op-2');
  });
});
