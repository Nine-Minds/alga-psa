import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(async () => {}) }));
import { QUOTE_ALLOWED_STATUS_TRANSITIONS } from './quoteStatusTransitions';
import { quoteLifecycleEventFor } from './quoteLifecycleEvents';

describe('quote lifecycle transition classification', () => {
  it('classifies every allowed status transition and suppresses unchanged statuses', () => {
    const expected: Record<string, string> = {
      sent: 'QUOTE_SENT', approved: 'QUOTE_APPROVED', accepted: 'QUOTE_ACCEPTED',
      rejected: 'QUOTE_REJECTED', expired: 'QUOTE_EXPIRED', converted: 'QUOTE_CONVERTED',
      cancelled: 'QUOTE_CANCELLED',
    };
    for (const [before, targets] of Object.entries(QUOTE_ALLOWED_STATUS_TRANSITIONS)) {
      for (const after of targets) {
        expect(quoteLifecycleEventFor(before as keyof typeof QUOTE_ALLOWED_STATUS_TRANSITIONS, after)).toBe(expected[after] ?? null);
      }
      const status = before as keyof typeof QUOTE_ALLOWED_STATUS_TRANSITIONS;
      expect(quoteLifecycleEventFor(status, status)).toBeNull();
    }
  });

  it('distinguishes system conversion reversion and revision supersession', () => {
    expect(quoteLifecycleEventFor('converted', 'accepted')).toBeNull();
    expect(quoteLifecycleEventFor('converted', 'accepted', { system: true })).toBe('QUOTE_CONVERSION_REVERTED');
    expect(quoteLifecycleEventFor('accepted', 'superseded')).toBe('QUOTE_SUPERSEDED');
    expect(quoteLifecycleEventFor(null, 'sent')).toBeNull();
  });
});

describe('after-commit quote event queue', () => {
  it('uses a stable view key and a distinct activity key for each conversion', async () => {
    const { withTransaction } = await import('@alga-psa/db');
    const { queueQuoteLifecycleEvent } = await import('./quoteLifecycleEvents');
    const { builtWorkflowPayload } = await import('@alga-psa/event-schemas');
    const published = vi.mocked((await import('@alga-psa/event-bus/publishers')).publishWorkflowEvent);
    published.mockClear();
    const trx = { commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}) } as any;
    const knex = { transaction: async (callback: any) => { const result = await callback(trx); await trx.commit(); return result; } } as any;
    const params = { tenant: 'tenant-a', quoteId: 'quote-a', occurredAt: '2026-10-27T12:00:00.000Z', actor: { actorType: 'SYSTEM' as const } };
    await withTransaction(knex, async (t) => {
      queueQuoteLifecycleEvent(t, { eventType: 'QUOTE_VIEWED', payload: builtWorkflowPayload('QUOTE_VIEWED', {}) }, params);
      queueQuoteLifecycleEvent(t, { eventType: 'QUOTE_CONVERTED', payload: builtWorkflowPayload('QUOTE_CONVERTED', {}) }, { ...params, activityId: 'first' });
      queueQuoteLifecycleEvent(t, { eventType: 'QUOTE_CONVERTED', payload: builtWorkflowPayload('QUOTE_CONVERTED', {}) }, { ...params, activityId: 'second' });
    });
    expect(published.mock.calls.map(([event]) => event.idempotencyKey)).toEqual(['quote_viewed:quote-a', 'quote_converted:quote-a:first', 'quote_converted:quote-a:second']);
    const ids = published.mock.calls.map(([, options]) => options?.eventId);
    expect(new Set(ids).size).toBe(3);
    published.mockClear();
    await withTransaction(knex, async (t) => {
      queueQuoteLifecycleEvent(t, { eventType: 'QUOTE_VIEWED', payload: builtWorkflowPayload('QUOTE_VIEWED', {}) }, params);
      queueQuoteLifecycleEvent(t, { eventType: 'QUOTE_VIEWED', payload: builtWorkflowPayload('QUOTE_VIEWED', {}) }, { ...params, tenant: 'tenant-b' });
      queueQuoteLifecycleEvent(t, { eventType: 'QUOTE_CONVERTED', payload: builtWorkflowPayload('QUOTE_CONVERTED', {}) }, { ...params, activityId: 'first' });
    });
    expect(published.mock.calls[0][1]?.eventId).toBe(ids[0]);
    expect(published.mock.calls[1][1]?.eventId).not.toBe(ids[0]);
    expect(published.mock.calls[2][1]?.eventId).toBe(ids[1]);
  });

  it('publishes after the owner commits and drops events on rollback', async () => {
    const { withTransaction } = await import('@alga-psa/db');
    const { queueQuoteLifecycleEvent } = await import('./quoteLifecycleEvents');
    const { builtWorkflowPayload } = await import('@alga-psa/event-schemas');
    const published = vi.mocked((await import('@alga-psa/event-bus/publishers')).publishWorkflowEvent);
    published.mockClear();
    const trx = { commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}) } as any;
    const knex = { transaction: vi.fn(async (callback: any) => {
      try { const result = await callback(trx); await trx.commit(); return result; }
      catch (error) { await trx.rollback(); throw error; }
    }) } as any;
    const params = { tenant: 'tenant-a', quoteId: 'quote-a', activityId: 'activity-a', occurredAt: '2026-10-27T12:00:00.000Z', actor: { actorType: 'SYSTEM' as const } };
    const event = { eventType: 'QUOTE_SENT' as const, payload: builtWorkflowPayload('QUOTE_SENT', { quoteId: 'quote-a' }) };
    await withTransaction(knex, async (t) => {
      queueQuoteLifecycleEvent(t, event, params);
      expect(published).not.toHaveBeenCalled();
    });
    expect(trx.commit).toHaveBeenCalledOnce();
    expect(published).toHaveBeenCalledOnce();
    expect(published).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'quote_sent:quote-a:activity-a', ctx: expect.objectContaining({ tenantId: 'tenant-a', actor: params.actor }) }), expect.objectContaining({ eventId: expect.any(String) }));
    published.mockClear();
    await expect(withTransaction(knex, async (t) => { queueQuoteLifecycleEvent(t, event, params); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(published).not.toHaveBeenCalled();
  });
});
