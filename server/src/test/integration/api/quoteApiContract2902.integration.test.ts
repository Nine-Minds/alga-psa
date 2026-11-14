import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { NextRequest } from 'next/server';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

// alga-2026-0002902: the quote REST API dropped quote-item location_id, published
// the wrong create-body field names (notes/terms instead of internal_notes/
// terms_and_conditions, both silently stripped), rejected a negative unit_price
// with a bare min-0 error, and offered no way to archive a quote while DELETE
// refused drafts over their own activity rows. These tests drive the real
// controller handlers against real rows and pin every one of those behaviours.

let testDb: Knex;
vi.mock('@/lib/db/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/db')>();
  return {
    ...actual,
    getConnection: vi.fn(async () => testDb),
  };
});

const { ApiQuoteController } = await import('@/lib/api/controllers/ApiQuoteController');

let db: Knex;
const tenantsToCleanup = new Set<string>();

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'quote_activities').del();
  await tenantTable(tenantId, 'quote_items').del();
  await tenantTable(tenantId, 'quotes').del();
  await tenantTable(tenantId, 'next_number').where({ entity_type: 'QUOTE' }).del();
  await tenantTable(tenantId, 'client_locations').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantTable(tenantId, 'user_roles').del();
  await tenantTable(tenantId, 'role_permissions').del();
  await tenantTable(tenantId, 'roles').del();
  await tenantTable(tenantId, 'permissions').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

interface Fixture {
  tenantId: string;
  userId: string;
  clientId: string;
  locationId: string;
  otherClientId: string;
  otherLocationId: string;
  user: { user_id: string; user_type: string; tenant: string };
}

async function insertClient(tenantId: string, name: string): Promise<string> {
  const clientId = uuidv4();
  await tenantTable(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `${name} ${clientId.slice(0, 8)}`,
  });
  return clientId;
}

// ux_client_locations_default_per_client allows one default per client, so
// only the first location of a client may claim it.
async function insertLocation(
  tenantId: string,
  clientId: string,
  name: string,
  isDefault = true,
): Promise<string> {
  const locationId = uuidv4();
  await tenantTable(tenantId, 'client_locations').insert({
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
  });
  return locationId;
}

async function createFixture(): Promise<Fixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const roleId = uuidv4();
  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Quote 2902 Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });
  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `quote-2902-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    user_type: 'internal',
    email: `user-${tenantId.slice(0, 8)}@example.com`,
  });
  await tenantTable(tenantId, 'roles').insert({
    tenant: tenantId,
    role_id: roleId,
    role_name: `Quote 2902 Role ${tenantId.slice(0, 8)}`,
    msp: true,
    client: false,
  });
  await tenantTable(tenantId, 'user_roles').insert({ tenant: tenantId, user_id: userId, role_id: roleId });
  for (const [resource, action] of [
    ['billing', 'create'],
    ['billing', 'read'],
    ['billing', 'update'],
    ['billing', 'delete'],
    ['quotes', 'approve'],
  ]) {
    const permissionId = uuidv4();
    await tenantTable(tenantId, 'permissions').insert({
      tenant: tenantId, permission_id: permissionId, resource, action, msp: true, client: false,
    });
    await tenantTable(tenantId, 'role_permissions').insert({ tenant: tenantId, role_id: roleId, permission_id: permissionId });
  }

  const clientId = await insertClient(tenantId, 'Leap Forward');
  const otherClientId = await insertClient(tenantId, 'Somebody Else');

  return {
    tenantId,
    userId,
    clientId,
    locationId: await insertLocation(tenantId, clientId, 'Head Office'),
    otherClientId,
    otherLocationId: await insertLocation(tenantId, otherClientId, 'Not Yours'),
    user: { user_id: userId, user_type: 'internal', tenant: tenantId },
  };
}

function controllerFor(fixture: Fixture) {
  const controller = new ApiQuoteController();
  // API-key validation is not under test; stub it to hand back the request with a context.
  vi.spyOn(controller as any, 'authenticate').mockImplementation(async (req: any) => {
    req.context = {
      tenant: fixture.tenantId,
      userId: fixture.userId,
      user: fixture.user,
      apiKeyId: uuidv4(),
    };
    return req;
  });
  return controller;
}

function buildRequest(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
  params?: Record<string, string>,
): NextRequest {
  const req = new NextRequest(`https://example.test${url}`, {
    method,
    headers: { 'x-api-key': 'test', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (params) {
    (req as any).params = Promise.resolve(params);
  }
  return req;
}

