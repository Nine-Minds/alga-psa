/**
 * T041–T044 — the one ticket-location autofill rule, against the real write.
 *
 * `TicketModel.createTicket` is where every creation path (REST v1, mobile, the portal, inbound
 * email, recurring generation, the MSP forms) inherits the rule, so the stored `location_id` is
 * what these assert: `undefined` asks the requester, `null` stays none, an explicit id is kept,
 * a remote contact gets nothing, an unlinked one falls back to the client default, and a contact
 * at another client still fails the same-client check instead of attaching a foreign site.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

vi.mock('@alga-psa/analytics', () => ({
  captureAnalytics: vi.fn(),
  ServerAnalyticsTracker: class {},
  analytics: { capture: vi.fn() },
}));

import { tenantDb } from '@alga-psa/db';
import { silentTicketCreation } from '../../../../shared/lib/tickets/ticketLifecycleEvents';
import { TicketModel } from '../../../../shared/models/ticketModel';

const HOOK_TIMEOUT = 240_000;

let db: Knex;
let tenantId: string;
let userId: string;
let boardId: string;
let statusId: string;
let priorityId: string;

/** Acme: a default head office plus a warehouse. Globex is the "other client". */
let acmeId: string;
let acmeHeadOfficeId: string;
let acmeWarehouseId: string;
let globexId: string;
let globexDepotId: string;

let warehouseContactId: string;
let remoteContactId: string;
let unlinkedContactId: string;
let globexContactId: string;

const scoped = () => tenantDb(db, tenantId);

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

async function insertLocation(clientId: string, name: string, isDefault: boolean, isActive = true): Promise<string> {
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
    is_active: isActive,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return locationId;
}

async function insertContact(
  clientId: string,
  name: string,
  workArrangement: string | null = null,
): Promise<string> {
  const contactId = uuidv4();
  await scoped().table('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    full_name: `${name} ${contactId.slice(0, 8)}`,
    client_id: clientId,
    email: `autofill-${contactId.slice(0, 8)}@example.com`,
    work_arrangement: workArrangement,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return contactId;
}

async function link(contactId: string, locationId: string, isPrimary: boolean): Promise<void> {
  await scoped().table('contact_locations').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    location_id: locationId,
    is_primary: isPrimary,
    created_at: db.fn.now(),
  });
}

type CreateInput = Parameters<typeof TicketModel.createTicket>[0];

/** The stored row, because the create output does not carry `location_id`. */
async function createTicket(input: Partial<CreateInput>): Promise<Record<string, any>> {
  const created = await db.transaction(async (trx) => {
    const output = await TicketModel.createTicket(
      {
        title: `Autofill ${uuidv4().slice(0, 8)}`,
        client_id: acmeId,
        board_id: boardId,
        status_id: statusId,
        priority_id: priorityId,
        entered_by: userId,
        ...input,
      } as CreateInput,
      tenantId,
      trx,
      {},
      silentTicketCreation('integration test asserts the stored row, not the event'),
      undefined,
      userId,
    );
    return output;
  });
  return scoped().table('tickets').where({ ticket_id: created.ticket_id }).first();
}

describe('ticket location autofill from the contact (integration)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of a seeded internal user for the autofill suite')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    tenantId = seededUser.tenant;
    userId = seededUser.user_id;

    boardId = uuidv4();
    statusId = uuidv4();
    priorityId = uuidv4();
    await scoped().table('boards').insert({
      tenant: tenantId,
      board_id: boardId,
      board_name: `Autofill Board ${boardId.slice(0, 8)}`,
      is_default: false,
      is_inactive: false,
      display_order: 999,
    });
    await scoped().table('statuses').insert({
      tenant: tenantId,
      status_id: statusId,
      board_id: boardId,
      name: 'Open',
      status_type: 'ticket',
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: userId,
    });
    await scoped().table('priorities').insert({
      tenant: tenantId,
      priority_id: priorityId,
      priority_name: `Autofill Priority ${priorityId.slice(0, 8)}`,
      item_type: 'ticket',
      color: '#3B82F6',
      order_number: 99,
      created_by: userId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    acmeId = await insertClient('Autofill Acme');
    acmeHeadOfficeId = await insertLocation(acmeId, 'Head office', true);
    acmeWarehouseId = await insertLocation(acmeId, 'Warehouse', false);
    globexId = await insertClient('Autofill Globex');
    globexDepotId = await insertLocation(globexId, 'Depot', true);

    warehouseContactId = await insertContact(acmeId, 'Warehouse Worker', 'on_site');
    await link(warehouseContactId, acmeWarehouseId, true);
    remoteContactId = await insertContact(acmeId, 'Remote Worker', 'remote');
    await link(remoteContactId, acmeWarehouseId, true);
    unlinkedContactId = await insertContact(acmeId, 'Unlinked Worker');
    globexContactId = await insertContact(globexId, 'Globex Worker');
    await link(globexContactId, globexDepotId, true);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('T041: stores the contact\'s primary location when nobody named one', async () => {
    const ticket = await createTicket({ contact_id: warehouseContactId });
    expect(ticket.location_id).toBe(acmeWarehouseId);
    expect(ticket.contact_name_id).toBe(warehouseContactId);
  }, HOOK_TIMEOUT);

  it('T042: keeps an explicit null, keeps an explicit location, and leaves a contactless ticket alone', async () => {
    const none = await createTicket({ contact_id: warehouseContactId, location_id: null });
    expect(none.location_id).toBeNull();

    const explicit = await createTicket({ contact_id: warehouseContactId, location_id: acmeHeadOfficeId });
    expect(explicit.location_id).toBe(acmeHeadOfficeId);

    const noContact = await createTicket({});
    expect(noContact.location_id ?? null).toBeNull();
  }, HOOK_TIMEOUT);

  it('T043: a remote contact gets no location; an unlinked one gets the client default', async () => {
    const remote = await createTicket({ contact_id: remoteContactId });
    expect(remote.location_id ?? null).toBeNull();

    const unlinked = await createTicket({ contact_id: unlinkedContactId });
    expect(unlinked.location_id).toBe(acmeHeadOfficeId);
  }, HOOK_TIMEOUT);

  it('T043: an inactive-only link falls through to the client default', async () => {
    const inactiveSiteId = await insertLocation(acmeId, 'Old depot', false, false);
    const contactId = await insertContact(acmeId, 'Old Depot Worker');
    await link(contactId, inactiveSiteId, true);

    const ticket = await createTicket({ contact_id: contactId });
    expect(ticket.location_id).toBe(acmeHeadOfficeId);
  }, HOOK_TIMEOUT);

  it('T044: a contact at another client is refused, not silently attached', async () => {
    await expect(createTicket({ contact_id: globexContactId })).rejects.toThrow(/location/i);

    // And the mismatch is about the clients, not about the autofill: naming the same foreign
    // location by hand fails identically.
    await expect(createTicket({ contact_id: globexContactId, location_id: globexDepotId }))
      .rejects.toThrow(/location/i);
  }, HOOK_TIMEOUT);
});
