import { beforeEach, describe, expect, it, vi } from 'vitest';

const queries: Array<{ table: string; whereRaw: unknown[][]; where: unknown[][] }> = [];
const results: Record<string, unknown> = {};

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(),
  withSavepoint: vi.fn(),
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (table: string) => {
      const record = { table, whereRaw: [] as unknown[][], where: [] as unknown[][] };
      queries.push(record);
      const chain: any = {
        leftJoin: () => chain,
        join: () => chain,
        whereRaw: (...args: unknown[]) => { record.whereRaw.push(args); return chain; },
        where: (...args: unknown[]) => { record.where.push(args); return chain; },
        orderBy: () => chain,
        first: async () => results[table.split(' ')[0]] ?? null,
      };
      // The tenant scope comes from the facade, as in production.
      record.where.push(['tenant', tenant]);
      return chain;
    },
  }),
}));

import {
  EmailOwnershipError,
  describeContactEmailConflict,
  isEmailOwnershipError,
  resolveContactEmailOwnership,
} from '../contactEmailOwnership';

const row = (over: Record<string, unknown> = {}) => ({
  contact_name_id: 'c1',
  client_id: 'cl1',
  full_name: 'Jane Doe',
  is_inactive: false,
  client_name: 'Acme',
  ...over,
});

describe('resolveContactEmailOwnership (query order)', () => {
  beforeEach(() => {
    queries.length = 0;
    for (const key of Object.keys(results)) delete results[key];
  });

  it('answers from the primary email without consulting additional addresses when both would match', async () => {
    results.contacts = row();
    results.contact_additional_email_addresses = row({ contact_name_id: 'c2' });

    const owner = await resolveContactEmailOwnership('t1', '  Jane@Acme.TEST ', {} as any);

    expect(owner).toMatchObject({ kind: 'primary', contactNameId: 'c1', clientName: 'Acme' });
    expect(queries.map((q) => q.table)).toEqual(['contacts as c']);
    // Normalised: trimmed and lower-cased before it reaches SQL.
    expect(queries[0].whereRaw[0]).toEqual(['lower(c.email) = ?', ['jane@acme.test']]);
  });

  it('falls through to additional addresses, scoped to the tenant, when no primary matches', async () => {
    results.contact_additional_email_addresses = row({ contact_name_id: 'c2', client_id: null, client_name: null });

    const owner = await resolveContactEmailOwnership('t1', 'x@y.test', {} as any);

    expect(owner).toEqual({
      kind: 'additional',
      contactNameId: 'c2',
      clientId: null,
      fullName: 'Jane Doe',
      clientName: null,
      isInactive: false,
    });
    expect(queries.map((q) => q.table)).toEqual(['contacts as c', 'contact_additional_email_addresses as cea']);
    expect(queries.every((q) => q.where.some((w) => w[0] === 'tenant' && w[1] === 't1'))).toBe(true);
  });

  it('returns null, and runs no query, for a blank email', async () => {
    await expect(resolveContactEmailOwnership('t1', '   ', {} as any)).resolves.toBeNull();
    expect(queries).toHaveLength(0);
  });
});

describe('EmailOwnershipError and describeContactEmailConflict', () => {
  const t = (key: string, params: Record<string, string> = {}) => `${key}|${JSON.stringify(params)}`;
  const owner = { kind: 'primary' as const, contactNameId: 'c1', clientId: 'cl1', fullName: 'Jane Doe', clientName: 'Acme', isInactive: false };

  it('keeps the EMAIL_EXISTS prefix and generic text while carrying the owner', () => {
    const error = new EmailOwnershipError(owner);
    expect(error.message).toBe('EMAIL_EXISTS: A contact with this email address already exists in the system');
    expect(error.conflict).toBe(owner);
    expect(isEmailOwnershipError(error)).toBe(true);
    expect(isEmailOwnershipError(new Error('EMAIL_EXISTS: x'))).toBe(false);
  });

  it('recognises a structurally identical error from another copy of the module', () => {
    const foreign = Object.assign(new Error('EMAIL_EXISTS: x'), { name: 'EmailOwnershipError', conflict: owner });
    expect(isEmailOwnershipError(foreign)).toBe(true);
  });

  it('names contact and client when the caller can see them', () => {
    expect(describeContactEmailConflict(owner, true, t)).toBe('errors.contact.emailConflict.named|{"name":"Jane Doe","client":"Acme"}');
  });

  it('says "another client" and names nothing when the caller cannot see the owner', () => {
    const text = describeContactEmailConflict(owner, false, t);
    expect(text).toBe('errors.contact.emailConflict.anotherClient|{}');
    expect(text).not.toContain('Jane');
    expect(text).not.toContain('Acme');
  });

  it('uses the additional-email and inactive wordings, and redaction beats both', () => {
    expect(describeContactEmailConflict({ ...owner, kind: 'additional' }, true, t)).toContain('additionalAtClient');
    expect(describeContactEmailConflict({ ...owner, isInactive: true }, true, t)).toContain('inactiveAtClient');
    expect(describeContactEmailConflict({ ...owner, clientId: null, clientName: null }, true, t)).toContain('namedNoClient');
    expect(describeContactEmailConflict({ ...owner, kind: 'additional' }, false, t)).toContain('anotherClient');
    expect(describeContactEmailConflict({ ...owner, isInactive: true }, false, t)).toContain('anotherClient');
  });
});
