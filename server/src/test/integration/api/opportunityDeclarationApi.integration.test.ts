/**
 * alga-2026-0002932 — REST surface for stage declarations, driven through the
 * real controller and service against real rows:
 *   POST /api/v1/opportunities/{id}/evidence   citations, refType/refId shorthand, both -> 400
 *   POST /api/v1/opportunities/{id}/stage      citations
 *   PUT  /api/v1/opportunities/{id}/declarations/{checkpoint}   amend, 409 unreached, 403 without update
 *   GET  /api/v1/opportunities/{id}/evidence   citations on each row
 *
 * Requires the standard test DB; skipped automatically when no database is
 * reachable unless REQUIRE_DB=1.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { describeWithDb } from '../../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../../test-utils/testDataFactory';

const published = vi.hoisted(() => ({ publishWorkflowEvent: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(() => Promise.resolve()),
  publishWorkflowEvent: published.publishWorkflowEvent,
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

let testDb: Knex;
vi.mock('@/lib/db/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/db')>();
  return { ...actual, getConnection: vi.fn(async () => testDb) };
});

const { ApiOpportunityController } = await import('@/lib/api/controllers/ApiOpportunityController');

const describeDb = await describeWithDb();

let db: Knex;
let tenantId: string;
let editor: { user_id: string; user_type: string; tenant: string };
let reader: { user_id: string; user_type: string; tenant: string };
let clientId: string;
let callTypeId: string;

const table = (name: string) => tenantDb(db, tenantId).table(name);

async function grant(userId: string, actions: string[]) {
  const roleId = randomUUID();
  await table('roles').insert({ tenant: tenantId, role_id: roleId, role_name: `Opp role ${roleId.slice(0, 8)}`, msp: true, client: false });
  await table('user_roles').insert({ tenant: tenantId, user_id: userId, role_id: roleId });
  for (const action of actions) {
    const permissionId = randomUUID();
    await table('permissions').insert({ tenant: tenantId, permission_id: permissionId, resource: 'opportunities', action, msp: true, client: false });
    await table('role_permissions').insert({ tenant: tenantId, role_id: roleId, permission_id: permissionId });
  }
}

function controllerAs(user: typeof editor) {
  const controller = new ApiOpportunityController();
  vi.spyOn(controller as any, 'authenticate').mockImplementation(async (req: any) => {
    req.context = { tenant: tenantId, userId: user.user_id, user, apiKeyId: randomUUID() };
    return req;
  });
  return controller;
}

function request(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, params?: Record<string, string>) {
  const req = new NextRequest(`https://example.test${url}`, {
    method,
    headers: { 'x-api-key': 'test', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (params) (req as any).params = Promise.resolve(params);
  return req;
}

async function newOpportunity(): Promise<string> {
  const id = randomUUID();
  await table('opportunities').insert({
    tenant: tenantId, opportunity_id: id, opportunity_number: `OPP-${id.slice(0, 8)}`, client_id: clientId,
    title: 'API deal', opportunity_type: 'new_logo', owner_id: editor.user_id, status: 'open', stage: 'identified',
    confidence: 'medium', mrr_cents: 0, nrr_cents: 0, hardware_cents: 0, currency_code: 'USD', values_locked_by_quote: false,
    last_activity_at: '2026-01-01T00:00:00.000Z', created_by: editor.user_id, created_at: db.fn.now(), updated_at: db.fn.now(),
  });
  return id;
}

async function newInteraction(opportunityId: string): Promise<string> {
  const interactionId = randomUUID();
  await table('interactions').insert({
    tenant: tenantId, interaction_id: interactionId, type_id: callTypeId, user_id: editor.user_id, title: 'Call',
    opportunity_id: opportunityId, client_id: clientId, interaction_date: '2026-10-01T00:00:00.000Z',
  });
  return interactionId;
}

async function newDocument(opportunityId: string): Promise<string> {
  const documentId = randomUUID();
  await table('documents').insert({ tenant: tenantId, document_id: documentId, document_name: 'Notes.pdf', user_id: editor.user_id, created_by: editor.user_id });
  await table('document_associations').insert({ tenant: tenantId, document_id: documentId, entity_id: opportunityId, entity_type: 'opportunity' });
  return documentId;
}

const stageOf = async (id: string) => (await table('opportunities').where({ opportunity_id: id }).first()).stage;
const stageEvents = () => published.publishWorkflowEvent.mock.calls.filter(([arg]: any) => arg?.eventType === 'OPPORTUNITY_STAGE_CHANGED');

describeDb('opportunity declaration REST API', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    testDb = db;
    tenantId = await createTenant(db, 'Declaration API Tenant');
    const editorId = await createUser(db, tenantId, { username: 'declaration.api.editor' });
    const readerId = await createUser(db, tenantId, { username: 'declaration.api.reader' });
    editor = { user_id: editorId, user_type: 'internal', tenant: tenantId };
    reader = { user_id: readerId, user_type: 'internal', tenant: tenantId };
    clientId = await createClient(db, tenantId, 'Declaration API Client');
    await grant(editorId, ['read', 'update']);
    await grant(readerId, ['read']);
    callTypeId = (await db('system_interaction_types').where({ type_name: 'Call' }).first('type_id')).type_id;
  }, 180_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await db?.destroy().catch(() => undefined);
  }, 60_000);

  beforeEach(() => published.publishWorkflowEvent.mockClear());

  it('POST evidence accepts a note with several citations, and GET evidence lists them in order', async () => {
    const id = await newOpportunity();
    const call = await newInteraction(id);
    const notes = await newDocument(id);
    const res = await controllerAs(editor).recordEvidence()(request('POST', `/api/v1/opportunities/${id}/evidence`,
      { checkpoint: 'qualified', detail: 'Budget confirmed', citations: [{ type: 'document', id: notes }, { type: 'interaction', id: call }] }, { id }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.stage).toBe('qualified');

    const list = await controllerAs(editor).listEvidence()(request('GET', `/api/v1/opportunities/${id}/evidence`, undefined, { id }));
    expect(list.status).toBe(200);
    const [row] = (await list.json()).data;
    expect(row).toMatchObject({ checkpoint: 'qualified', detail: 'Budget confirmed', ref_type: null });
    expect(row.citations).toEqual([{ type: 'document', id: notes }, { type: 'interaction', id: call }]);
  });

  it('POST evidence still accepts refType/refId alone and answers 400 when both forms are sent', async () => {
    const id = await newOpportunity();
    const call = await newInteraction(id);
    const shorthand = await controllerAs(editor).recordEvidence()(request('POST', `/api/v1/opportunities/${id}/evidence`,
      { checkpoint: 'qualified', refType: 'interaction', refId: call }, { id }));
    expect(shorthand.status).toBe(201);
    const [row] = (await (await controllerAs(editor).listEvidence()(request('GET', `/api/v1/opportunities/${id}/evidence`, undefined, { id }))).json()).data;
    expect(row.citations).toEqual([{ type: 'interaction', id: call }]);

    const both = await controllerAs(editor).recordEvidence()(request('POST', `/api/v1/opportunities/${id}/evidence`,
      { checkpoint: 'assessment', refType: 'interaction', refId: call, citations: [{ type: 'interaction', id: call }] }, { id }));
    expect(both.status).toBe(400);
    expect(await stageOf(id)).toBe('qualified');
  });

  it('POST evidence refuses a source that is not on this opportunity with 400 and writes nothing', async () => {
    const id = await newOpportunity();
    const other = await newOpportunity();
    const foreign = await newInteraction(other);
    const res = await controllerAs(editor).recordEvidence()(request('POST', `/api/v1/opportunities/${id}/evidence`,
      { checkpoint: 'qualified', citations: [{ type: 'interaction', id: foreign }] }, { id }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('That source is not attached to this opportunity');
    expect(await stageOf(id)).toBe('identified');
  });

  it('POST stage accepts citations', async () => {
    const id = await newOpportunity();
    const notes = await newDocument(id);
    const res = await controllerAs(editor).setStage()(request('POST', `/api/v1/opportunities/${id}/stage`,
      { stage: 'proposed', detail: 'Proposal out', citations: [{ type: 'document', id: notes }] }, { id }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.stage).toBe('proposed');
    const live = await table('opportunity_evidence').where({ opportunity_id: id, checkpoint: 'proposed' }).whereNull('corrected_at').first();
    expect(live.detail).toBe('Proposal out');
    expect(await table('opportunity_evidence_citations').where({ evidence_id: live.evidence_id })).toHaveLength(1);
  });

  it('PUT declarations/{checkpoint} amends with patch semantics, returns the opportunity, and moves nothing', async () => {
    const id = await newOpportunity();
    const call = await newInteraction(id);
    await controllerAs(editor).setStage()(request('POST', `/api/v1/opportunities/${id}/stage`, { stage: 'verbal', detail: 'Verbal yes' }, { id }));
    published.publishWorkflowEvent.mockClear();

    const res = await controllerAs(editor).amendDeclaration()(request('PUT', `/api/v1/opportunities/${id}/declarations/verbal`,
      { citations: [{ type: 'interaction', id: call }] }, { id, checkpoint: 'verbal' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ opportunity_id: id, stage: 'verbal' });
    expect(stageEvents()).toHaveLength(0);
    const live = await table('opportunity_evidence').where({ opportunity_id: id, checkpoint: 'verbal' }).whereNull('corrected_at').first();
    expect(live.detail).toBe('Verbal yes');
    expect((await table('opportunity_evidence_citations').where({ evidence_id: live.evidence_id })).map((r: any) => r.ref_id)).toEqual([call]);

    const cleared = await controllerAs(editor).amendDeclaration()(request('PUT', `/api/v1/opportunities/${id}/declarations/verbal`,
      { detail: null, citations: [] }, { id, checkpoint: 'verbal' }));
    expect(cleared.status).toBe(200);
    const after = await table('opportunity_evidence').where({ opportunity_id: id, checkpoint: 'verbal' }).whereNull('corrected_at').first();
    expect(after.detail).toBeNull();
  });

  it('PUT declarations answers 409 for an unreached checkpoint, 400 for won or an unknown checkpoint, 403 without update', async () => {
    const id = await newOpportunity();
    const unreached = await controllerAs(editor).amendDeclaration()(request('PUT', `/api/v1/opportunities/${id}/declarations/verbal`, { detail: 'x' }, { id, checkpoint: 'verbal' }));
    expect(unreached.status).toBe(409);
    const won = await controllerAs(editor).amendDeclaration()(request('PUT', `/api/v1/opportunities/${id}/declarations/won`, { detail: 'x' }, { id, checkpoint: 'won' }));
    expect(won.status).toBe(400);
    const unknown = await controllerAs(editor).amendDeclaration()(request('PUT', `/api/v1/opportunities/${id}/declarations/identified`, { detail: 'x' }, { id, checkpoint: 'identified' }));
    expect(unknown.status).toBe(400);

    await controllerAs(editor).setStage()(request('POST', `/api/v1/opportunities/${id}/stage`, { stage: 'qualified' }, { id }));
    const forbidden = await controllerAs(reader).amendDeclaration()(request('PUT', `/api/v1/opportunities/${id}/declarations/qualified`, { detail: 'x' }, { id, checkpoint: 'qualified' }));
    expect(forbidden.status).toBe(403);
    expect((await table('opportunity_evidence').where({ opportunity_id: id, checkpoint: 'qualified' }).whereNull('corrected_at').first()).detail).toBeNull();
  });
});
