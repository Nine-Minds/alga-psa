/**
 * T074–T076, and the export half of T088 — contact locations through CSV.
 *
 * Export carries `work_arrangement`, a semicolon-joined `locations` and `primary_location`, and the
 * template advertises all three. Import resolves names against the contact's own client, marks the
 * primary, and refuses a row whose location it cannot place — naming the location, and leaving the
 * other rows of the file alone, because a quietly dropped site is the data loss this feature exists
 * to prevent. A row with locations but no client is refused for the same reason.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { parseCSV } from '@alga-psa/core';
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
  exportContactsToCSV,
  generateContactCSVTemplate,
  importContactsFromCSV,
} from '../../../../packages/clients/src/actions/contact-actions/contactActions';
import { getContactsByClient } from '../../../../packages/clients/src/actions/queryActions';
import { buildContactCsvImportRows } from '../../../../packages/clients/src/lib/contactCsvImportPayload';

const HOOK_TIMEOUT = 240_000;

let db: Knex;
let clientId: string;
let clientName: string;
let warehouseId: string;
let headOfficeId: string;

const scoped = () => tenantDb(db, state.tenant);

function uniqueEmail(prefix: string) {
  return `${prefix}-${uuidv4().slice(0, 8)}@example.com`;
}

async function linksOf(contactId: string) {
  const rows = await scoped().table('contact_locations as cl')
    .join('client_locations as loc', function () {
      this.on('loc.location_id', 'cl.location_id').andOn('loc.tenant', 'cl.tenant');
    })
    .where('cl.contact_name_id', contactId)
    .select('loc.location_name', 'cl.is_primary') as Array<{ location_name: string; is_primary: boolean }>;
  return rows
    .map((row) => `${row.location_name}${row.is_primary ? '*' : ''}`)
    .sort();
}

describe('contact locations through CSV (integration)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    state.knex = db;

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of a seeded internal user for the contact CSV locations suite')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    state.tenant = seededUser.tenant;
    state.userId = seededUser.user_id;

    clientId = uuidv4();
    clientName = `CSV Locations Client ${clientId.slice(0, 8)}`;
    await scoped().table('clients').insert({
      tenant: state.tenant,
      client_id: clientId,
      client_name: clientName,
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
  }, HOOK_TIMEOUT);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('T075: resolves location names within the client and marks the primary', async () => {
    const email = uniqueEmail('csv-linked');
    const results = await importContactsFromCSV([
      {
        full_name: 'CSV Linked Contact',
        email,
        client_id: clientId,
        work_arrangement: 'hybrid',
        location_names: ['Warehouse', 'Head office'],
        primary_location_name: 'Warehouse',
      } as any,
    ], false);

    expect(results[0]?.success).toBe(true);
    const contactId = results[0]!.contact!.contact_name_id;
    expect(await linksOf(contactId)).toEqual(['Head office', 'Warehouse*']);
    const stored = await scoped().table('contacts').where({ contact_name_id: contactId }).first('work_arrangement');
    expect(stored.work_arrangement).toBe('hybrid');
  }, HOOK_TIMEOUT);

  it('T075: an unknown location fails that row by name and leaves the others alone', async () => {
    const goodEmail = uniqueEmail('csv-good');
    const badEmail = uniqueEmail('csv-bad');
    const results = await importContactsFromCSV([
      {
        full_name: 'CSV Good Row',
        email: goodEmail,
        client_id: clientId,
        location_names: ['Head office'],
      } as any,
      {
        full_name: 'CSV Bad Row',
        email: badEmail,
        client_id: clientId,
        location_names: ['Moon Base'],
      } as any,
    ], false);

    expect(results[0]?.success).toBe(true);
    expect(results[1]?.success).toBe(false);
    expect(results[1]?.message).toMatch(/Moon Base/);

    expect(await linksOf(results[0]!.contact!.contact_name_id)).toEqual(['Head office*']);
    expect(await scoped().table('contacts').where({ email: badEmail }).first()).toBeUndefined();
  }, HOOK_TIMEOUT);

  it('T076: locations with no client on the row are refused', async () => {
    const email = uniqueEmail('csv-noclient');
    const results = await importContactsFromCSV([
      {
        full_name: 'CSV Clientless Row',
        email,
        client_id: null,
        location_names: ['Warehouse'],
      } as any,
    ], false);

    expect(results[0]?.success).toBe(false);
    expect(results[0]?.message).toMatch(/client/i);
    expect(await scoped().table('contacts').where({ email }).first()).toBeUndefined();
  }, HOOK_TIMEOUT);

  it('T074: export writes the arrangement, the joined names and the primary; the template advertises them', async () => {
    const email = uniqueEmail('csv-export');
    const [created] = await importContactsFromCSV([
      {
        full_name: 'CSV Export Contact',
        email,
        client_id: clientId,
        work_arrangement: 'on_site',
        location_names: ['Warehouse', 'Head office'],
        primary_location_name: 'Warehouse',
      } as any,
    ], false);
    expect(created?.success).toBe(true);

    // Read back through the list loader, so the export sees exactly what the page does.
    const contacts = await getContactsByClient(clientId, 'all');
    const exported = contacts.filter((contact) => contact.email === email);
    expect(exported).toHaveLength(1);

    const csv = await exportContactsToCSV(exported, [{ client_id: clientId, client_name: clientName } as any], {});
    const [headers, values] = parseCSV<string[]>(csv);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    expect(row.work_arrangement).toBe('on_site');
    // Semicolon-joined so a name may contain a comma; the primary is named separately.
    expect(row.locations.split(';').map((name) => name.trim()).sort()).toEqual(['Head office', 'Warehouse']);
    expect(row.primary_location).toBe('Warehouse');

    const template = await generateContactCSVTemplate();
    expect(template.split('\n')[0]).toContain('work_arrangement');
    expect(template.split('\n')[0]).toContain('locations');
    expect(template.split('\n')[0]).toContain('primary_location');
  }, HOOK_TIMEOUT);

  it('T074: an exported file imports back into the same links', async () => {
    const email = uniqueEmail('csv-roundtrip');
    const mappings = [
      { csvHeader: 'full_name', contactField: 'full_name' },
      { csvHeader: 'email', contactField: 'email' },
      { csvHeader: 'client', contactField: 'client_id' },
      { csvHeader: 'work_arrangement', contactField: 'work_arrangement' },
      { csvHeader: 'locations', contactField: 'locations' },
      { csvHeader: 'primary_location', contactField: 'primary_location' },
    ] as any[];

    const rows = buildContactCsvImportRows(
      [{
        full_name: 'CSV Round Trip',
        email,
        client: clientName,
        work_arrangement: 'Hybrid',
        locations: 'Warehouse; Head office',
        primary_location: 'Head office',
      } as any],
      mappings,
      [{ client_id: clientId, client_name: clientName }],
    );

    const results = await importContactsFromCSV(rows as any, false);
    expect(results[0]?.success).toBe(true);
    expect(await linksOf(results[0]!.contact!.contact_name_id)).toEqual(['Head office*', 'Warehouse']);
    const stored = await scoped().table('contacts').where({ email }).first('work_arrangement');
    expect(stored.work_arrangement).toBe('hybrid');
    void warehouseId;
    void headOfficeId;
  }, HOOK_TIMEOUT);
});
