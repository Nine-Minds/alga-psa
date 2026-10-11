import { describe, expect, it } from 'vitest';
import { countDuplicableCustomFields, pickDuplicableAttributes } from './ticketDuplicate';

describe('pickDuplicableAttributes (D7 allowlist)', () => {
  it('keeps custom_fields and drops every other attributes key', () => {
    const picked = pickDuplicableAttributes({
      description: 'copied via the form instead',
      custom_fields: { f1: 'a', f2: 3 },
      watch_list: [{ email: 'x@example.com' }],
      sla_last_response_threshold_notified: 80,
      source_reference: { message_id: 'm1' },
      teams_guest_intake: { guest: true },
      tags: ['legacy'],
      due_date: '2026-10-10',
      email_metadata: { subject: 's' },
      some_future_system_key: 'leak?',
    });
    expect(picked).toEqual({ custom_fields: { f1: 'a', f2: 3 } });
    for (const denied of [
      'description',
      'watch_list',
      'sla_last_response_threshold_notified',
      'source_reference',
      'teams_guest_intake',
      'tags',
      'due_date',
      'email_metadata',
      'some_future_system_key',
    ]) {
      expect(picked).not.toHaveProperty(denied);
    }
  });

  it('accepts attributes stored as a JSON string', () => {
    const json = JSON.stringify({ custom_fields: { f1: 'a' }, watch_list: ['x'] });
    expect(pickDuplicableAttributes(json)).toEqual({ custom_fields: { f1: 'a' } });
  });

  it('returns {} for malformed JSON, null, undefined, non-objects and arrays', () => {
    expect(pickDuplicableAttributes('{not json')).toEqual({});
    expect(pickDuplicableAttributes(null)).toEqual({});
    expect(pickDuplicableAttributes(undefined)).toEqual({});
    expect(pickDuplicableAttributes(42)).toEqual({});
    expect(pickDuplicableAttributes('"a string"')).toEqual({});
    expect(pickDuplicableAttributes([{ custom_fields: { f1: 'a' } }])).toEqual({});
  });

  it('returns {} when there are no custom field values to carry', () => {
    expect(pickDuplicableAttributes({})).toEqual({});
    expect(pickDuplicableAttributes('')).toEqual({});
    expect(pickDuplicableAttributes({ custom_fields: {} })).toEqual({});
    expect(pickDuplicableAttributes({ custom_fields: null })).toEqual({});
    expect(pickDuplicableAttributes({ custom_fields: ['a'] })).toEqual({});
    expect(pickDuplicableAttributes({ custom_fields: 'nope' })).toEqual({});
  });
});

describe('countDuplicableCustomFields', () => {
  it('counts the values a duplicate would carry', () => {
    expect(countDuplicableCustomFields({ custom_fields: { a: 1, b: 2 }, watch_list: [] })).toBe(2);
    expect(countDuplicableCustomFields(JSON.stringify({ custom_fields: { a: 1 } }))).toBe(1);
  });

  it('is 0 for empty or unusable input', () => {
    expect(countDuplicableCustomFields(null)).toBe(0);
    expect(countDuplicableCustomFields({})).toBe(0);
    expect(countDuplicableCustomFields('{bad')).toBe(0);
  });
});
