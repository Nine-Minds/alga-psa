import { describe, expect, it } from 'vitest';
import { bulkHandoffOperationId } from './bulkHandoffOperationId';
import {
  runBulkHandoff,
  summarizeBulkHandoff,
  type BulkHandoffItem,
} from './bulkHandoff';

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const item = (ticketId: string, expectedRevision = 0): BulkHandoffItem => ({ ticketId, expectedRevision });
const state = { responsibility: 'client_it' as const, revision: 1 };

describe('runBulkHandoff', () => {
  it('reports one result per ticket, in selection order, success with its state and failure with its reason', async () => {
    const results = await runBulkHandoff(
      ids.map((id) => item(id)),
      async ({ ticketId }) => (ticketId === ids[1] ? { message: 'Stale', messageKey: 'k.stale' } : { state }),
      () => ({ message: 'unexpected' }),
    );
    expect(results).toEqual([
      { ticketId: ids[0], ok: true, state },
      { ticketId: ids[1], ok: false, message: 'Stale', messageKey: 'k.stale' },
      { ticketId: ids[2], ok: true, state },
    ]);
  });

  it('an unexpected error fails that ticket only: the tickets after it are still handed over', async () => {
    const acted: string[] = [];
    const results = await runBulkHandoff(
      ids.map((id) => item(id)),
      async ({ ticketId }) => {
        if (ticketId === ids[0]) throw new Error('connection reset');
        acted.push(ticketId);
        return { state };
      },
      (failed, error) => ({ message: `${failed.ticketId}: ${(error as Error).message}` }),
    );
    expect(acted).toEqual([ids[1], ids[2]]);
    expect(results.map((result) => result.ok)).toEqual([false, true, true]);
    expect(results[0]).toMatchObject({ ticketId: ids[0], ok: false, message: `${ids[0]}: connection reset` });
  });

  it('survives a failure reporter that itself throws', async () => {
    const results = await runBulkHandoff(
      [item(ids[0]), item(ids[1])],
      async ({ ticketId }) => { if (ticketId === ids[0]) throw new Error('boom'); return { state }; },
      () => { throw new Error('reporter broke'); },
    );
    expect(results[0]).toMatchObject({ ticketId: ids[0], ok: false });
    expect(results[1]).toEqual({ ticketId: ids[1], ok: true, state });
  });

  it('hands a ticket named twice over once, and acts on tickets one at a time', async () => {
    let running = 0;
    let overlapped = false;
    const calls: string[] = [];
    const results = await runBulkHandoff(
      [item(ids[0]), item(ids[1]), item(ids[0].toUpperCase()), item(ids[0])],
      async ({ ticketId }) => {
        if (++running > 1) overlapped = true;
        calls.push(ticketId);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
        return { state };
      },
      () => ({ message: 'x' }),
    );
    expect(calls).toEqual([ids[0], ids[1]]);
    expect(results).toHaveLength(2);
    expect(overlapped).toBe(false);
  });

  it('every ticket failing is a result for each, not an error', async () => {
    const results = await runBulkHandoff(ids.map((id) => item(id)), async () => ({ message: 'no' }), () => ({ message: 'x' }));
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(summarizeBulkHandoff(results)).toEqual({
      succeeded: [],
      failed: ids.map((ticketId) => ({ ticketId, message: 'no' })),
    });
  });
});

describe('summarizeBulkHandoff', () => {
  it('splits the succeeded tickets from the failed ones and keeps the translation key', () => {
    expect(summarizeBulkHandoff([
      { ticketId: ids[0], ok: true, state },
      { ticketId: ids[1], ok: false, message: 'Stale', messageKey: 'k.stale' },
    ])).toEqual({ succeeded: [ids[0]], failed: [{ ticketId: ids[1], message: 'Stale', messageKey: 'k.stale' }] });
  });
});

describe('bulkHandoffOperationId', () => {
  const submission = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it('is the same on every retry of a submission, so a replay finds each ticket\'s receipt', () => {
    expect(bulkHandoffOperationId(submission, 'client_it', ids[0])).toBe(bulkHandoffOperationId(submission, 'client_it', ids[0]));
    expect(bulkHandoffOperationId(submission.toUpperCase(), 'client_it', ids[0].toUpperCase()))
      .toBe(bulkHandoffOperationId(submission, 'client_it', ids[0]));
  });

  it('differs per ticket, per direction and per submission, and is shaped as a UUID the commands accept', () => {
    const seen = new Set([
      bulkHandoffOperationId(submission, 'client_it', ids[0]),
      bulkHandoffOperationId(submission, 'client_it', ids[1]),
      bulkHandoffOperationId(submission, 'msp', ids[0]),
      bulkHandoffOperationId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'client_it', ids[0]),
    ]);
    expect(seen.size).toBe(4);
    for (const operationId of seen) expect(operationId).toMatch(uuid);
  });
});
