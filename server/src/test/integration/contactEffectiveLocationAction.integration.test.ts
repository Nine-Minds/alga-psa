/**
 * T045 — `getContactEffectiveLocation`, the action the ticket forms pre-fill from.
 *
 * It answers with the resolved location *and* the links behind it (so the form can show the
 * requester's other sites), and it is an MSP-only read: a portal user and an internal user without
 * the contact read permission both get a refusal rather than someone else's address book.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const state = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
  user: null as any,
  permitted: true,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: state.knex, tenant: state.tenant })),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(state.user, { tenant: state.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) => action(state.user, { tenant: state.tenant }, ...args),
  hasPermission: vi.fn(async () => state.permitted),
}));

import { tenantDb } from '@alga-psa/db';
import {
  getContactEffectiveLocation,
  getContactsByClient,
} from '../../../../packages/tickets/src/actions/clientLookupActions';

const HOOK_TIMEOUT = 240_000;

let db: Knex;
let clientId: string;
let warehouseId: string;
let headOfficeId: string;
let contactId: string;

const scoped = () => tenantDb(db, state.tenant);

describe('getContactEffectiveLocation (integration)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    state.knex = db;

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of a seeded internal user for the effective-location action')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    state.tenant = seededUser.tenant;
    state.user = {
      user_id: seededUser.user_id,
      tenant: seededUser.tenant,
      user_type: 'internal',
      roles: [],
    };

    clientId = uuidv4();
    await scoped().table('clients').insert({
      tenant: state.tenant,
      client_id: clientId,
      client_name: `Effective Location Client ${clientId.slice(0, 8)}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const insertLocation = async (name: string, isDefault: boolean) => {
      const locationId = uuidv4();
      await scoped().table('client_locations').insert({
        tenant: state.tenant,
        location_id: locationId,
        client_id: clientId,
        location_name: name,
        address_line1: `${name} Road 1`,
        city: 'Emerald City',
        country_code: 'US',
        country_name: 'United States',
        is_default: isDefault,
        is_active: true,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      return locationId;
    };
    headOfficeId = await insertLocation('Head office', true);
    warehouseId = await insertLocation('Warehouse', false);

    contactId = uuidv4();
    await scoped().table('contacts').insert({
      tenant: state.tenant,
      contact_name_id: contactId,
      full_name: `Effective Location Contact ${contactId.slice(0, 8)}`,
      client_id: clientId,
      email: `effective-${contactId.slice(0, 8)}@example.com`,
      work_arrangement: 'hybrid',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await scoped().table('contact_locations').insert([
      { tenant: state.tenant, contact_name_id: contactId, location_id: warehouseId, is_primary: true, created_at: db.fn.now() },
      { tenant: state.tenant, contact_name_id: contactId, location_id: headOfficeId, is_primary: false, created_at: db.fn.now() },
    ]);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('T045: answers with the resolved primary, every link and the work arrangement', async () => {
    state.permitted = true;
    const effective = await getContactEffectiveLocation(contactId);

    expect(effective.locationId).toBe(warehouseId);
    expect(effective.workArrangement).toBe('hybrid');
    expect(effective.locations.map((location) => location.location_id).sort())
      .toEqual([headOfficeId, warehouseId].sort());
    expect(effective.locations.find((location) => location.is_primary)?.location_name).toBe('Warehouse');
  }, HOOK_TIMEOUT);

  it('T039: the picker page attaches every primary location in one batched read', async () => {
    state.permitted = true;
    // A second linked person, so "one read per page" is a claim about the page and not about a row.
    const secondId = uuidv4();
    await scoped().table('contacts').insert({
      tenant: state.tenant,
      contact_name_id: secondId,
      full_name: `Second Picker Contact ${secondId.slice(0, 8)}`,
      client_id: clientId,
      email: `picker-${secondId.slice(0, 8)}@example.com`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await scoped().table('contact_locations').insert({
      tenant: state.tenant,
      contact_name_id: secondId,
      location_id: headOfficeId,
      is_primary: true,
      created_at: db.fn.now(),
    });

    const linkReads: string[] = [];
    const listener = (query: { sql?: string }) => {
      if (query?.sql?.includes('contact_locations')) linkReads.push(query.sql);
    };
    db.on('query', listener);
    let rows;
    try {
      rows = await getContactsByClient(clientId, 'all');
    } finally {
      db.removeListener('query', listener);
    }

    expect(linkReads).toHaveLength(1);
    const byId = new Map(rows!.map((contact) => [contact.contact_name_id, contact]));
    expect(byId.get(contactId)?.primaryLocation).toEqual(
      expect.objectContaining({ location_id: warehouseId, location_name: 'Warehouse' }),
    );
    expect(byId.get(secondId)?.primaryLocation).toEqual(
      expect.objectContaining({ location_id: headOfficeId, location_name: 'Head office' }),
    );
  }, HOOK_TIMEOUT);

  it('T045: refuses a portal user and an internal user without contact read', async () => {
    state.permitted = true;
    const internal = state.user;
    state.user = { ...internal, user_type: 'client' };
    await expect(getContactEffectiveLocation(contactId)).rejects.toThrow(/internal-only/);

    state.user = internal;
    state.permitted = false;
    await expect(getContactEffectiveLocation(contactId)).rejects.toThrow(/cannot read contact/);
    state.permitted = true;
  }, HOOK_TIMEOUT);
});
