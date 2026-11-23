/**
 * Client-owned staging through equipment custody (alga-2026-0002683, C6 follow-up) against the isolated
 * migrated test DB. Design: docs/plans/2026-11-23-client-owned-staging-custody.md.
 * Every case runs in a transaction that is rolled back.
 * Run from the repository root: node scripts/run-workspace-db-tests.mjs packages/inventory/src/lib/stagingCustody.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const testState = vi.hoisted(() => ({ trx: null as any, tenant: '' }));

vi.mock('@alga-psa/db', async () => ({
  ...(await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db')),
  createTenantKnex: vi.fn(async () => ({ knex: testState.trx })),
}));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => fn }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));

import { insertTestAssets } from '../../../../shared/test-utils/assetFixtures';
import { openCustody } from '@alga-psa/assets/lib/custody/openCustody';
import { recordCustodyEvent } from '@alga-psa/assets/lib/custody/recordCustodyEvent';
import { addClientLines, installLines, releaseLines, releaseStagingForProject, releaseStagingForTasks } from './staging';
import { createContainer, listContainers, packLines, reopenContainer, sealContainer, stagingContainerIdentifier, unpackLine } from './stagingContainers';
import { createStagingCustodyContext, publishStagingCustody, type StagingCustodyPublication } from './stagingCustody';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();

let knex: Knex;
let TENANT: string;
let LOCATION: string;
let CLIENT: string;
let USER: string;

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: databaseConnection, pool: { min: 1, max: 4 } });
  TENANT = await createInventoryTestTenant(knex);
  testState.tenant = TENANT;
  LOCATION = (await knex('stock_locations').where({ tenant: TENANT, is_default: true }).first()).location_id;
  CLIENT = (await knex('clients').where({ tenant: TENANT }).first()).client_id;
  USER = (await knex('users').where({ tenant: TENANT }).first()).user_id;
});
beforeEach(async () => { testState.trx = await knex.transaction(); });
afterEach(async () => { await testState.trx?.rollback(); testState.trx = null; });
afterAll(async () => { await knex?.destroy(); });

const trx = (): Knex.Transaction => testState.trx;
const db = (): Knex => testState.trx as unknown as Knex;

async function makeProject(): Promise<{ projectId: string; projectNumber: string; taskId: string }> {
  const status = (await trx()('statuses').where({ tenant: TENANT }).first()).status_id;
  const n = randomUUID().slice(0, 8);
  const [p] = await trx()('projects')
    .insert({ tenant: TENANT, project_name: `ZZ custody ${n}`, client_id: CLIENT, status, wbs_code: n, project_number: `PRJ-${n}` })
    .returning(['project_id', 'project_number']);
  const [phase] = await trx()('project_phases')
    .insert({ tenant: TENANT, project_id: p.project_id, phase_name: 'Install', status: 'active', order_number: 1, wbs_code: `${n}.1`, order_key: 'a0' })
    .returning('phase_id');
  const [task] = await trx()('project_tasks')
    .insert({ tenant: TENANT, phase_id: phase.phase_id, task_name: 'Rack and stack', wbs_code: `${n}.1.1` })
    .returning('task_id');
  return { projectId: p.project_id, projectNumber: p.project_number, taskId: task.task_id };
}

async function makeAsset(status = 'active'): Promise<string> {
  const [asset] = await insertTestAssets(trx(), { tenant: TENANT, asset_tag: `CU-${randomUUID().slice(0, 6)}`, name: 'Client firewall', status, client_id: CLIENT, asset_type: 'unknown' });
  return asset.asset_id;
}

const count = async (table: string, where: Record<string, unknown> = {}): Promise<number> =>
  Number((await trx()(table).where({ tenant: TENANT, ...where }).count<{ c: string }>('* as c').first())?.c ?? 0);
const episodes = (assetId: string) => trx()('asset_custody').where({ tenant: TENANT, asset_id: assetId }).orderBy('opened_at', 'asc');
const events = (assetId: string) => trx()('asset_custody_events').where({ tenant: TENANT, asset_id: assetId }).orderBy('recorded_at', 'asc').orderBy('event_id', 'asc');
const eventTypes = async (assetId: string) => (await events(assetId)).map((e: any) => e.event_type);
const assetStatus = async (assetId: string) => (await trx()('assets').where({ tenant: TENANT, asset_id: assetId }).first('status')).status;

async function stageAsset(projectId: string, assetId = '') {
  const id = assetId || (await makeAsset());
  const [line] = await addClientLines(db(), TENANT, { project_id: projectId, items: [{ kind: 'client_asset', asset_id: id }] }, USER);
  return { assetId: id, line };
}

async function openBox(projectId: string, extra: Record<string, unknown> = {}) {
  const box = await createContainer(db(), TENANT, { project_id: projectId, ...extra }, USER);
  const project = await trx()('projects').where({ tenant: TENANT, project_id: projectId }).first('project_number');
  return { box, identifier: stagingContainerIdentifier(project.project_number, box.sequence) };
}

const stockRows = async () => ({
  units: await count('stock_units'), moves: await count('stock_movements'), levels: await count('stock_levels'), materials: await count('project_materials'),
});

describe('state machine and cores', () => {
  it('sealed / unsealed are legal only from in_office', async () => {
    const { nextCustodyState } = await import('@alga-psa/assets/lib/custody/stateMachine');
    expect(nextCustodyState('in_office', 'sealed')).toBe('in_office');
    expect(nextCustodyState('in_office', 'unsealed')).toBe('in_office');
    expect(nextCustodyState('with_vendor', 'sealed')).toBeNull();
    expect(nextCustodyState('closed', 'unsealed')).toBeNull();
  });

  it('returned with close_reason installed_at_client closes the episode and writes exactly one event; default stays returned_to_client', async () => {
    const assetId = await makeAsset();
    const opened = await openCustody(trx(), TENANT, USER, { asset_id: assetId, ticket_id: null, purpose: 'repair', location_id: LOCATION, bin: null, next_action_party: 'msp', next_action_note: null, follow_up_on: null, condition_note: null, accessories: [], document_ids: [], note: null } as any);
    const before = (await events(assetId)).length;
    const result = await recordCustodyEvent(trx(), TENANT, USER, opened.custody.custody_id, { event_type: 'returned', counterparty: null, close_reason: 'installed_at_client', note: null, document_ids: [] });
    expect(result.custody.state).toBe('closed');
    expect(result.custody.close_reason).toBe('installed_at_client');
    expect((await events(assetId)).length).toBe(before + 1);

    const other = await makeAsset();
    const o2 = await openCustody(trx(), TENANT, USER, { asset_id: other, ticket_id: null, purpose: 'repair', location_id: LOCATION, bin: null, next_action_party: 'msp', next_action_note: null, follow_up_on: null, condition_note: null, accessories: [], document_ids: [], note: null } as any);
    const r2 = await recordCustodyEvent(trx(), TENANT, USER, o2.custody.custody_id, { event_type: 'returned', counterparty: null, note: null, document_ids: [] });
    expect(r2.custody.close_reason).toBe('returned_to_client');
  });

  it('openCustody moves an active asset to held_by_msp and leaves retired alone', async () => {
    const active = await makeAsset('active');
    const retired = await makeAsset('retired');
    const input = { ticket_id: null, purpose: 'repair', location_id: LOCATION, bin: null, next_action_party: 'msp', next_action_note: null, follow_up_on: null, condition_note: null, accessories: [], document_ids: [], note: null } as any;
    const a = await openCustody(trx(), TENANT, USER, { ...input, asset_id: active });
    const r = await openCustody(trx(), TENANT, USER, { ...input, asset_id: retired });
    expect(await assetStatus(active)).toBe('held_by_msp');
    expect(a.assetStatusChange).toEqual({ assetId: active, before: 'active', after: 'held_by_msp' });
    expect(await assetStatus(retired)).toBe('retired');
    expect(r.assetStatusChange).toBeNull();
  });
});

describe('add', () => {
  it('an asset with no episode gets exactly one staging episode in the same transaction', async () => {
    const { projectId } = await makeProject();
    const publications: StagingCustodyPublication[] = [];
    const assetId = await makeAsset();
    const [line] = await addClientLines(db(), TENANT, { project_id: projectId, items: [{ kind: 'client_asset', asset_id: assetId }] }, USER, { publications });
    expect(line.status).toBe('received');
    const rows = await episodes(assetId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: 'staging', state: 'in_office', next_action_party: 'msp', location_id: LOCATION, closed_at: null });
    expect(await eventTypes(assetId)).toEqual(['received']);
    expect(await assetStatus(assetId)).toBe('held_by_msp');
    expect(publications.map((p) => p.kind)).toEqual(['opened']);
    await publishStagingCustody(TENANT, { user_id: USER, user_type: 'internal' }, publications);
  });

  it('an asset already in a repair episode links it: purpose unchanged, no second episode', async () => {
    const { projectId } = await makeProject();
    const assetId = await makeAsset();
    const repair = await openCustody(trx(), TENANT, USER, { asset_id: assetId, ticket_id: null, purpose: 'repair', location_id: LOCATION, bin: 'Shelf 2', next_action_party: 'vendor', next_action_note: null, follow_up_on: null, condition_note: null, accessories: [], document_ids: [], note: null } as any);
    const publications: StagingCustodyPublication[] = [];
    await addClientLines(db(), TENANT, { project_id: projectId, items: [{ kind: 'client_asset', asset_id: assetId }] }, USER, { publications });
    const rows = await episodes(assetId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ custody_id: repair.custody.custody_id, purpose: 'repair', next_action_party: 'vendor', bin: 'Shelf 2' });
    expect(publications).toEqual([]);
  });

  it('a client_item free-text line produces no custody rows', async () => {
    const { projectId } = await makeProject();
    const before = { episodes: await count('asset_custody'), events: await count('asset_custody_events') };
    const [line] = await addClientLines(db(), TENANT, { project_id: projectId, items: [{ kind: 'client_item', description: 'Rack rails', quantity: 4 }] }, USER);
    const { box } = await openBox(projectId);
    await packLines(db(), TENANT, box.container_id, [{ staging_line_id: line.staging_line_id }], USER);
    await sealContainer(db(), TENANT, box.container_id, USER);
    await reopenContainer(db(), TENANT, box.container_id, USER);
    await installLines(db(), TENANT, [line.staging_line_id], USER);
    expect({ episodes: await count('asset_custody'), events: await count('asset_custody_events') }).toEqual(before);
  });
});

describe('box steps', () => {
  it('pack moves to the box identifier (and the box location); seal writes one sealed per client asset; reopen unseals; unpack moves out', async () => {
    const { projectId } = await makeProject();
    const a = await stageAsset(projectId);
    const b = await stageAsset(projectId);
    const [loc2] = await trx()('stock_locations').insert({ tenant: TENANT, location_id: randomUUID(), name: `Staging room ${randomUUID().slice(0, 4)}`, location_type: 'warehouse', is_default: false, is_active: true }).returning('location_id');
    const { box, identifier } = await openBox(projectId, { stock_location_id: loc2.location_id });
    await packLines(db(), TENANT, box.container_id, [a.line, b.line].map((l) => ({ staging_line_id: l.staging_line_id })), USER);

    for (const x of [a, b]) {
      const [episode] = await episodes(x.assetId);
      expect(episode).toMatchObject({ bin: identifier, location_id: loc2.location_id, state: 'in_office' });
      const moved = (await events(x.assetId)).filter((e: any) => e.event_type === 'moved');
      expect(moved).toHaveLength(1);
      expect(moved[0]).toMatchObject({ to_bin: identifier, to_location_id: loc2.location_id });
    }
    expect((await trx()('project_staging_lines').where({ tenant: TENANT, staging_line_id: a.line.staging_line_id }).first()).status).toBe('staged');

    await sealContainer(db(), TENANT, box.container_id, USER);
    for (const x of [a, b]) expect((await eventTypes(x.assetId)).filter((t: string) => t === 'sealed')).toHaveLength(1);
    await sealContainer(db(), TENANT, box.container_id, USER); // already sealed: no duplicate
    expect((await eventTypes(a.assetId)).filter((t: string) => t === 'sealed')).toHaveLength(1);

    await reopenContainer(db(), TENANT, box.container_id, USER);
    expect((await eventTypes(a.assetId)).filter((t: string) => t === 'unsealed')).toHaveLength(1);

    await unpackLine(db(), TENANT, box.container_id, a.line.staging_line_id, null, USER);
    const [after] = await episodes(a.assetId);
    expect(after).toMatchObject({ bin: null, closed_at: null });
    const out = (await events(a.assetId)).filter((e: any) => e.event_type === 'moved').pop();
    expect(out).toMatchObject({ from_bin: identifier, to_bin: null });
  });
});

describe('install', () => {
  it('closes the episode as installed_at_client with one returned event, removes the box membership and restores the asset status', async () => {
    const { projectId } = await makeProject();
    const x = await stageAsset(projectId);
    const { box } = await openBox(projectId);
    await packLines(db(), TENANT, box.container_id, [{ staging_line_id: x.line.staging_line_id }], USER);
    await sealContainer(db(), TENANT, box.container_id, USER);
    const publications: StagingCustodyPublication[] = [];
    const results = await installLines(db(), TENANT, [x.line.staging_line_id], USER, { custody: { publications } });
    expect(results).toEqual([{ staging_line_id: x.line.staging_line_id, ok: true, project_material_id: null }]);
    const [episode] = await episodes(x.assetId);
    expect(episode).toMatchObject({ state: 'closed', close_reason: 'installed_at_client' });
    expect((await eventTypes(x.assetId)).filter((t: string) => t === 'returned')).toHaveLength(1);
    expect(await count('staging_container_members', { staging_line_id: x.line.staging_line_id })).toBe(0);
    expect(await assetStatus(x.assetId)).toBe('active');
    expect(publications.map((p) => p.kind)).toEqual(['recorded']);
  });

  it('full add -> pack -> seal -> install cycle writes no stock, movement, level or material rows', async () => {
    const { projectId } = await makeProject();
    const before = await stockRows();
    const billingBefore = { time: await count('time_entries'), invoices: await count('invoices') };
    const x = await stageAsset(projectId);
    const { box } = await openBox(projectId);
    await packLines(db(), TENANT, box.container_id, [{ staging_line_id: x.line.staging_line_id }], USER);
    await sealContainer(db(), TENANT, box.container_id, USER);
    await installLines(db(), TENANT, [x.line.staging_line_id], USER);
    expect(await stockRows()).toEqual(before);
    expect({ time: await count('time_entries'), invoices: await count('invoices') }).toEqual(billingBefore);
  });

  it('a caller without asset:update is refused on the client-asset line only; the free-text line in the same install goes through', async () => {
    const { projectId } = await makeProject();
    const x = await stageAsset(projectId);
    const [item] = await addClientLines(db(), TENANT, { project_id: projectId, items: [{ kind: 'client_item', description: 'Spare PSU' }] }, USER);
    const denied = createStagingCustodyContext({ tenant: TENANT, user: { user_id: USER, user_type: 'internal' }, canUpdateAssets: false });
    const results = await installLines(db(), TENANT, [x.line.staging_line_id, item.staging_line_id], USER, { custody: denied });
    expect(results[0]).toMatchObject({ staging_line_id: x.line.staging_line_id, ok: false });
    expect(results[1]).toMatchObject({ staging_line_id: item.staging_line_id, ok: true });
    expect((await episodes(x.assetId))[0].closed_at).toBeNull();
    expect((await trx()('project_staging_lines').where({ tenant: TENANT, staging_line_id: x.line.staging_line_id }).first()).status).toBe('received');
  });
});

describe('authorization', () => {
  it('adding a client asset without asset:update is a typed custody_forbidden refusal and writes nothing', async () => {
    const { projectId } = await makeProject();
    const assetId = await makeAsset();
    const denied = createStagingCustodyContext({ tenant: TENANT, user: { user_id: USER, user_type: 'internal' }, canUpdateAssets: false });
    const sp = await trx().transaction();
    await expect(addClientLines(sp as unknown as Knex, TENANT, { project_id: projectId, items: [{ kind: 'client_asset', asset_id: assetId }] }, USER, denied))
      .rejects.toMatchObject({ name: 'StagingError', code: 'custody_forbidden' });
    await sp.rollback();
    expect(await episodes(assetId)).toHaveLength(0);
  });

  it('with asset:update the record-level check passes for an internal user', async () => {
    const { projectId } = await makeProject();
    const assetId = await makeAsset();
    const allowed = createStagingCustodyContext({ tenant: TENANT, user: { user_id: USER, user_type: 'internal' }, canUpdateAssets: true });
    await addClientLines(db(), TENANT, { project_id: projectId, items: [{ kind: 'client_asset', asset_id: assetId }] }, USER, allowed);
    expect(await episodes(assetId)).toHaveLength(1);
  });
});

describe('release paths never close custody', () => {
  async function boxed(projectId: string, opts: { sealed?: boolean } = {}) {
    const x = await stageAsset(projectId);
    const { box, identifier } = await openBox(projectId);
    await packLines(db(), TENANT, box.container_id, [{ staging_line_id: x.line.staging_line_id }], USER);
    if (opts.sealed) await sealContainer(db(), TENANT, box.container_id, USER);
    return { ...x, box, identifier };
  }
  const expectUnpackedAndOpen = async (assetId: string, lineId: string, identifier: string) => {
    const [episode] = await episodes(assetId);
    expect(episode).toMatchObject({ state: 'in_office', closed_at: null, bin: null });
    expect(await count('staging_container_members', { staging_line_id: lineId })).toBe(0);
    const moved = (await events(assetId)).filter((e: any) => e.event_type === 'moved').pop();
    expect(moved).toMatchObject({ from_bin: identifier, to_bin: null });
    expect(await eventTypes(assetId)).not.toContain('returned');
  };

  it('user release of a boxed line', async () => {
    const { projectId } = await makeProject();
    const x = await boxed(projectId);
    await releaseLines(db(), TENANT, [x.line.staging_line_id], USER);
    await expectUnpackedAndOpen(x.assetId, x.line.staging_line_id, x.identifier);
    expect(await episodes(x.assetId)).toHaveLength(1);
  });

  it('task delete (releaseStagingForTasks), including a sealed box that gets reopened', async () => {
    const { projectId, taskId } = await makeProject();
    const assetId = await makeAsset();
    const [line] = await addClientLines(db(), TENANT, { project_id: projectId, task_id: taskId, items: [{ kind: 'client_asset', asset_id: assetId }] }, USER);
    const { box, identifier } = await openBox(projectId, { task_id: taskId });
    await packLines(db(), TENANT, box.container_id, [{ staging_line_id: line.staging_line_id }], USER);
    await sealContainer(db(), TENANT, box.container_id, USER);
    await releaseStagingForTasks(trx(), TENANT, [taskId], USER);
    await expectUnpackedAndOpen(assetId, line.staging_line_id, identifier);
    expect(await eventTypes(assetId)).toContain('unsealed');
  });

  it('project delete (releaseStagingForProject): moved out before the box rows go, episode left open', async () => {
    const { projectId } = await makeProject();
    const x = await boxed(projectId, { sealed: true });
    await releaseStagingForProject(trx(), TENANT, projectId, null);
    expect(await count('staging_containers', { project_id: projectId })).toBe(0);
    expect(await count('project_staging_lines', { project_id: projectId })).toBe(0);
    const [episode] = await episodes(x.assetId);
    expect(episode).toMatchObject({ state: 'in_office', closed_at: null, bin: null });
    expect(await eventTypes(x.assetId)).not.toContain('returned');
  });

  it('release of an unboxed client line writes no custody event', async () => {
    const { projectId } = await makeProject();
    const x = await stageAsset(projectId);
    const before = (await events(x.assetId)).length;
    await releaseLines(db(), TENANT, [x.line.staging_line_id], USER);
    expect((await events(x.assetId)).length).toBe(before);
    expect((await episodes(x.assetId))[0].closed_at).toBeNull();
  });
});

describe('list', () => {
  it('listContainers still lists client members (label ownership input)', async () => {
    const { projectId } = await makeProject();
    const x = await stageAsset(projectId);
    const { box } = await openBox(projectId);
    await packLines(db(), TENANT, box.container_id, [{ staging_line_id: x.line.staging_line_id }], USER);
    const [view] = await listContainers(db(), TENANT, projectId);
    expect(view.members.map((m) => m.kind)).toEqual(['client_asset']);
  });
});
