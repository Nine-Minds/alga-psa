/**
 * T069, T070, T072, T088 — the REST surface for contact locations, against a live schema.
 *
 * `POST /api/v1/contacts` refuses a location of another client and a second primary with the
 * schema/model errors the route maps to 400; `PUT` on a client change comes back with `locations:
 * []`; `GET /api/v1/clients/{id}/locations` rows carry `contact_count`; and the search and export
 * reads carry `work_arrangement` and the links like the list does.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { ContactService } from '@/lib/api/services/ContactService';
import { ClientService } from '@/lib/api/services/ClientService';
import { createContactSchema, updateContactSchema } from '@/lib/api/schemas/contact';

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

const HOOK_TIMEOUT = 240_000;

let db: Knex;
let tenantId: string;
let userId: string;
let acmeId: string;
let acmeHeadOfficeId: string;
let acmeWarehouseId: string;
let globexId: string;
let globexDepotId: string;

const scoped = () => tenantDb(db, tenantId);
const context = () => ({ tenant: tenantId, userId }) as any;

function contacts(): ContactService {
  const service = new ContactService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

function clients(): ClientService {
  const service = new ClientService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

async function insertClient(name: string): Promise<string> {
  const clientId = uuidv4();
  await scoped().table('clients').insert({
    tenant: tenantId,
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
    tenant: tenantId,
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

function uniqueEmail(prefix: string) {
  return `${prefix}-${uuidv4().slice(0, 8)}@example.com`;
}

describe('REST contact locations (integration)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of a seeded internal user for the REST contact locations suite')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    tenantId = seededUser.tenant;
    userId = seededUser.user_id;

    acmeId = await insertClient('REST Acme');
    acmeHeadOfficeId = await insertLocation(acmeId, 'Head office', true);
    acmeWarehouseId = await insertLocation(acmeId, 'Warehouse', false);
    globexId = await insertClient('REST Globex');
    globexDepotId = await insertLocation(globexId, 'Depot', true);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('T069: a location of another client is refused, and two primaries never reach the model', async () => {
    const payload = createContactSchema.parse({
      full_name: 'REST Refused Contact',
      email: uniqueEmail('rest-refused'),
      client_id: acmeId,
      locations: [{ location_id: globexDepotId, is_primary: true }],
    });

    // The route maps the model's refusals to 400 through ValidationError.
    await expect(contacts().create(payload as any, context()))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/validation/i) });

    const twoPrimariesEmail = uniqueEmail('rest-two-primaries');
    await expect(contacts().create(createContactSchema.parse({
      full_name: 'REST Two Primaries',
      email: twoPrimariesEmail,
      client_id: acmeId,
      locations: [
        { location_id: acmeWarehouseId, is_primary: true },
        { location_id: acmeHeadOfficeId, is_primary: true },
      ],
    }) as any, context())).rejects.toMatchObject({ statusCode: 400 });

    // Both refusals took the contact with them.
    expect(await scoped().table('contacts').where({ email: twoPrimariesEmail }).first()).toBeUndefined();
    expect(await scoped().table('contacts').where({ email: payload.email }).first()).toBeUndefined();
  }, HOOK_TIMEOUT);

  it('T069/T088: a created contact answers with its links, and search and export carry them', async () => {
    const email = uniqueEmail('rest-linked');
    const created = await contacts().create(createContactSchema.parse({
      full_name: 'REST Linked Contact',
      email,
      client_id: acmeId,
      work_arrangement: 'hybrid',
      locations: [
        { location_id: acmeWarehouseId, is_primary: true },
        { location_id: acmeHeadOfficeId, is_primary: false },
      ],
    }) as any, context());

    expect(created.work_arrangement).toBe('hybrid');
    expect((created.locations ?? []).map((location) => location.location_id).sort())
      .toEqual([acmeHeadOfficeId, acmeWarehouseId].sort());
    expect((created.locations ?? []).find((location) => location.is_primary)?.location_name).toBe('Warehouse');

    const found = await contacts().search({ query: 'REST Linked Contact', fields: ['full_name'] } as any, context());
    const searched = found.find((contact) => contact.contact_name_id === created.contact_name_id);
    expect(searched?.work_arrangement).toBe('hybrid');
    expect((searched?.locations ?? []).map((location) => location.location_name).sort())
      .toEqual(['Head office', 'Warehouse']);

    const exported = await contacts().exportContacts({ client_id: acmeId } as any, 'json', context());
    const exportedRows = JSON.parse(exported) as Array<Record<string, any>>;
    const exportedRow = exportedRows.find((contact) => contact.contact_name_id === created.contact_name_id);
    expect(exportedRow?.work_arrangement).toBe('hybrid');
    expect((exportedRow?.locations ?? []).find((location: any) => location.is_primary)?.location_name)
      .toBe('Warehouse');
  }, HOOK_TIMEOUT);

  it('T070: a client change answers with no links at all', async () => {
    const created = await contacts().create(createContactSchema.parse({
      full_name: 'REST Moved Contact',
      email: uniqueEmail('rest-moved'),
      client_id: acmeId,
      locations: [{ location_id: acmeWarehouseId, is_primary: true }],
    }) as any, context());

    const moved = await contacts().update(
      created.contact_name_id,
      updateContactSchema.parse({ client_id: globexId }) as any,
      context(),
    );

    expect(moved.client_id).toBe(globexId);
    expect(moved.locations).toEqual([]);
    expect(await scoped().table('contact_locations').where({ contact_name_id: created.contact_name_id }))
      .toEqual([]);
  }, HOOK_TIMEOUT);

  it('T072: location rows carry the number of contacts working there', async () => {
    const first = await contacts().create(createContactSchema.parse({
      full_name: 'REST Counted One',
      email: uniqueEmail('rest-count-1'),
      client_id: acmeId,
      locations: [{ location_id: acmeWarehouseId, is_primary: true }],
    }) as any, context());
    const second = await contacts().create(createContactSchema.parse({
      full_name: 'REST Counted Two',
      email: uniqueEmail('rest-count-2'),
      client_id: acmeId,
      locations: [{ location_id: acmeWarehouseId, is_primary: true }],
    }) as any, context());

    const locations = await clients().getClientLocations(acmeId, context());
    const byId = new Map(locations.map((location) => [location.location_id, location as any]));
    const warehouseCount = Number(byId.get(acmeWarehouseId)?.contact_count ?? 0);
    expect(warehouseCount).toBeGreaterThanOrEqual(2);

    // Unlinking one person moves the count by exactly one.
    await contacts().update(first.contact_name_id, updateContactSchema.parse({ locations: [] }) as any, context());
    const after = await clients().getClientLocations(acmeId, context());
    const afterCount = Number(
      after.find((location) => location.location_id === acmeWarehouseId)?.contact_count ?? 0,
    );
    expect(afterCount).toBe(warehouseCount - 1);
    void second;
  }, HOOK_TIMEOUT);
});
