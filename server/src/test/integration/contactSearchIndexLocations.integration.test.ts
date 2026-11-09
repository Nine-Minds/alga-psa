/**
 * T089, T091 — what the search index knows about where a contact works.
 *
 * The indexer loads the links per batch like the phone rows: the primary name joins the subtitle
 * after the client name, every linked name and city joins the body, and a remote worker adds the
 * word the operator actually types. Renaming or deactivating a location changes the linked
 * contacts' documents, which is why both location events are among the indexer's source events —
 * a renamed site that still answered to its old name is a search result that lies.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { contactIndexer } from '@alga-psa/search/indexers/contact';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const HOOK_TIMEOUT = 240_000;

let db: Knex;
let tenantId: string;
let clientId: string;
let clientName: string;
let warehouseId: string;
let headOfficeId: string;
let contactId: string;
let remoteContactId: string;

const scoped = () => tenantDb(db, tenantId);

async function insertLocation(name: string, city: string, isDefault: boolean): Promise<string> {
  const locationId = uuidv4();
  await scoped().table('client_locations').insert({
    tenant: tenantId,
    location_id: locationId,
    client_id: clientId,
    location_name: name,
    address_line1: `${name} Road 1`,
    city,
    country_code: 'US',
    country_name: 'United States',
    is_default: isDefault,
    is_active: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return locationId;
}

async function insertContact(name: string, workArrangement: string | null): Promise<string> {
  const id = uuidv4();
  await scoped().table('contacts').insert({
    tenant: tenantId,
    contact_name_id: id,
    full_name: name,
    client_id: clientId,
    email: `index-${id.slice(0, 8)}@example.com`,
    role: 'Dispatcher',
    work_arrangement: workArrangement,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return id;
}

async function link(contact: string, location: string, isPrimary: boolean): Promise<void> {
  await scoped().table('contact_locations').insert({
    tenant: tenantId,
    contact_name_id: contact,
    location_id: location,
    is_primary: isPrimary,
    created_at: db.fn.now(),
  });
}

describe('contact search index and locations (integration)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of a seeded tenant for the contact search index suite')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    tenantId = seededUser.tenant;

    clientId = uuidv4();
    clientName = `Index Client ${clientId.slice(0, 8)}`;
    await scoped().table('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: clientName,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    warehouseId = await insertLocation('Warehouse', 'Leeds', false);
    headOfficeId = await insertLocation('Head office', 'Emerald City', true);

    contactId = await insertContact('Indexed Warehouse Worker', 'hybrid');
    await link(contactId, warehouseId, true);
    await link(contactId, headOfficeId, false);

    remoteContactId = await insertContact('Indexed Remote Worker', 'remote');
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('T089: the subtitle names the primary site and the body carries every name and city', async () => {
    const doc = await contactIndexer.loadOne(db, tenantId, contactId);

    expect(doc).toBeTruthy();
    expect(doc!.subtitle).toContain(clientName);
    expect(doc!.subtitle!.endsWith('Warehouse')).toBe(true);
    for (const token of ['Warehouse', 'Leeds', 'Head office', 'Emerald City']) {
      expect(doc!.body).toContain(token);
    }
    expect(doc!.acl?.requiredPermission).toBe('contact:read');
  }, HOOK_TIMEOUT);

  it('T089: a remote worker is findable by the word the operator types', async () => {
    const doc = await contactIndexer.loadOne(db, tenantId, remoteContactId);

    expect(doc!.body).toContain('Remote');
    // Nothing invents a site for someone who works from home.
    expect(doc!.subtitle).not.toContain('Warehouse');
  }, HOOK_TIMEOUT);

  it('T091: renaming the site renames it in the linked contact\'s document', async () => {
    await scoped().table('client_locations')
      .where({ location_id: warehouseId })
      .update({ location_name: 'Depot', updated_at: db.fn.now() });

    const doc = await contactIndexer.loadOne(db, tenantId, contactId);
    expect(doc!.subtitle).toContain('Depot');
    expect(doc!.subtitle).not.toContain('Warehouse');
    expect(doc!.body).toContain('Depot');
    expect(doc!.body).not.toContain('Warehouse');

    await scoped().table('client_locations')
      .where({ location_id: warehouseId })
      .update({ location_name: 'Warehouse', updated_at: db.fn.now() });
  }, HOOK_TIMEOUT);

  it('T091: both location events are the indexer\'s own, so the cascade has something to run on', () => {
    // The subscriber turns these into a re-index of every contact linked to the location; without
    // them on the indexer the cascade would never be dispatched.
    expect(contactIndexer.sourceEvents).toEqual(expect.arrayContaining([
      'CLIENT_LOCATION_UPDATED',
      'CLIENT_LOCATION_DEACTIVATED',
    ]));
  });

  it('T091: deactivating the site keeps the link in the document rather than dropping it', async () => {
    await scoped().table('client_locations')
      .where({ location_id: headOfficeId })
      .update({ is_active: false, updated_at: db.fn.now() });

    const doc = await contactIndexer.loadOne(db, tenantId, contactId);
    // The person still works there as far as the record goes; search must not quietly forget it.
    expect(doc!.body).toContain('Head office');

    await scoped().table('client_locations')
      .where({ location_id: headOfficeId })
      .update({ is_active: true, updated_at: db.fn.now() });
  }, HOOK_TIMEOUT);
});
