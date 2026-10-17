import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T061-T069 (F042 / F043) — turning a provider's signed-in user string into a
 * client contact, and refusing to guess when it is ambiguous.
 */

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const dbState: Record<string, Row[]> = {};

  const resetDb = () => {
    for (const key of Object.keys(dbState)) delete dbState[key];
    dbState.contacts = [];
    dbState.tenant_external_entity_mappings = [];
  };

  const strip = (key: string) => (key.includes('.') ? key.split('.').pop()! : key);

  class QB {
    private readonly table: string;
    private objWheres: Array<Record<string, any>> = [];
    private notWheres: Array<Record<string, any>> = [];

    constructor(spec: string) {
      this.table = spec.split(' as ')[0];
    }

    private get rows(): Row[] {
      if (!dbState[this.table]) dbState[this.table] = [];
      return dbState[this.table];
    }

    where(arg1: any, arg2?: any) {
      if (typeof arg1 === 'string') {
        this.objWheres.push({ [strip(arg1)]: arg2 });
        return this;
      }
      const normalized: Record<string, any> = {};
      for (const [k, v] of Object.entries(arg1)) normalized[strip(k)] = v;
      this.objWheres.push(normalized);
      return this;
    }

    whereNot(arg1: Record<string, any>) {
      const normalized: Record<string, any> = {};
      for (const [k, v] of Object.entries(arg1)) normalized[strip(k)] = v;
      this.notWheres.push(normalized);
      return this;
    }

    select(..._cols: unknown[]) {
      return this;
    }

    private filtered(): Row[] {
      let rows = [...this.rows];
      for (const where of this.objWheres) {
        rows = rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      }
      for (const where of this.notWheres) {
        rows = rows.filter((row) => !Object.entries(where).every(([k, v]) => row[k] === v));
      }
      return rows;
    }

    first() {
      return Promise.resolve(this.filtered().map((row) => ({ ...row }))[0]);
    }

    then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
      return Promise.resolve(this.filtered().map((row) => ({ ...row }))).then(resolve, reject);
    }
  }

  const knexMock: any = (spec: string) => new QB(spec);

  return { dbState, knexMock, resetDb };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (name: string) => conn(name).where({ tenant }),
  }),
}));

const { matchContactForRmmUser, normalizeRmmUsername, isRmmContactAssignmentMode } =
  await import('../userMatching');

const TENANT = 'tenant-1';
const CLIENT = 'client-1';
const INTEGRATION = 'integration-1';

const contact = (overrides: Row): Row => ({
  tenant: TENANT,
  client_id: CLIENT,
  contact_kind: 'person',
  email: null,
  full_name: null,
  ...overrides,
});

beforeEach(() => {
  h.resetDb();
});

const match = (raw: string) => {
  const normalized = normalizeRmmUsername(raw)!;
  return matchContactForRmmUser(h.knexMock, TENANT, CLIENT, INTEGRATION, 'tacticalrmm', normalized);
};

describe('normalizeRmmUsername', () => {
  it('strips a NetBIOS domain prefix', () => {
    expect(normalizeRmmUsername('CORP\\jdoe')).toEqual({
      key: 'jdoe', username: 'jdoe', domain: 'corp', email: null,
    });
  });

  it('keeps a display name with its space and records the AzureAD prefix', () => {
    expect(normalizeRmmUsername('AzureAD\\Jane Doe')).toEqual({
      key: 'jane doe', username: 'jane doe', domain: 'azuread', email: null,
    });
  });

  it('detects an email and exposes its local part as the username', () => {
    expect(normalizeRmmUsername('jane.doe@acme.com')).toEqual({
      key: 'jane.doe@acme.com', username: 'jane.doe', domain: null, email: 'jane.doe@acme.com',
    });
  });

  it('trims and drops the local-machine dot prefix', () => {
    expect(normalizeRmmUsername('.\\Administrator ')).toEqual({
      key: 'administrator', username: 'administrator', domain: null, email: null,
    });
  });

  it('returns null for empty, whitespace and nullish input', () => {
    expect(normalizeRmmUsername('')).toBeNull();
    expect(normalizeRmmUsername('   ')).toBeNull();
    expect(normalizeRmmUsername(null)).toBeNull();
    expect(normalizeRmmUsername(undefined)).toBeNull();
    expect(normalizeRmmUsername('CORP\\')).toBeNull();
  });
});

