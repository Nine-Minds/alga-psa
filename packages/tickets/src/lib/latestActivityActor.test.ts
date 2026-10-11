// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { resolveLatestActivityActor, type LatestActivityNames } from './latestActivityActor';

const T0 = '2026-01-01T10:00:00.000Z';
const T1 = '2026-01-02T10:00:00.000Z';
const T2 = '2026-01-03T10:00:00.000Z';

const names: LatestActivityNames = {
  users: {
    'u-internal': { name: 'Ada Lovelace', userType: 'internal' },
    'u-client': { name: 'Cara Client', userType: 'client' },
    'u-editor': { name: 'Ed Itor', userType: 'internal' },
    'u-creator': { name: 'Cre Ator', userType: 'internal' },
  },
  contacts: { 'c-1': 'Contact One' },
};

const baseRow = {
  entered_at: T0,
  updated_at: T1,
  updated_by: 'u-editor',
  entered_by: 'u-creator',
  entered_by_name: 'Cre Ator',
};

describe('resolveLatestActivityActor', () => {
  const commentWins: Array<[string, Record<string, unknown>, unknown]> = [
    ['internal user', { user_id: 'u-internal' }, { kind: 'user', name: 'Ada Lovelace' }],
    ['client user', { user_id: 'u-client' }, { kind: 'client_user', name: 'Cara Client' }],
    ['contact', { contact_id: 'c-1' }, { kind: 'contact', name: 'Contact One' }],
    [
      'unmatched email sender with fromName',
      { email: { fromName: ' Sam Sender ', fromAddress: 'sam@example.com' } },
      { kind: 'email_sender', name: 'Sam Sender' },
    ],
    [
      'unmatched email sender without fromName',
      { email: { fromAddress: 'sam@example.com' } },
      { kind: 'email_sender', name: 'sam@example.com' },
    ],
    [
      'unmatched email sender in nested from object',
      { email: { from: { name: '', email: 'nested@example.com' } } },
      { kind: 'email_sender', name: 'nested@example.com' },
    ],
    ['system generated', { is_system_generated: true }, { kind: 'system', name: null }],
    ['no identifiable author', {}, null],
  ];

  for (const [label, comment, expected] of commentWins) {
    it(`comment wins: ${label}`, () => {
      const result = resolveLatestActivityActor(
        { ...baseRow, latest_activity_at: T2 },
        { created_at: T2, ...comment },
        names
      );
      expect(result).toEqual(expected);
    });
  }

  it('system flag beats a user_id on the comment', () => {
    expect(
      resolveLatestActivityActor(
        { ...baseRow, latest_activity_at: T2 },
        { created_at: T2, is_system_generated: true, user_id: 'u-internal' },
        names
      )
    ).toEqual({ kind: 'system', name: null });
  });

  it('a tie between comment and update goes to the comment', () => {
    expect(
      resolveLatestActivityActor(
        { ...baseRow, updated_at: T1, latest_activity_at: T1 },
        { created_at: new Date(T1), user_id: 'u-internal' },
        names
      )
    ).toEqual({ kind: 'user', name: 'Ada Lovelace' });
  });

  it('update wins with updated_by', () => {
    expect(
      resolveLatestActivityActor(
        { ...baseRow, latest_activity_at: T1 },
        { created_at: T0, user_id: 'u-internal' },
        names
      )
    ).toEqual({ kind: 'user', name: 'Ed Itor' });
  });

  it('update wins without updated_by gives null, never System', () => {
    expect(
      resolveLatestActivityActor({ ...baseRow, updated_by: null, latest_activity_at: T1 }, null, names)
    ).toBeNull();
  });

  it('update wins but updated_by is unknown gives null', () => {
    expect(
      resolveLatestActivityActor({ ...baseRow, updated_by: 'u-gone', latest_activity_at: T1 }, null, names)
    ).toBeNull();
  });

  it('creation wins when updated_at is within 1s of entered_at', () => {
    const updated = '2026-01-01T10:00:00.800Z';
    expect(
      resolveLatestActivityActor(
        { ...baseRow, updated_at: updated, latest_activity_at: updated },
        null,
        names
      )
    ).toEqual({ kind: 'user', name: 'Cre Ator' });
  });

  it('creation wins when updated_at is missing', () => {
    expect(
      resolveLatestActivityActor(
        { ...baseRow, updated_at: null, latest_activity_at: T0 },
        null,
        names
      )
    ).toEqual({ kind: 'user', name: 'Cre Ator' });
  });

  it('creation wins with a client creator is labelled client_user', () => {
    expect(
      resolveLatestActivityActor(
        { ...baseRow, entered_by: 'u-client', entered_by_name: 'Cara Client', updated_at: T0, latest_activity_at: T0 },
        null,
        names
      )
    ).toEqual({ kind: 'client_user', name: 'Cara Client' });
  });

  it('creation by an unknown creator gives null', () => {
    expect(
      resolveLatestActivityActor(
        { ...baseRow, entered_by: null, entered_by_name: 'Unknown', updated_at: T0, latest_activity_at: T0 },
        null,
        names
      )
    ).toBeNull();
  });

  it('returns null without latest_activity_at', () => {
    expect(resolveLatestActivityActor({ ...baseRow, latest_activity_at: null }, null, names)).toBeNull();
  });
});
