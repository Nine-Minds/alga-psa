/**
 * alga-2026-0002932 — stage declarations carry a note and their sources, and
 * can be amended without moving the deal. Runs against a fully migrated schema
 * (the suite database is migrated from the repo's migrations, including
 * opportunity_evidence_citations), through the real engine and ladder read.
 *
 * T001  amend the current stage: note kept, two sources, stage unchanged, no
 *       OPPORTUNITY_STAGE_CHANGED, one live declaration, recorded_at kept
 * T002  the citation guard refuses the whole write, 25-source cap, dedupe
 * T003  amend refusals, system-only checkpoint, closed deal
 * T005  declare with no content / step completion leave a declaration alone
 * and a cited document resolves on a deal with more than 15 documents.
 *
 * Requires the standard test DB; skipped automatically when no database is
 * reachable unless REQUIRE_DB=1.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

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

import {
  OpportunityDeclarationError,
  OpportunityEvidenceRefError,
  amendDeclaration,
  declareStage,
  declareStageFromStep,
} from '../../../../packages/opportunities/src/lib/stageEngine';
import { getOpportunityDetail } from '../../../../packages/opportunities/src/lib/opportunityDetail';

const describeDb = await describeWithDb();

let db: Knex;
let tenantId: string;
let otherTenantId: string;
let userId: string;
let editorId: string;
let clientId: string;
let callTypeId: string;

const table = (name: string, tenant = tenantId) => tenantDb(db, tenant).table(name);
const doc = (id: string) => ({ type: 'document' as const, id });
const interaction = (id: string) => ({ type: 'interaction' as const, id });
const stageChangedEvents = () => published.publishWorkflowEvent.mock.calls.filter(([arg]: any) => arg?.eventType === 'OPPORTUNITY_STAGE_CHANGED');

async function createOpportunity(tenant = tenantId, status: 'open' | 'won' | 'lost' = 'open') {
  const opportunityId = randomUUID();
  await table('opportunities', tenant).insert({
    tenant,
    opportunity_id: opportunityId,
    opportunity_number: `OPP-${opportunityId.slice(0, 8)}`,
    client_id: tenant === tenantId ? clientId : (await table('clients', tenant).first('client_id')).client_id,
    title: 'Managed services agreement',
    opportunity_type: 'new_logo',
    owner_id: tenant === tenantId ? userId : (await table('users', tenant).first('user_id')).user_id,
    status,
    stage: 'identified',
    confidence: 'medium',
    mrr_cents: 0,
    nrr_cents: 0,
    hardware_cents: 0,
    currency_code: 'USD',
    values_locked_by_quote: false,
    last_activity_at: '2026-01-01T00:00:00.000Z',
    created_by: tenant === tenantId ? userId : (await table('users', tenant).first('user_id')).user_id,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return opportunityId;
}

async function createInteraction(opportunityId: string, title: string, tenant = tenantId): Promise<string> {
  const interactionId = randomUUID();
  await table('interactions', tenant).insert({
    tenant,
    interaction_id: interactionId,
    type_id: callTypeId,
    user_id: tenant === tenantId ? userId : (await table('users', tenant).first('user_id')).user_id,
    title,
    opportunity_id: opportunityId,
    client_id: tenant === tenantId ? clientId : (await table('clients', tenant).first('client_id')).client_id,
    interaction_date: '2026-10-01T00:00:00.000Z',
  });
  return interactionId;
}

async function createDocument(name: string, attachTo: string | null, tenant = tenantId): Promise<string> {
  const documentId = randomUUID();
  const user = tenant === tenantId ? userId : (await table('users', tenant).first('user_id')).user_id;
  await table('documents', tenant).insert({ tenant, document_id: documentId, document_name: name, user_id: user, created_by: user });
  if (attachTo) {
    await table('document_associations', tenant).insert({ tenant, document_id: documentId, entity_id: attachTo, entity_type: 'opportunity' });
  }
  return documentId;
}

const run = <T>(fn: (trx: Knex.Transaction) => Promise<T>) => withTransaction(db, fn);

const liveDeclaration = (opportunityId: string, checkpoint: string) =>
  table('opportunity_evidence').where({ opportunity_id: opportunityId, checkpoint, source: 'user_declared' }).whereNull('corrected_at');
const citationsOf = async (evidenceId: string) =>
  (await table('opportunity_evidence_citations').where({ evidence_id: evidenceId }).orderBy('position', 'asc'))
    .map((row: any) => `${row.ref_type}:${row.ref_id}`);
const stageOf = async (opportunityId: string) => (await table('opportunities').where({ opportunity_id: opportunityId }).first()).stage;

describeDb('opportunity declarations (DB-backed)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantId = await createTenant(db, 'Declarations Tenant');
    userId = await createUser(db, tenantId, { username: 'declarations.owner' });
    editorId = await createUser(db, tenantId, { username: 'declarations.editor' });
    clientId = await createClient(db, tenantId, 'Declarations Client');
    otherTenantId = await createTenant(db, 'Declarations Other Tenant');
    await createUser(db, otherTenantId, { username: 'declarations.other' });
    await createClient(db, otherTenantId, 'Declarations Other Client');
    const callType = await db('system_interaction_types').where({ type_name: 'Call' }).first('type_id');
    if (!callType?.type_id) throw new Error('System Call interaction type is required');
    callTypeId = callType.type_id;
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, 60_000);

  beforeEach(() => {
    published.publishWorkflowEvent.mockClear();
  });

  it('T001: amending the current stage keeps the note, stores two sources in order, and moves nothing', async () => {
    const opportunityId = await createOpportunity();
    const call = await createInteraction(opportunityId, 'Discovery call');
    const transcript = await createDocument('Transcript.txt', opportunityId);
    await run((trx) => declareStage(trx, tenantId, opportunityId, 'verbal', userId, { note: 'Verbal yes' }));
    const original = await liveDeclaration(opportunityId, 'verbal').first();
    // Make the original's timestamp unmistakable, so a replacement that took "now" would show.
    await table('opportunity_evidence').where({ evidence_id: original.evidence_id }).update({ recorded_at: '2026-03-04T05:06:07.000Z' });
    published.publishWorkflowEvent.mockClear();

    const amended = await run((trx) => amendDeclaration(trx, tenantId, opportunityId, 'verbal', editorId, { citations: [interaction(call), doc(transcript)] }));

    expect(amended.stage).toBe('verbal');
    expect(await stageOf(opportunityId)).toBe('verbal');
    expect(stageChangedEvents()).toHaveLength(0);
    expect(published.publishWorkflowEvent).not.toHaveBeenCalled();

    const live = await liveDeclaration(opportunityId, 'verbal');
    expect(live).toHaveLength(1);
    expect(live[0].detail).toBe('Verbal yes');
    expect(await citationsOf(live[0].evidence_id)).toEqual([`interaction:${call}`, `document:${transcript}`]);
    // recorded_at / recorded_by are inherited; the editor is on the superseded row.
    expect(new Date(live[0].recorded_at).toISOString()).toBe('2026-03-04T05:06:07.000Z');
    expect(live[0].recorded_by).toBe(userId);
    const superseded = await table('opportunity_evidence').where({ evidence_id: original.evidence_id }).first();
    expect(superseded).toMatchObject({ corrected_by: editorId, correction_note: 'Superseded by a new declaration' });
    expect(superseded.corrected_at).toBeTruthy();
  });

  it('keeps recorded_at unchanged across repeated amendments', async () => {
    const opportunityId = await createOpportunity();
    await run((trx) => declareStage(trx, tenantId, opportunityId, 'qualified', userId, { note: 'one' }));
    const first = await liveDeclaration(opportunityId, 'qualified').first();
    await run((trx) => amendDeclaration(trx, tenantId, opportunityId, 'qualified', editorId, { note: 'two' }));
    await run((trx) => amendDeclaration(trx, tenantId, opportunityId, 'qualified', editorId, { note: 'three' }));
    const live = await liveDeclaration(opportunityId, 'qualified');
    expect(live).toHaveLength(1);
    expect(live[0].detail).toBe('three');
    expect(new Date(live[0].recorded_at).getTime()).toBe(new Date(first.recorded_at).getTime());
    expect(await table('opportunity_evidence').where({ opportunity_id: opportunityId, checkpoint: 'qualified' })).toHaveLength(3);
  });

  it('T002: one bad source refuses the whole write, including beside a valid one', async () => {
    const opportunityId = await createOpportunity();
    const otherOpportunityId = await createOpportunity();
    const mine = await createInteraction(opportunityId, 'Mine');
    const foreignInteraction = await createInteraction(otherOpportunityId, 'Another deal');
    const unattached = await createDocument('Unattached.pdf', null);
    const otherTenantOpportunity = await createOpportunity(otherTenantId);
    const crossTenantDoc = await createDocument('Foreign tenant.pdf', otherTenantOpportunity, otherTenantId);
    await run((trx) => declareStage(trx, tenantId, opportunityId, 'qualified', userId, { note: 'Baseline', citations: [interaction(mine)] }));
    const before = await table('opportunity_evidence').where({ opportunity_id: opportunityId });

    for (const bad of [interaction(foreignInteraction), doc(unattached), doc(crossTenantDoc), { type: 'quote' as any, id: randomUUID() }]) {
      await expect(run((trx) => amendDeclaration(trx, tenantId, opportunityId, 'qualified', editorId, { note: 'Changed', citations: [interaction(mine), bad] })))
        .rejects.toBeInstanceOf(OpportunityEvidenceRefError);
      await expect(run((trx) => declareStage(trx, tenantId, opportunityId, 'assessment', editorId, { citations: [interaction(mine), bad] })))
        .rejects.toBeInstanceOf(OpportunityEvidenceRefError);
    }
    expect(await table('opportunity_evidence').where({ opportunity_id: opportunityId })).toEqual(before);
    expect(await stageOf(opportunityId)).toBe('qualified');
  });

  it('T002: refuses more than 25 sources and stores a repeated source once', async () => {
    const opportunityId = await createOpportunity();
    const docs: string[] = [];
    for (let i = 0; i < 26; i += 1) docs.push(await createDocument(`Doc ${i}.pdf`, opportunityId));
    await run((trx) => declareStage(trx, tenantId, opportunityId, 'qualified', userId, { note: 'n' }));

    const refusal = await run((trx) => amendDeclaration(trx, tenantId, opportunityId, 'qualified', editorId, { citations: docs.map(doc) })).catch((e) => e);
    expect(refusal).toBeInstanceOf(OpportunityDeclarationError);
    expect(refusal.code).toBe('too_many_citations');

    await run((trx) => amendDeclaration(trx, tenantId, opportunityId, 'qualified', editorId, { citations: [doc(docs[0]), doc(docs[1]), doc(docs[0])] }));
    const live = await liveDeclaration(opportunityId, 'qualified').first();
    expect(await citationsOf(live.evidence_id)).toEqual([`document:${docs[0]}`, `document:${docs[1]}`]);
    // 25 exactly is allowed.
    await run((trx) => amendDeclaration(trx, tenantId, opportunityId, 'qualified', editorId, { citations: docs.slice(0, 25).map(doc) }));
    expect(await citationsOf((await liveDeclaration(opportunityId, 'qualified').first()).evidence_id)).toHaveLength(25);
  });

  it('T003: refuses an unreached checkpoint and won; inserts beside system evidence; works on a closed deal', async () => {
    const opportunityId = await createOpportunity();
    const unreached = await run((trx) => amendDeclaration(trx, tenantId, opportunityId, 'verbal', editorId, { note: 'x' })).catch((e) => e);
    expect(unreached).toBeInstanceOf(OpportunityDeclarationError);
    expect(unreached.code).toBe('checkpoint_not_reached');
    const wonRefusal = await run((trx) => amendDeclaration(trx, tenantId, opportunityId, 'won', editorId, { note: 'x' })).catch((e) => e);
    expect(wonRefusal.code).toBe('checkpoint_not_amendable');
    expect(await table('opportunity_evidence').where({ opportunity_id: opportunityId })).toHaveLength(0);

    // A checkpoint reached only by system evidence.
    await table('opportunity_evidence').insert({
      tenant: tenantId, opportunity_id: opportunityId, checkpoint: 'proposed', source: 'system',
      ref_type: 'quote', ref_id: randomUUID(), detail: 'Quote Q-1 sent', recorded_at: '2026-02-01T00:00:00.000Z',
    });
    const call = await createInteraction(opportunityId, 'Walkthrough');
    await run((trx) => amendDeclaration(trx, tenantId, opportunityId, 'proposed', editorId, { note: 'Walked them through it', citations: [interaction(call)] }));
    const rows = await table('opportunity_evidence').where({ opportunity_id: opportunityId, checkpoint: 'proposed' }).orderBy('source');
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.source === 'system')).toMatchObject({ detail: 'Quote Q-1 sent', corrected_at: null });
    const declared = rows.find((r: any) => r.source === 'user_declared');
    expect(declared).toMatchObject({ recorded_by: editorId, corrected_at: null, detail: 'Walked them through it' });

    // A closed deal is editable; the stage stays 'won'.
    const closedId = await createOpportunity(tenantId, 'won');
    await table('opportunities').where({ opportunity_id: closedId }).update({ stage: 'won' });
    await table('opportunity_evidence').insert({ tenant: tenantId, opportunity_id: closedId, checkpoint: 'verbal', source: 'user_declared', detail: 'Verbal', recorded_by: userId, recorded_at: '2026-04-01T00:00:00.000Z' });
    await run((trx) => amendDeclaration(trx, tenantId, closedId, 'verbal', editorId, { note: 'Verbal, edited after close' }));
    expect((await liveDeclaration(closedId, 'verbal').first()).detail).toBe('Verbal, edited after close');
    expect(await stageOf(closedId)).toBe('won');
  });

  it('T004: declareStage with no note stores a NULL detail, not the old placeholder', async () => {
    const opportunityId = await createOpportunity();
    await run((trx) => declareStage(trx, tenantId, opportunityId, 'assessment', userId));
    expect((await liveDeclaration(opportunityId, 'assessment').first()).detail).toBeNull();
  });

  it('T005: declaring again with no content, and completing a step, leave a cited declaration as it was', async () => {
    const opportunityId = await createOpportunity();
    const transcript = await createDocument('Transcript.txt', opportunityId);
    await run((trx) => declareStage(trx, tenantId, opportunityId, 'assessment', userId, { note: 'Written by a person', citations: [doc(transcript)] }));
    const before = await liveDeclaration(opportunityId, 'assessment').first();

    await run((trx) => declareStage(trx, tenantId, opportunityId, 'assessment', editorId));
    await run((trx) => declareStageFromStep(trx, tenantId, opportunityId, 'assessment', editorId, 'Run the assessment call'));

    const live = await liveDeclaration(opportunityId, 'assessment');
    expect(live).toHaveLength(1);
    expect(live[0].evidence_id).toBe(before.evidence_id);
    expect(live[0].detail).toBe('Written by a person');
    expect(await citationsOf(live[0].evidence_id)).toEqual([`document:${transcript}`]);

    // With no declaration, the step seeds one whose note is the step title.
    await run((trx) => declareStageFromStep(trx, tenantId, opportunityId, 'proposed', editorId, 'Send the proposal'));
    expect((await liveDeclaration(opportunityId, 'proposed').first()).detail).toBe('Send the proposal');
  });

  it('T007: the ladder resolves labels in position order; a deleted interaction and a detached document turn missing and every rung renders', async () => {
    const opportunityId = await createOpportunity();
    const call = await createInteraction(opportunityId, 'Discovery call');
    const scope = await createDocument('Scope.pdf', opportunityId);
    await run((trx) => declareStage(trx, tenantId, opportunityId, 'proposed', userId, { note: 'Proposal agreed', citations: [doc(scope), interaction(call)] }));

    let detail = (await getOpportunityDetail(db, tenantId, opportunityId))!;
    let rung = detail.ladder.find((step) => step.checkpoint === 'proposed')!;
    expect(rung.declaration?.note).toBe('Proposal agreed');
    expect(rung.declaration?.citations.map((c) => [c.type, c.label, c.missing])).toEqual([['document', 'Scope.pdf', false], ['interaction', 'Discovery call', false]]);
    expect(rung.evidence).not.toHaveProperty('ref_label');

    await table('interactions').where({ interaction_id: call }).del();
    await table('document_associations').where({ document_id: scope }).del();
    detail = (await getOpportunityDetail(db, tenantId, opportunityId))!;
    rung = detail.ladder.find((step) => step.checkpoint === 'proposed')!;
    expect(rung.declaration?.citations.map((c) => [c.label, c.missing])).toEqual([[null, true], [null, true]]);
    expect(detail.ladder.map((s) => s.state)).toEqual(['reached', 'skipped', 'skipped', 'reached', 'pending', 'pending']);
  });

  it('a cited document resolves on a deal with more than 15 documents', async () => {
    const opportunityId = await createOpportunity();
    const oldest = await createDocument('Oldest contract.pdf', opportunityId);
    // 20 newer attachments push the oldest off the first page (15, newest first) of the deal's document list.
    for (let i = 0; i < 20; i += 1) await createDocument(`Newer ${i}.pdf`, opportunityId);
    await run((trx) => declareStage(trx, tenantId, opportunityId, 'qualified', userId, { citations: [doc(oldest)] }));
    const detail = (await getOpportunityDetail(db, tenantId, opportunityId))!;
    const citation = detail.ladder.find((s) => s.checkpoint === 'qualified')!.declaration!.citations[0];
    expect(citation).toMatchObject({ type: 'document', id: oldest, label: 'Oldest contract.pdf', missing: false });
  });
});