async function createQuote(fixture: Fixture, body: Record<string, unknown>) {
  const response = await controllerFor(fixture).create()(
    buildRequest('/api/v1/quotes', 'POST', body),
  );
  return { response, payload: await response.json().catch(() => null) };
}

async function quoteRow(fixture: Fixture, quoteId: string) {
  return tenantTable(fixture.tenantId, 'quotes').where({ quote_id: quoteId }).first();
}

async function setQuoteStatus(fixture: Fixture, quoteId: string, status: string) {
  await tenantTable(fixture.tenantId, 'quotes').where({ quote_id: quoteId }).update({ status });
}

describe('API quote contract gaps (alga-2026-0002902)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    testDb = db;
  }, 600_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
    }
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  describe('quote item location_id', () => {
    it('persists and returns location_id for an inline item and a later PUT', async () => {
      const fixture = await createFixture();
      const { response, payload } = await createQuote(fixture, {
        client_id: fixture.clientId,
        title: 'Location carrying quote',
        items: [{ description: 'Onsite support', quantity: 1, unit_price: 25_000, location_id: fixture.locationId }],
      });

      expect(response.status).toBe(201);
      const quoteId = payload.data.quote_id;

      const created = await tenantTable(fixture.tenantId, 'quote_items').where({ quote_id: quoteId }).first();
      expect(created.location_id).toBe(fixture.locationId);

      const listed = await controllerFor(fixture).listItems()(
        buildRequest(`/api/v1/quotes/${quoteId}/items`, 'GET', undefined, { id: quoteId }),
      );
      expect(listed.status).toBe(200);
      expect((await listed.json()).data[0].location_id).toBe(fixture.locationId);

      const secondLocationId = await insertLocation(fixture.tenantId, fixture.clientId, 'Branch', false);
      const updated = await controllerFor(fixture).updateItem()(
        buildRequest(
          `/api/v1/quotes/${quoteId}/items/${created.quote_item_id}`,
          'PUT',
          { location_id: secondLocationId },
          { id: quoteId, itemId: created.quote_item_id },
        ),
      );

      expect(updated.status).toBe(200);
      expect((await updated.json()).data.location_id).toBe(secondLocationId);
    });

    it('persists location_id on an item added through POST /items', async () => {
      const fixture = await createFixture();
      const { payload } = await createQuote(fixture, { client_id: fixture.clientId, title: 'Added item quote' });
      const quoteId = payload.data.quote_id;

      const response = await controllerFor(fixture).addItem()(
        buildRequest(
          `/api/v1/quotes/${quoteId}/items`,
          'POST',
          { description: 'Rack install', quantity: 2, unit_price: 10_000, location_id: fixture.locationId },
          { id: quoteId },
        ),
      );

      expect(response.status).toBe(201);
      expect((await response.json()).data.location_id).toBe(fixture.locationId);
    });

    it('rejects a location belonging to another client with 400', async () => {
      const fixture = await createFixture();

      const inline = await createQuote(fixture, {
        client_id: fixture.clientId,
        title: 'Cross client location',
        items: [{ description: 'Onsite support', quantity: 1, unit_price: 1_000, location_id: fixture.otherLocationId }],
      });
      expect(inline.response.status).toBe(400);
      expect(inline.payload.error.message).toContain('location_id');
      expect(await tenantTable(fixture.tenantId, 'quotes').count('* as count').first()).toMatchObject({ count: '0' });

      const { payload } = await createQuote(fixture, { client_id: fixture.clientId, title: 'Good quote' });
      const quoteId = payload.data.quote_id;

      const added = await controllerFor(fixture).addItem()(
        buildRequest(
          `/api/v1/quotes/${quoteId}/items`,
          'POST',
          { description: 'Onsite support', quantity: 1, unit_price: 1_000, location_id: fixture.otherLocationId },
          { id: quoteId },
        ),
      );
      expect(added.status).toBe(400);

      const good = await controllerFor(fixture).addItem()(
        buildRequest(
          `/api/v1/quotes/${quoteId}/items`,
          'POST',
          { description: 'Onsite support', quantity: 1, unit_price: 1_000 },
          { id: quoteId },
        ),
      );
      const itemId = (await good.json()).data.quote_item_id;

      const updated = await controllerFor(fixture).updateItem()(
        buildRequest(
          `/api/v1/quotes/${quoteId}/items/${itemId}`,
          'PUT',
          { location_id: fixture.otherLocationId },
          { id: quoteId, itemId },
        ),
      );
      expect(updated.status).toBe(400);
      const untouched = await tenantTable(fixture.tenantId, 'quote_items').where({ quote_item_id: itemId }).first();
      expect(untouched.location_id).toBeNull();
    });
  });

  describe('create body field names', () => {
    it('persists terms_and_conditions and internal_notes sent under their real names', async () => {
      const fixture = await createFixture();
      const { response, payload } = await createQuote(fixture, {
        client_id: fixture.clientId,
        title: 'Notes quote',
        internal_notes: 'Margin is thin here',
        client_notes: 'Thanks for the opportunity',
        terms_and_conditions: 'Net 30, prices valid 30 days',
      });

      expect(response.status).toBe(201);
      expect(payload.data).toMatchObject({
        internal_notes: 'Margin is thin here',
        client_notes: 'Thanks for the opportunity',
        terms_and_conditions: 'Net 30, prices valid 30 days',
      });

      const row = await quoteRow(fixture, payload.data.quote_id);
      expect(row.internal_notes).toBe('Margin is thin here');
      expect(row.terms_and_conditions).toBe('Net 30, prices valid 30 days');
    });

    it('maps the deprecated notes/terms aliases and ignores quote_number', async () => {
      const fixture = await createFixture();
      const { response, payload } = await createQuote(fixture, {
        client_id: fixture.clientId,
        title: 'Legacy alias quote',
        notes: 'Came in under the old field name',
        terms: 'Old terms field',
        quote_number: 'CALLER-SUPPLIED-1',
      });

      expect(response.status).toBe(201);
      expect(payload.data.internal_notes).toBe('Came in under the old field name');
      expect(payload.data.terms_and_conditions).toBe('Old terms field');
      // Quote numbers are server-assigned; a caller-supplied one must not land.
      expect(payload.data.quote_number).not.toBe('CALLER-SUPPLIED-1');
      expect(payload.data.quote_number).toBeTruthy();
    });

    it('prefers the canonical field when both it and its alias are sent', async () => {
      const fixture = await createFixture();
      const { payload } = await createQuote(fixture, {
        client_id: fixture.clientId,
        title: 'Both names quote',
        internal_notes: 'canonical',
        notes: 'alias',
      });

      expect(payload.data.internal_notes).toBe('canonical');
    });

    it('rejects an unknown top-level key with 400 instead of dropping it', async () => {
      const fixture = await createFixture();
      const { response, payload } = await createQuote(fixture, {
        client_id: fixture.clientId,
        title: 'Typo quote',
        terms_and_condtions: 'misspelled on purpose',
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(payload.error)).toContain('terms_and_condtions');
      expect(await tenantTable(fixture.tenantId, 'quotes').count('* as count').first()).toMatchObject({ count: '0' });
    });
  });

  describe('unit_price validation', () => {
    it('explains the is_discount convention when a negative unit_price is sent', async () => {
      const fixture = await createFixture();
      const { payload } = await createQuote(fixture, { client_id: fixture.clientId, title: 'Discount quote' });
      const quoteId = payload.data.quote_id;

      const response = await controllerFor(fixture).addItem()(
        buildRequest(
          `/api/v1/quotes/${quoteId}/items`,
          'POST',
          { description: 'Loyalty discount', quantity: 1, unit_price: -5_000 },
          { id: quoteId },
        ),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      const issues = JSON.stringify(body.error.details);
      expect(issues).toContain('is_discount');
      expect(issues).toContain('minor units');
    });

    it('accepts the documented fixed-discount shape', async () => {
      const fixture = await createFixture();
      const { payload } = await createQuote(fixture, { client_id: fixture.clientId, title: 'Discount quote' });
      const quoteId = payload.data.quote_id;

      const response = await controllerFor(fixture).addItem()(
        buildRequest(
          `/api/v1/quotes/${quoteId}/items`,
          'POST',
          {
            description: 'Loyalty discount',
            quantity: 1,
            unit_price: 5_000,
            is_discount: true,
            discount_type: 'fixed',
          },
          { id: quoteId },
        ),
      );

      expect(response.status).toBe(201);
      expect((await response.json()).data).toMatchObject({ is_discount: true, discount_type: 'fixed' });
    });
  });

  describe('archive and delete', () => {
    it('archives a draft, stamping archived_at and a status_changed activity', async () => {
      const fixture = await createFixture();
      const { payload } = await createQuote(fixture, { client_id: fixture.clientId, title: 'Archive me' });
      const quoteId = payload.data.quote_id;

      const response = await controllerFor(fixture).archive()(
        buildRequest(`/api/v1/quotes/${quoteId}/archive`, 'POST', undefined, { id: quoteId }),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).data.status).toBe('archived');

      const row = await quoteRow(fixture, quoteId);
      expect(row.status).toBe('archived');
      expect(row.archived_at).toBeTruthy();

      const activity = await tenantTable(fixture.tenantId, 'quote_activities')
        .where({ quote_id: quoteId, activity_type: 'status_changed' })
        .first();
      expect(activity.metadata).toMatchObject({ previous_status: 'draft', next_status: 'archived' });
    });

    it.each(['cancelled', 'rejected', 'expired'])('archives a %s quote', async (status) => {
      const fixture = await createFixture();
      const { payload } = await createQuote(fixture, { client_id: fixture.clientId, title: `Archive from ${status}` });
      const quoteId = payload.data.quote_id;
      await setQuoteStatus(fixture, quoteId, status);

      const response = await controllerFor(fixture).archive()(
        buildRequest(`/api/v1/quotes/${quoteId}/archive`, 'POST', undefined, { id: quoteId }),
      );

      expect(response.status).toBe(200);
      expect((await quoteRow(fixture, quoteId)).status).toBe('archived');
    });

    it('refuses to archive a sent quote with 409', async () => {
      const fixture = await createFixture();
      const { payload } = await createQuote(fixture, { client_id: fixture.clientId, title: 'Already out' });
      const quoteId = payload.data.quote_id;
      await setQuoteStatus(fixture, quoteId, 'sent');

      const response = await controllerFor(fixture).archive()(
        buildRequest(`/api/v1/quotes/${quoteId}/archive`, 'POST', undefined, { id: quoteId }),
      );

      expect(response.status).toBe(409);
      expect((await quoteRow(fixture, quoteId)).status).toBe('sent');
    });

    it('deletes a draft that round-tripped through approval', async () => {
      const fixture = await createFixture();
      const { payload } = await createQuote(fixture, { client_id: fixture.clientId, title: 'Round trip draft' });
      const quoteId = payload.data.quote_id;

      const submitted = await controllerFor(fixture).submitForApproval()(
        buildRequest(`/api/v1/quotes/${quoteId}/submit-for-approval`, 'POST', undefined, { id: quoteId }),
      );
      expect(submitted.status).toBe(200);

      const sentBack = await controllerFor(fixture).requestChanges()(
        buildRequest(`/api/v1/quotes/${quoteId}/request-changes`, 'POST', { reason: 'Lower the rate' }, { id: quoteId }),
      );
      expect(sentBack.status).toBe(200);

      // Both halves of the round trip left activity rows behind; they must not
      // block the delete of a quote that is still a draft.
      const activityTypes = await tenantTable(fixture.tenantId, 'quote_activities')
        .where({ quote_id: quoteId })
        .pluck('activity_type');
      expect(activityTypes).toContain('status_changed');
      expect(activityTypes).toContain('approval_changes_requested');

      const response = await controllerFor(fixture).delete()(
        buildRequest(`/api/v1/quotes/${quoteId}`, 'DELETE', undefined, { id: quoteId }),
      );

      expect(response.status).toBe(204);
      expect(await quoteRow(fixture, quoteId)).toBeUndefined();
    });

    it('names the blocking rows and the archive alternative in the DELETE 409', async () => {
      const fixture = await createFixture();
      const { payload } = await createQuote(fixture, { client_id: fixture.clientId, title: 'Sent quote' });
      const quoteId = payload.data.quote_id;
      await setQuoteStatus(fixture, quoteId, 'sent');

      const response = await controllerFor(fixture).delete()(
        buildRequest(`/api/v1/quotes/${quoteId}`, 'DELETE', undefined, { id: quoteId }),
      );

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.details.code).toBe('DEPENDENCIES_EXIST');
      expect(body.error.details.dependencies.map((dependency: any) => dependency.type)).toContain('quote_state');
      expect(body.error.details.alternatives.map((alternative: any) => alternative.action)).toContain('archive');
      expect(await quoteRow(fixture, quoteId)).toBeTruthy();
    });
  });

  describe('list query validation', () => {
    it('returns 400, not 500, for an unsupported sort field', async () => {
      const fixture = await createFixture();

      const response = await controllerFor(fixture).list()(
        buildRequest('/api/v1/quotes?sort=total_amount%3B%20drop%20table', 'GET'),
      );

      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).toContain('sort');
    });

    it('still serves a supported sort field', async () => {
      const fixture = await createFixture();
      await createQuote(fixture, { client_id: fixture.clientId, title: 'Sortable' });

      const response = await controllerFor(fixture).list()(
        buildRequest('/api/v1/quotes?sort=quote_number&order=asc', 'GET'),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).data).toHaveLength(1);
    });
  });
});
