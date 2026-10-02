import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { NextRequest } from 'next/server';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

// alga-2026-0002597: POST /api/v1/quotes/:id/request-changes returned HTTP 500.
// These tests drive the real controller handler against real rows so the actual
// throw is captured, and pin the fixed behaviour (2xx for a valid body, 4xx -- never
// 500 -- for a missing/empty/malformed body).

let testDb: Knex;
vi.mock('@/lib/db/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/db')>();
  return {
    ...actual,
    getConnection: vi.fn(async () => testDb),
  };
});

const { ApiQuoteController } = await import('@/lib/api/controllers/ApiQuoteController');
const { QUOTE_ACTIVITY_TYPES } = await import('@alga-psa/billing/lib/quoteActivityTypes');

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
  quoteId: string;
  user: { user_id: string; user_type: string; tenant: string };
}

async function createFixture(quoteStatus = 'pending_approval'): Promise<Fixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const roleId = uuidv4();
  const quoteId = uuidv4();
  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Quote RC Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });
  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `quote-rc-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    user_type: 'internal',
    email: `user-${tenantId.slice(0, 8)}@example.com`,
  });
  await tenantTable(tenantId, 'roles').insert({
    tenant: tenantId,
    role_id: roleId,
    role_name: `Quote RC Role ${tenantId.slice(0, 8)}`,
    msp: true,
    client: false,
  });
  await tenantTable(tenantId, 'user_roles').insert({ tenant: tenantId, user_id: userId, role_id: roleId });
  for (const [resource, action] of [['billing', 'read'], ['billing', 'update'], ['quotes', 'approve']]) {
    const permissionId = uuidv4();
    await tenantTable(tenantId, 'permissions').insert({
      tenant: tenantId, permission_id: permissionId, resource, action, msp: true, client: false,
    });
    await tenantTable(tenantId, 'role_permissions').insert({ tenant: tenantId, role_id: roleId, permission_id: permissionId });
  }
  await tenantTable(tenantId, 'quotes').insert({
    tenant: tenantId,
    quote_id: quoteId,
    title: 'Request changes fixture',
    status: quoteStatus,
    created_by: userId,
  });

  return { tenantId, userId, quoteId, user: { user_id: userId, user_type: 'internal', tenant: tenantId } };
}

function buildRequest(fixture: Fixture, body: string | undefined, contentType = 'application/json'): NextRequest {
  const req = new NextRequest(`https://example.test/api/v1/quotes/${fixture.quoteId}/request-changes`, {
    method: 'POST',
    headers: { 'x-api-key': 'test', 'content-type': contentType },
    body,
  });
  (req as any).params = Promise.resolve({ id: fixture.quoteId });
  return req;
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

async function quoteStatus(fixture: Fixture): Promise<string | null> {
  const row = await tenantTable(fixture.tenantId, 'quotes').where({ quote_id: fixture.quoteId }).first();
  return row?.status ?? null;
}

async function activityTypes(fixture: Fixture): Promise<string[]> {
  const rows = await tenantTable(fixture.tenantId, 'quote_activities')
    .where({ quote_id: fixture.quoteId })
    .orderBy('created_at', 'asc');
  return rows.map((row: any) => row.activity_type);
}

describe('API quote request-changes (alga-2026-0002597)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    testDb = db;
  });

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

  it('moves a pending quote back to draft and writes the canonical activity type', async () => {
    const fixture = await createFixture();
    const response = await controllerFor(fixture).requestChanges()(
      buildRequest(fixture, JSON.stringify({ reason: 'Please lower the hourly rate' })),
    );

    expect(response.status).toBe(200);
    expect(await quoteStatus(fixture)).toBe('draft');

    const activity = await tenantTable(fixture.tenantId, 'quote_activities')
      .where({ quote_id: fixture.quoteId, activity_type: QUOTE_ACTIVITY_TYPES.approvalChangesRequested })
      .first();
    expect(activity).toBeTruthy();
    expect(activity.description).toContain('Please lower the hourly rate');
    expect(activity.performed_by).toBe(fixture.userId);
    expect(activity.metadata).toMatchObject({ comment: 'Please lower the hourly rate' });
    expect(await activityTypes(fixture)).not.toContain('changes_requested');
  });

  it.each([
    ['an empty body', undefined],
    ['an empty JSON string', ''],
    ['malformed JSON', '{"reason": '],
    ['a JSON body without a reason', JSON.stringify({})],
    ['a blank reason', JSON.stringify({ reason: '   ' })],
    ['a non-object JSON body', JSON.stringify('nope')],
  ])('returns 400 (not 500) for %s and leaves the quote pending', async (_label, body) => {
    const fixture = await createFixture();
    const response = await controllerFor(fixture).requestChanges()(buildRequest(fixture, body));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.message).toBeTruthy();
    expect(await quoteStatus(fixture)).toBe('pending_approval');
  });

  it('returns 409 when the quote is not pending approval', async () => {
    const fixture = await createFixture('draft');
    const response = await controllerFor(fixture).requestChanges()(
      buildRequest(fixture, JSON.stringify({ reason: 'x' })),
    );

    expect(response.status).toBe(409);
    expect(await quoteStatus(fixture)).toBe('draft');
  });
});
