import { describe, expect, it } from 'vitest';
import {
  TICKET_CREATE_LIMITS,
  parseTicketCreateExtras,
  ticketCreateExtrasSchema,
} from './ticketCreateExtras';

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const U1 = '33333333-3333-4333-8333-333333333333';

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });

describe('ticketCreateExtrasSchema', () => {
  it('accepts an empty payload and every field omitted (backward compatible)', () => {
    expect(ticketCreateExtrasSchema.parse({})).toEqual({});
  });

  it('accepts the two extras fields', () => {
    expect(ticketCreateExtrasSchema.parse({ asset_ids: [A1], watcher_ids: [U1] })).toEqual({
      asset_ids: [A1],
      watcher_ids: [U1],
    });
  });

  it('rejects non-uuid ids, wrong types, unknown keys and oversized lists', () => {
    expect(ticketCreateExtrasSchema.safeParse({ asset_ids: ['nope'] }).success).toBe(false);
    expect(ticketCreateExtrasSchema.safeParse({ watcher_ids: 'x' }).success).toBe(false);
    expect(ticketCreateExtrasSchema.safeParse({ extra: 1 }).success).toBe(false);
    const tooMany = Array.from({ length: TICKET_CREATE_LIMITS.maxAssets + 1 }, () => A1);
    expect(ticketCreateExtrasSchema.safeParse({ asset_ids: tooMany }).success).toBe(false);
  });
});

describe('parseTicketCreateExtras', () => {
  it('returns empty extras when the form sends none (existing callers)', () => {
    expect(parseTicketCreateExtras(form({ title: 't' }))).toEqual({ assetIds: [], watcherIds: [] });
  });

  it('parses and dedupes ids', () => {
    const parsed = parseTicketCreateExtras(
      form({
        asset_ids: JSON.stringify([A1, A2, A1]),
        watcher_ids: JSON.stringify([U1, U1]),
      })
    );
    expect(parsed).toEqual({ assetIds: [A1, A2], watcherIds: [U1] });
  });

  it('ignores a custom_fields value entirely (neither parsed, validated nor returned)', () => {
    expect(parseTicketCreateExtras(form({ custom_fields: JSON.stringify({ a: '1', A: '2' }) }))).toEqual({ assetIds: [], watcherIds: [] });
    expect(parseTicketCreateExtras(form({ custom_fields: '{not json' }))).toEqual({ assetIds: [], watcherIds: [] });
  });

  it('throws before any write on malformed or invalid input', () => {
    expect(() => parseTicketCreateExtras(form({ asset_ids: '{not json' }))).toThrow(/Invalid ticket create payload/);
    expect(() => parseTicketCreateExtras(form({ asset_ids: JSON.stringify(['bad']) }))).toThrow(/Invalid ticket create payload/);
  });
});
