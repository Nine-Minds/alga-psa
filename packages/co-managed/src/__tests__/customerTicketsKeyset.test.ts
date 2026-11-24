import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { collectAdmitted, cutCoManagedPage, decodeCoManagedTicketCursor, encodeCoManagedTicketCursor, listCoManagedCustomerTickets, MAX_OFFSET,
  validateCoManagedLegacyPage, type CoManagedBatchFetcher, type CoManagedTicketKey } from '../sharedWorkRead';
import { CoManagedSharedWorkError } from '../sharedWorkIdentity';

type T = { entered: string; id: string; denied?: boolean };
const stamp = (n: number) => `2026-01-01T00:00:${String(n).padStart(2, '0')}.123456Z`;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ordered = (rows: T[]) => [...rows].sort((a, b) => a.entered === b.entered ? a.id.localeCompare(b.id) : b.entered.localeCompare(a.entered));
/** An in-memory relationship that honours the keyset contract exactly as the SQL does, and records every limit it is given. */
function relationship(rows: T[], limits: number[]): CoManagedBatchFetcher {
  const sorted = ordered(rows);
  return async (after: CoManagedTicketKey | null, limit: number) => {
    limits.push(limit);
    return sorted.filter(r => !after || r.entered < after.enteredAt! || (r.entered === after.enteredAt && r.id > after.ticketId))
      .slice(0, limit).map(r => ({ entered: r.entered, id: r.id, row: r }));
  };
}
const admit = (row: T) => row.denied ? null : ({ resource: { tenant: 't', relationshipId: 'r', kind: 'ticket' as const, id: row.id }, customerName: '', fields: {} });

function walk(rels: T[][], pageSize: number, limits: number[]) {
  const fetchers = rels.map(rows => relationship(rows, limits));
  return async () => {
    const seen: string[] = []; let after: CoManagedTicketKey | null = null;
    for (let guard = 0; guard < 1000; guard++) {
      const cut = cutCoManagedPage(await Promise.all(fetchers.map(f => collectAdmitted(f, admit, after, pageSize + 1, pageSize + 1))), pageSize);
      if (cut.hasMore) expect(cut.rows).toHaveLength(pageSize);
      seen.push(...cut.rows.map(r => r.id));
      if (!cut.hasMore) { expect(cut.nextCursor).toBeNull(); return seen; }
      after = decodeCoManagedTicketCursor(cut.nextCursor);
    }
    throw new Error('did not terminate');
  };
}

describe('Customer Tickets keyset paging', () => {
  it('follows nextCursor across three relationships exactly once, in order, across an entered_at tie, with bounded limits', async () => {
    let n = 0;
    // Timestamps collide across relationships (and within one) so a tie spans page boundaries.
    const mk = (count: number, offset: number): T[] => Array.from({ length: count }, () => { n++; return { entered: stamp(Math.floor((n + offset) / 3) % 40), id: id(n) }; });
    const rels = [mk(17, 0), mk(11, 1), mk(23, 2)], limits: number[] = [];
    const seen = await walk(rels, 5, limits)();
    const expected = ordered(rels.flat()).map(r => r.id);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(expected.length);
    expect(Math.max(...limits)).toBeLessThanOrEqual(6);
  });

  it('keeps pages full and hasMore exact when the evaluator denies rows, refilling in bounded batches', async () => {
    const rows: T[] = Array.from({ length: 60 }, (_, i) => ({ entered: stamp(59 - i), id: id(i + 1), denied: i % 3 !== 0 && i < 40 }));
    const limits: number[] = [];
    const seen = await walk([rows.slice(0, 30), rows.slice(30)], 4, limits)();
    expect(seen).toEqual(ordered(rows.filter(r => !r.denied)).map(r => r.id));
    expect(seen.some(s => rows.find(r => r.id === s)!.denied)).toBe(false);
    expect(Math.max(...limits)).toBeLessThanOrEqual(5);
    // A fully denied relationship yields nothing and does not loop forever.
    expect(await collectAdmitted(relationship([{ entered: stamp(1), id: id(1), denied: true }], []), admit, null, 5, 5)).toEqual([]);
  });

  it('rejects unsafe legacy pages and malformed cursors', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity, -1, 1.5, 2 ** 60, '1', null, MAX_OFFSET / 10 + 1]) expect(() => validateCoManagedLegacyPage(bad, 10)).toThrow(CoManagedSharedWorkError);
    expect(validateCoManagedLegacyPage(MAX_OFFSET / 10, 10)).toBe(MAX_OFFSET / 10);
    expect(validateCoManagedLegacyPage(undefined, 10)).toBe(0);
    const good = encodeCoManagedTicketCursor({ enteredAt: stamp(1), ticketId: id(1) });
    expect(decodeCoManagedTicketCursor(good)).toEqual({ enteredAt: stamp(1), ticketId: id(1) });
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    for (const bad of ['', 'not a cursor', '%%%', b64({}), b64({ enteredAt: 'yesterday', ticketId: id(1) }), b64({ enteredAt: stamp(1), ticketId: 'x' }),
      b64({ enteredAt: stamp(1), ticketId: id(1), extra: 1 }), b64([1]), b64('x'), b64({ enteredAt: '2026-13-45T00:00:00.000000Z', ticketId: id(1) }), 'a'.repeat(500), 42, {}])
      expect(() => decodeCoManagedTicketCursor(bad)).toThrow(CoManagedSharedWorkError);
  });

  it('refuses bad options before touching the database', async () => {
    const actor = { kind: 'session' as const, tenant: randomUUID(), userId: randomUUID(), sessionId: randomUUID() };
    const db: any = new Proxy({}, { get() { throw new Error('database touched'); } });
    const cursor = encodeCoManagedTicketCursor({ enteredAt: stamp(1), ticketId: id(1) });
    for (const options of [{ page: MAX_OFFSET + 1 }, { page: Number.NaN }, { page: Infinity }, { page: -1 }, { page: 1.5 }, { cursor: 'garbage' },
      { page: 1, cursor }, { pageSize: Number.NaN }, { page: 51, pageSize: 100 }])
      await expect(listCoManagedCustomerTickets(db, actor, options as any)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
  });
});
