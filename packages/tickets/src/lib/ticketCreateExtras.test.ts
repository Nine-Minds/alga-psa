import { describe, expect, it } from 'vitest';
import {
  TICKET_CREATE_LIMITS,
  TICKET_CUSTOM_FIELD_LIMITS,
  parseTicketCreateExtras,
  ticketCreateExtrasSchema,
  validateTicketCustomFieldEntries,
  validateTicketCustomFields,
} from './ticketCreateExtras';

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const U1 = '33333333-3333-4333-8333-333333333333';

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });

describe('validateTicketCustomFieldEntries', () => {
  it('accepts distinct, non-blank names with bounded values', () => {
    expect(validateTicketCustomFieldEntries([{ name: 'Serial', value: 'ABC' }, { name: 'Rack', value: 4 }])).toEqual([]);
    expect(validateTicketCustomFieldEntries([])).toEqual([]);
  });

  it('rejects blank and whitespace-only names', () => {
    const issues = validateTicketCustomFieldEntries([{ name: '', value: 'x' }, { name: '   ', value: 'y' }]);
    expect(issues).toEqual([
      { code: 'name_blank', index: 0 },
      { code: 'name_blank', index: 1 },
    ]);
  });

  it('rejects duplicate names case-insensitively after trimming', () => {
    const issues = validateTicketCustomFieldEntries([
      { name: 'Serial', value: '1' },
      { name: '  serial ', value: '2' },
      { name: 'SERIAL', value: '3' },
    ]);
    expect(issues.map((i) => [i.code, i.index])).toEqual([['name_duplicate', 1], ['name_duplicate', 2]]);
  });

  it('bounds name length, value length and field count', () => {
    const long = 'x'.repeat(TICKET_CUSTOM_FIELD_LIMITS.maxNameLength + 1);
    expect(validateTicketCustomFieldEntries([{ name: long, value: '' }]).map((i) => i.code)).toEqual(['name_too_long']);

    const okName = 'x'.repeat(TICKET_CUSTOM_FIELD_LIMITS.maxNameLength);
    expect(validateTicketCustomFieldEntries([{ name: okName, value: '' }])).toEqual([]);

    const okValue = 'v'.repeat(TICKET_CUSTOM_FIELD_LIMITS.maxValueLength);
    expect(validateTicketCustomFieldEntries([{ name: 'a', value: okValue }])).toEqual([]);
    expect(validateTicketCustomFieldEntries([{ name: 'a', value: okValue + 'v' }]).map((i) => i.code)).toEqual(['value_too_long']);
    // non-string values are measured by their JSON form
    expect(validateTicketCustomFieldEntries([{ name: 'a', value: { k: okValue } }]).map((i) => i.code)).toEqual(['value_too_long']);

    const many = Array.from({ length: TICKET_CUSTOM_FIELD_LIMITS.maxFields + 1 }, (_, i) => ({ name: `f${i}`, value: '' }));
    expect(validateTicketCustomFieldEntries(many).map((i) => i.code)).toEqual(['too_many_fields']);
    expect(validateTicketCustomFieldEntries(many.slice(0, TICKET_CUSTOM_FIELD_LIMITS.maxFields))).toEqual([]);
  });

  it('rejects the reserved __proto__ name', () => {
    expect(validateTicketCustomFieldEntries([{ name: '__proto__', value: 'x' }]).map((i) => i.code)).toEqual(['name_reserved']);
  });

  it('validates a record the same way (server side)', () => {
    expect(validateTicketCustomFields({ Serial: '1', ' serial': '2' }).map((i) => i.code)).toEqual(['name_duplicate']);
  });
});

describe('ticketCreateExtrasSchema', () => {
  it('accepts an empty payload and every field omitted (backward compatible)', () => {
    expect(ticketCreateExtrasSchema.parse({})).toEqual({});
  });

  it('accepts the three new fields', () => {
    expect(ticketCreateExtrasSchema.parse({ asset_ids: [A1], watcher_ids: [U1], custom_fields: { a: 'b' } })).toEqual({
      asset_ids: [A1],
      watcher_ids: [U1],
      custom_fields: { a: 'b' },
    });
  });

  it('rejects non-uuid ids, wrong types, unknown keys and oversized lists', () => {
    expect(ticketCreateExtrasSchema.safeParse({ asset_ids: ['nope'] }).success).toBe(false);
    expect(ticketCreateExtrasSchema.safeParse({ watcher_ids: 'x' }).success).toBe(false);
    expect(ticketCreateExtrasSchema.safeParse({ custom_fields: ['a'] }).success).toBe(false);
    expect(ticketCreateExtrasSchema.safeParse({ extra: 1 }).success).toBe(false);
    const tooMany = Array.from({ length: TICKET_CREATE_LIMITS.maxAssets + 1 }, () => A1);
    expect(ticketCreateExtrasSchema.safeParse({ asset_ids: tooMany }).success).toBe(false);
  });
});

describe('parseTicketCreateExtras', () => {
  it('returns empty extras when the form sends none (existing callers)', () => {
    expect(parseTicketCreateExtras(form({ title: 't' }))).toEqual({ assetIds: [], watcherIds: [] });
  });

  it('parses, dedupes and trims names', () => {
    const parsed = parseTicketCreateExtras(
      form({
        asset_ids: JSON.stringify([A1, A2, A1]),
        watcher_ids: JSON.stringify([U1, U1]),
        custom_fields: JSON.stringify({ ' Serial ': 'X' }),
      })
    );
    expect(parsed).toEqual({ assetIds: [A1, A2], watcherIds: [U1], customFields: { Serial: 'X' } });
  });

  it('keeps an explicitly empty custom_fields object (user cleared template values)', () => {
    expect(parseTicketCreateExtras(form({ custom_fields: '{}' })).customFields).toEqual({});
  });

  it('throws before any write on malformed or invalid input', () => {
    expect(() => parseTicketCreateExtras(form({ asset_ids: '{not json' }))).toThrow(/Invalid ticket create payload/);
    expect(() => parseTicketCreateExtras(form({ asset_ids: JSON.stringify(['bad']) }))).toThrow(/Invalid ticket create payload/);
    expect(() => parseTicketCreateExtras(form({ custom_fields: JSON.stringify({ a: '1', A: '2' }) }))).toThrow(/Invalid custom fields:.*more than once/);
    expect(() => parseTicketCreateExtras(form({ custom_fields: JSON.stringify({ '': '1' }) }))).toThrow(/blank name/);
  });
});
