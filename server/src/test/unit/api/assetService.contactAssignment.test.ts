/**
 * REST AssetService contact assignment (portal manager scope): the assignee
 * must be a real person (not a shared mailbox) of the asset's effective client,
 * explicit null clears it, and moving the asset to another client clears it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const state: Record<string, Row[]> = { assets: [], contacts: [], client_locations: [] };
  const updates: Array<{ table: string; patch: Row }> = [];
  const inserts: Array<{ table: string; row: Row }> = [];

  class QB {
    private wheres: Array<Record<string, any>> = [];
    private notWheres: Array<Record<string, any>> = [];
    constructor(private readonly table: string) {}

    where(arg: any, op?: any, value?: any) {
      if (typeof arg === 'string') {
        // where('assets.col', value) or where('assets.col', 'ilike', value)
        const col = arg.split('.').pop()!;
        this.wheres.push({ [col]: value === undefined ? op : value });
      } else if (arg && typeof arg === 'object') {
        this.wheres.push(arg);
      }
      return this;
    }
    whereNot(arg: Record<string, any>) {
      this.notWheres.push(arg);
      return this;
    }
    private rows() {
      return (state[this.table] ?? []).filter(
        (row) =>
          this.wheres.every((w) => Object.entries(w).every(([k, v]) => row[k] === v)) &&
          !this.notWheres.some((w) => Object.entries(w).every(([k, v]) => row[k] === v))
      );
    }
    async first(..._cols: string[]) {
      const row = this.rows()[0];
      return row ? { ...row } : undefined;
    }
    update(patch: Row) {
      updates.push({ table: this.table, patch });
      const rows = this.rows();
      rows.forEach((row) => Object.assign(row, patch));
      const result: any = Promise.resolve(rows.length);
      result.returning = () => Promise.resolve(rows.map((row) => ({ ...row })));
      return result;
    }
    insert(row: Row) {
      inserts.push({ table: this.table, row });
      const stored = { asset_id: 'new-asset', ...row };
      (state[this.table] ??= []).push(stored);
      const result: any = Promise.resolve([stored]);
      result.returning = () => Promise.resolve([stored]);
      return result;
    }
  }

  const knex: any = (table: string) => new QB(table);
  knex.raw = (sql: string, bindings: unknown) => ({ sql, bindings });
  return { state, updates, inserts, knex };
});

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    tenantDb: (conn: any, tenant: string) => ({
      table: (table: string) => conn(table.split(' as ')[0]).where({ tenant }),
    }),
  };
});

vi.mock('server/src/lib/eventBus/publishers', () => ({ publishEvent: vi.fn(async () => undefined), publishWorkflowEvent: vi.fn(async () => undefined) }));

vi.mock('@alga-psa/assets/lib/assetAttributeWrites', () => ({
  resolveWritableAssetType: vi.fn(async () => null),
  resolveAttributeSchemaForWrite: vi.fn(async () => null),
  validateAttributesForWrite: vi.fn(() => []),
  attributesMergeExpression: vi.fn(() => ({ merged: true })),
  serializeAttributesForInsert: vi.fn((value: unknown) => JSON.stringify(value)),
}));

import { AssetService } from '../../../lib/api/services/AssetService';

const TENANT = 'tenant-1';
const CLIENT_A = 'client-a';
const CLIENT_B = 'client-b';
const CONTACT_A = 'contact-a';
const CONTACT_B = 'contact-b';
const MAILBOX_A = 'mailbox-a';
const ASSET_ID = 'asset-1';

const context = { tenant: TENANT, userId: 'user-1', db: h.knex } as any;
const UNAVAILABLE = 'Selected contact is not available for this client';

let service: AssetService;

beforeEach(() => {
  h.state.assets = [
    { tenant: TENANT, asset_id: ASSET_ID, client_id: CLIENT_A, asset_type: 'workstation', location_id: null, contact_name_id: CONTACT_A },
  ];
  h.state.contacts = [
    { tenant: TENANT, contact_name_id: CONTACT_A, client_id: CLIENT_A, contact_kind: 'person' },
    { tenant: TENANT, contact_name_id: CONTACT_B, client_id: CLIENT_B, contact_kind: 'person' },
    { tenant: TENANT, contact_name_id: MAILBOX_A, client_id: CLIENT_A, contact_kind: 'shared_mailbox' },
  ];
  h.state.client_locations = [];
  h.updates.length = 0;
  h.inserts.length = 0;
  service = new AssetService();
  vi.spyOn(service, 'getWithDetails').mockResolvedValue({ asset_id: ASSET_ID } as any);
  vi.spyOn(service, 'getById').mockResolvedValue({ asset_id: ASSET_ID } as any);
});

const baseCreate = {
  client_id: CLIENT_A,
  asset_type: 'workstation',
  asset_tag: 'WS-1',
  name: 'PC',
  status: 'active',
} as any;

describe('AssetService.create contact assignment', () => {
  it('stores a contact of the asset client', async () => {
    await service.create({ ...baseCreate, contact_name_id: CONTACT_A }, context);
    expect(h.inserts[0].row.contact_name_id).toBe(CONTACT_A);
  });

  it('rejects a contact of another client, a shared mailbox and an unknown contact', async () => {
    for (const contactId of [CONTACT_B, MAILBOX_A, 'missing-contact']) {
      await expect(service.create({ ...baseCreate, contact_name_id: contactId }, context)).rejects.toThrow(UNAVAILABLE);
    }
    expect(h.inserts).toHaveLength(0);
  });
});

describe('AssetService.update contact assignment', () => {
  it('assigns a valid contact', async () => {
    h.state.assets[0].contact_name_id = null;
    await service.update(ASSET_ID, { contact_name_id: CONTACT_A } as any, context);
    expect(h.state.assets[0].contact_name_id).toBe(CONTACT_A);
  });

  it('rejects a contact of another client, a shared mailbox and an unknown contact', async () => {
    for (const contactId of [CONTACT_B, MAILBOX_A, 'missing-contact']) {
      await expect(service.update(ASSET_ID, { contact_name_id: contactId } as any, context)).rejects.toThrow(UNAVAILABLE);
    }
    expect(h.state.assets[0].contact_name_id).toBe(CONTACT_A);
  });

  it('clears the assignee with an explicit null', async () => {
    await service.update(ASSET_ID, { contact_name_id: null } as any, context);
    expect(h.state.assets[0].contact_name_id).toBeNull();
  });

  it('clears the assignee when the client changes without a new contact', async () => {
    await service.update(ASSET_ID, { client_id: CLIENT_B } as any, context);
    expect(h.state.assets[0]).toMatchObject({ client_id: CLIENT_B, contact_name_id: null });
  });

  it('keeps the assignee when the client is unchanged or the update does not touch it', async () => {
    await service.update(ASSET_ID, { client_id: CLIENT_A } as any, context);
    expect(h.state.assets[0].contact_name_id).toBe(CONTACT_A);
    await service.update(ASSET_ID, { name: 'Renamed' } as any, context);
    expect(h.state.assets[0].contact_name_id).toBe(CONTACT_A);
  });

  it('validates a contact supplied with a client change against the new client', async () => {
    await expect(
      service.update(ASSET_ID, { client_id: CLIENT_B, contact_name_id: CONTACT_A } as any, context)
    ).rejects.toThrow(UNAVAILABLE);
    expect(h.state.assets[0].client_id).toBe(CLIENT_A);

    await service.update(ASSET_ID, { client_id: CLIENT_B, contact_name_id: CONTACT_B } as any, context);
    expect(h.state.assets[0]).toMatchObject({ client_id: CLIENT_B, contact_name_id: CONTACT_B });
  });
});