describe('matchContactForRmmUser', () => {
  it('prefers an explicit mapping over an email that would match someone else', async () => {
    h.dbState.contacts.push(
      contact({ contact_name_id: 'c-mapped', full_name: 'Mapped Person' }),
      contact({ contact_name_id: 'c-email', email: 'jdoe@acme.com' }),
    );
    h.dbState.tenant_external_entity_mappings.push({
      tenant: TENANT,
      integration_type: 'rmm:tacticalrmm',
      alga_entity_type: 'contact',
      external_realm_id: INTEGRATION,
      external_entity_id: 'jdoe',
      alga_entity_id: 'c-mapped',
    });

    expect(await match('CORP\\jdoe')).toEqual({ contactId: 'c-mapped', method: 'mapped' });
  });

  it('matches an email exactly and case-insensitively', async () => {
    h.dbState.contacts.push(contact({ contact_name_id: 'c1', email: 'Jane.Doe@Acme.com' }));
    expect(await match('JANE.DOE@ACME.COM')).toEqual({ contactId: 'c1', method: 'email' });
  });

  it('matches a unique email local part and refuses a shared one', async () => {
    h.dbState.contacts.push(contact({ contact_name_id: 'c1', email: 'jdoe@acme.com' }));
    expect(await match('CORP\\jdoe')).toEqual({ contactId: 'c1', method: 'username' });

    h.dbState.contacts.push(contact({ contact_name_id: 'c2', email: 'jdoe@acme.co.uk' }));
    expect(await match('CORP\\jdoe')).toBeNull();
  });

  it('matches a full name and refuses two people with the same one', async () => {
    h.dbState.contacts.push(contact({ contact_name_id: 'c1', full_name: 'Jane Doe' }));
    expect(await match('AzureAD\\Jane Doe')).toEqual({ contactId: 'c1', method: 'name' });

    h.dbState.contacts.push(contact({ contact_name_id: 'c2', full_name: 'jane doe' }));
    expect(await match('AzureAD\\Jane Doe')).toBeNull();
  });

  it('ignores contacts of other clients, other tenants and shared mailboxes', async () => {
    h.dbState.contacts.push(
      contact({ contact_name_id: 'other-client', client_id: 'client-2', email: 'jdoe@acme.com' }),
      contact({ contact_name_id: 'other-tenant', tenant: 'tenant-2', email: 'jdoe@acme.com' }),
      contact({ contact_name_id: 'mailbox', email: 'jdoe@acme.com', contact_kind: 'shared_mailbox' }),
    );
    expect(await match('CORP\\jdoe')).toBeNull();
  });

  it('ignores a mapping whose contact belongs to another client', async () => {
    h.dbState.contacts.push(contact({ contact_name_id: 'c-other', client_id: 'client-2' }));
    h.dbState.tenant_external_entity_mappings.push({
      tenant: TENANT,
      integration_type: 'rmm:tacticalrmm',
      alga_entity_type: 'contact',
      external_realm_id: INTEGRATION,
      external_entity_id: 'jdoe',
      alga_entity_id: 'c-other',
    });
    expect(await match('CORP\\jdoe')).toBeNull();
  });

  it('ignores a mapping saved for another integration', async () => {
    h.dbState.contacts.push(contact({ contact_name_id: 'c1' }));
    h.dbState.tenant_external_entity_mappings.push({
      tenant: TENANT,
      integration_type: 'rmm:tacticalrmm',
      alga_entity_type: 'contact',
      external_realm_id: 'integration-2',
      external_entity_id: 'jdoe',
      alga_entity_id: 'c1',
    });
    expect(await match('CORP\\jdoe')).toBeNull();
  });
});

describe('isRmmContactAssignmentMode', () => {
  it('accepts the three modes and nothing else', () => {
    expect(isRmmContactAssignmentMode('off')).toBe(true);
    expect(isRmmContactAssignmentMode('suggest')).toBe(true);
    expect(isRmmContactAssignmentMode('auto')).toBe(true);
    expect(isRmmContactAssignmentMode('automatic')).toBe(false);
    expect(isRmmContactAssignmentMode(undefined)).toBe(false);
  });
});
