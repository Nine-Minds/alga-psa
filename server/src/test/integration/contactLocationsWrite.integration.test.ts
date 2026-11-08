/**
 * T012–T015 — the contact write path with locations, against a live schema.
 *
 * The link set and the person land in one transaction, so a cross-client location takes the
 * contact down with it. On update, `locations` omitted leaves the links alone, `[]` removes them,
 * a new set replaces them, and a client change removes every link while reporting how many went —
 * including the case where the move and a new selection arrive in the same call.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const state = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
  userId: '',
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action({ user_id: state.userId, tenant: state.tenant, user_type: 'internal' }, { tenant: state.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action({ user_id: state.userId, tenant: state.tenant, user_type: 'internal' }, { tenant: state.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: state.knex, tenant: state.tenant })),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { tenantDb } from '@alga-psa/db';
import {
  addContact,
  getContactLocationCount,
  updateContact,
} from '../../../../packages/clients/src/actions/contact-actions/contactActions';

const HOOK_TIMEOUT = 240_000;

let db: Knex;
let acmeId: string;
let acmeHeadOfficeId: string;
let acmeWarehouseId: string;
let globexId: string;
let globexDepotId: string;

const scoped = () => tenantDb(db, state.tenant);

async function insertClient(name: string): Promise<string> {
  const clientId = uuidv4();
  await scoped().table('clients').insert({
    tenant: state.tenant,
    client_id: clientId,
    client_name: `${name} ${clientId.slice(0, 8)}`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return clientId;
}

async function insertLocation(clientId: string, name: string, isDefault: boolean): Promise<string> {
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
}

async function linksOf(contactId: string): Promise<Array<{ location_id: string; is_primary: boolean }>> {
  return scoped().table('contact_locations')
    .where({ contact_name_id: contactId })
    .orderBy('location_id')
    .select('location_id', 'is_primary');
}

function uniqueEmail(prefix: string) {
  return `${prefix}-${uuidv4().slice(0, 8)}@example.com`;
}

describe('contact locations write path (integration)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    state.knex = db;

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of a seeded internal user for the contact locations write suite')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    state.tenant = seededUser.tenant;
    state.userId = seededUser.user_id;

    acmeId = await insertClient('Links Acme');
    acmeHeadOfficeId = await insertLocation(acmeId, 'Head office', true);
    acmeWarehouseId = await insertLocation(acmeId, 'Warehouse', false);
    globexId = await insertClient('Links Globex');
    globexDepotId = await insertLocation(globexId, 'Depot', true);
  }, HOOK_TIMEOUT);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('T012: creates the contact and its links in one transaction', async () => {
    const result = await addContact({
      full_name: 'Linked On Create',
      email: uniqueEmail('linked-create'),
      client_id: acmeId,
      work_arrangement: 'hybrid',
      locations: [
        { location_id: acmeWarehouseId, is_primary: true },
        { location_id: acmeHeadOfficeId, is_primary: false },
      ],
    } as any);

    expect(result.success).toBe(true);
    const contactId = (result as any).contact.contact_name_id;
    expect(await linksOf(contactId)).toEqual(expect.arrayContaining([
      { location_id: acmeWarehouseId, is_primary: true },
      { location_id: acmeHeadOfficeId, is_primary: false },
    ]));
    const stored = await scoped().table('contacts').where({ contact_name_id: contactId }).first('work_arrangement');
    expect(stored.work_arrangement).toBe('hybrid');
    expect(await getContactLocationCount(contactId)).toBe(2);
  }, HOOK_TIMEOUT);

  it('T012: a cross-client location rolls the contact back too', async () => {
    const email = uniqueEmail('mismatch-create');
    const result = await addContact({
      full_name: 'Refused On Create',
      email,
      client_id: acmeId,
      locations: [{ location_id: globexDepotId, is_primary: true }],
    } as any);

    expect(result.success).toBe(false);
    expect((result as any).error).toMatch(/location/i);
    // Nothing of the person survived the refusal.
    expect(await scoped().table('contacts').where({ email }).first()).toBeUndefined();
  }, HOOK_TIMEOUT);

  it('T013: omitted leaves the links, [] removes them, a new set replaces them', async () => {
    const created = await addContact({
      full_name: 'Edited Links',
      email: uniqueEmail('edit-links'),
      client_id: acmeId,
      locations: [{ location_id: acmeWarehouseId, is_primary: true }],
    } as any);
    const contactId = (created as any).contact.contact_name_id;

    // Omitted: a save that never mentions locations leaves them exactly as they were.
    await updateContact({ contact_name_id: contactId, role: 'Dispatcher' } as any);
    expect(await linksOf(contactId)).toEqual([{ location_id: acmeWarehouseId, is_primary: true }]);

    // A new set replaces rather than appends, and the lone link is the primary one.
    const replaced = await updateContact({
      contact_name_id: contactId,
      locations: [{ location_id: acmeHeadOfficeId, is_primary: true }],
    } as any);
    expect((replaced as any).locations.map((location: any) => location.location_id)).toEqual([acmeHeadOfficeId]);
    expect(await linksOf(contactId)).toEqual([{ location_id: acmeHeadOfficeId, is_primary: true }]);

    // [] is the operator saying "none".
    const cleared = await updateContact({ contact_name_id: contactId, locations: [] } as any);
    expect((cleared as any).locations).toEqual([]);
    expect(await linksOf(contactId)).toEqual([]);
  }, HOOK_TIMEOUT);

  it('T014: a client change removes every link and reports the count', async () => {
    const created = await addContact({
      full_name: 'Moved Away',
      email: uniqueEmail('moved-away'),
      client_id: acmeId,
      locations: [
        { location_id: acmeWarehouseId, is_primary: true },
        { location_id: acmeHeadOfficeId, is_primary: false },
      ],
    } as any);
    const contactId = (created as any).contact.contact_name_id;
    expect(await getContactLocationCount(contactId)).toBe(2);

    const moved = await updateContact({ contact_name_id: contactId, client_id: globexId } as any);

    expect((moved as any).removedLocationCount).toBe(2);
    expect((moved as any).locations).toEqual([]);
    expect(await linksOf(contactId)).toEqual([]);
    expect((moved as any).client_id).toBe(globexId);
  }, HOOK_TIMEOUT);

  it('T015: a move plus a new selection in one call writes only the new links', async () => {
    const created = await addContact({
      full_name: 'Moved And Relinked',
      email: uniqueEmail('moved-relinked'),
      client_id: acmeId,
      locations: [{ location_id: acmeWarehouseId, is_primary: true }],
    } as any);
    const contactId = (created as any).contact.contact_name_id;

    const moved = await updateContact({
      contact_name_id: contactId,
      client_id: globexId,
      locations: [{ location_id: globexDepotId, is_primary: true }],
    } as any);

    expect((moved as any).removedLocationCount).toBe(1);
    expect(await linksOf(contactId)).toEqual([{ location_id: globexDepotId, is_primary: true }]);
  }, HOOK_TIMEOUT);

  it('T015: naming the old client\'s location after a move is refused', async () => {
    const created = await addContact({
      full_name: 'Moved With Stale Link',
      email: uniqueEmail('moved-stale'),
      client_id: acmeId,
      locations: [{ location_id: acmeWarehouseId, is_primary: true }],
    } as any);
    const contactId = (created as any).contact.contact_name_id;

    const refused = await updateContact({
      contact_name_id: contactId,
      client_id: globexId,
      locations: [{ location_id: acmeWarehouseId, is_primary: true }],
    } as any);
    expect(JSON.stringify(refused)).toMatch(/location/i);

    // The whole update rolled back: the contact still belongs to its old client with its link.
    const stored = await scoped().table('contacts').where({ contact_name_id: contactId }).first('client_id');
    expect(stored.client_id).toBe(acmeId);
    expect(await linksOf(contactId)).toEqual([{ location_id: acmeWarehouseId, is_primary: true }]);
  }, HOOK_TIMEOUT);
});
