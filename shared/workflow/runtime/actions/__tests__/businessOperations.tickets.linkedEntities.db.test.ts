import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from './_dbTestUtils';
import { useNativeCoManagedVerdict } from './helpers/nativeCoManagedVerdict';

/**
 * tickets.find_linked_entities / tickets.link_entities against a real DB. Only the tenant transaction,
 * permission check, audit capture and event publishing are stubbed. Requires the dev DB stack.
 */
const runtimeState = vi.hoisted(() => ({
  db: null as Knex | null,
  tenantId: '',
  actorUserId: '',
  denied: new Set<string>(),
}));

vi.mock('../businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../businessOperations/shared')>();
  return {
    ...actual,
    withTenantTransaction: async (_ctx: any, fn: any) => {
      if (!runtimeState.db) throw new Error('DB unavailable for test runtime state');
      return runtimeState.db.transaction(async (trx) => {
        await trx.raw(`select set_config('app.current_tenant', ?, true)`, [runtimeState.tenantId]);
        return fn({ tenantId: runtimeState.tenantId, actorUserId: runtimeState.actorUserId, trx });
      });
    },
    requirePermission: async (ctx: any, _tx: any, p: { resource: string; action: string }) => {
      if (runtimeState.denied.has(`${p.resource}:${p.action}`)) {
        actual.throwActionError(ctx, { category: 'ActionError', code: 'PERMISSION_DENIED', message: `Permission denied: ${p.resource}:${p.action}` });
      }
    },
    writeRunAudit: async () => undefined,
  };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerTicketActions } from '../businessOperations/tickets';

function ctx() {
  return {
    runId: uuidv4(), stepPath: 'steps.linked', idempotencyKey: uuidv4(), attempt: 1,
    nowIso: () => new Date().toISOString(), env: {}, tenantId: runtimeState.tenantId,
  } as any;
}

async function invoke(actionId: string, input: Record<string, unknown>) {
  const action = getActionRegistryV2().get(actionId, 1);
  if (!action) throw new Error(`Missing action ${actionId}@1`);
  return action.handler(action.inputSchema.parse(input), ctx());
}

describe('tickets.find_linked_entities / tickets.link_entities (DB-backed)', () => {
  let db: Knex;
  let tenant: string;
  let clientId: string;
  let boardId: string;
  let statusId: string;

  useNativeCoManagedVerdict();

  beforeAll(async () => {
    db = await createTestDbConnection();
    runtimeState.db = db;
    tenant = String((await db('tenants').first('tenant')).tenant);
    runtimeState.tenantId = tenant;
    runtimeState.actorUserId = String((await db('users').where({ tenant }).first('user_id')).user_id);
    registerTicketActions();

    clientId = uuidv4();
    await db('clients').insert({ tenant, client_id: clientId, client_name: 'Linked entities client', created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' });
    boardId = uuidv4();
    await db('boards').insert({ tenant, board_id: boardId, board_name: 'Linked board', display_order: 0 });
    statusId = uuidv4();
    await db('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', order_number: 1, is_closed: false });
  }, 900_000);

  afterAll(async () => { await db?.destroy(); });
  beforeEach(() => { runtimeState.denied.clear(); });

  async function makeTicket() {
    const ticketId = uuidv4();
    await db('tickets').insert({
      tenant, ticket_id: ticketId, ticket_number: `LNK-${ticketId.slice(0, 8)}`, title: 'Linked ticket',
      board_id: boardId, status_id: statusId, client_id: clientId, entered_at: '2026-01-01T00:00:00Z',
    });
    return ticketId;
  }

  async function makeAsset(name: string) {
    const assetId = uuidv4();
    await db('assets').insert({
      tenant, asset_id: assetId, asset_type: 'workstation', asset_tag: `TAG-${assetId.slice(0, 6)}`,
      name, client_id: clientId, status: 'active',
    });
    return assetId;
  }

  async function associate(assetId: string, ticketId: string, relationship = 'affected', at = '2026-02-01T00:00:00Z') {
    await db('asset_associations').insert({
      tenant, asset_id: assetId, entity_id: ticketId, entity_type: 'ticket', relationship_type: relationship,
      created_by: runtimeState.actorUserId, created_at: at,
    });
  }

  async function mapExternal(assetId: string, integrationType: string, externalId: string) {
    await db('tenant_external_entity_mappings').insert({
      id: uuidv4(), tenant, integration_type: integrationType, alga_entity_type: 'asset',
      alga_entity_id: assetId, external_entity_id: externalId, sync_status: 'synced',
    });
  }

  async function makeProject(name: string) {
    const projectId = uuidv4();
    await db('projects').insert({ tenant, project_id: projectId, project_name: name, client_id: clientId, wbs_code: `P${projectId.slice(0, 4)}`, is_inactive: false });
    return projectId;
  }

  it('returns an asset with name, tag and the RMM provider/device ids (Level and NinjaOne)', async () => {
    const ticketId = await makeTicket();
    const assetId = await makeAsset('Front desk PC');
    await associate(assetId, ticketId);
    await mapExternal(assetId, 'levelio', 'level-dev-1');
    await mapExternal(assetId, 'ninjaone', '4242');

    const out = await invoke('tickets.find_linked_entities', { ticket_id: ticketId, entity_type: 'asset' });
    expect(out.links).toHaveLength(1);
    expect(out.links[0]).toMatchObject({
      entity_type: 'asset', entity_id: assetId, name: 'Front desk PC', relationship_type: 'affected', source: 'asset_associations',
      asset: { asset_id: assetId, asset_name: 'Front desk PC', client_id: clientId },
    });
    expect(out.links[0].legacy).toBeUndefined();
    expect(out.links[0].external_ids).toEqual(expect.arrayContaining([
      expect.objectContaining({ integration_type: 'levelio', external_entity_id: 'level-dev-1' }),
      expect.objectContaining({ integration_type: 'ninjaone', external_entity_id: '4242' }),
    ]));
  });

  it('include_external_ids=false omits external ids', async () => {
    const ticketId = await makeTicket();
    const assetId = await makeAsset('No ext');
    await associate(assetId, ticketId);
    await mapExternal(assetId, 'levelio', 'x');
    const out = await invoke('tickets.find_linked_entities', { ticket_id: ticketId, include_external_ids: false });
    expect(out.links[0].external_ids).toBeUndefined();
  });

  it('entity_type=all returns assets and projects; entity_type=asset returns assets only', async () => {
    const ticketId = await makeTicket();
    const assetId = await makeAsset('Mixed asset');
    await associate(assetId, ticketId);
    const projectId = await makeProject('Mixed project');
    await invoke('tickets.link_entities', { ticket_id: ticketId, entity_type: 'project', entity_id: projectId, link_type: 'related' });

    const all = await invoke('tickets.find_linked_entities', { ticket_id: ticketId });
    expect(all.links.map((l: any) => l.entity_type).sort()).toEqual(['asset', 'project']);
    expect(all.links.find((l: any) => l.entity_type === 'project')).toMatchObject({ name: 'Mixed project', source: 'ticket_entity_links' });

    const assets = await invoke('tickets.find_linked_entities', { ticket_id: ticketId, entity_type: 'asset' });
    expect(assets.links.map((l: any) => l.entity_type)).toEqual(['asset']);
  });

  it('relationship_type filters asset links', async () => {
    const ticketId = await makeTicket();
    const a = await makeAsset('Affected');
    const r = await makeAsset('Related');
    await associate(a, ticketId, 'affected');
    await associate(r, ticketId, 'related');
    const out = await invoke('tickets.find_linked_entities', { ticket_id: ticketId, entity_type: 'asset', relationship_type: 'related' });
    expect(out.links.map((l: any) => l.entity_id)).toEqual([r]);
  });

  it('surfaces a legacy ticket_entity_links asset row once, marked legacy, and de-duplicates against asset_associations', async () => {
    const ticketId = await makeTicket();
    const legacyOnly = await makeAsset('Legacy only');
    const both = await makeAsset('In both stores');
    await associate(both, ticketId);
    for (const id of [legacyOnly, both]) {
      await db('ticket_entity_links').insert({ tenant, link_id: uuidv4(), ticket_id: ticketId, entity_type: 'asset', entity_id: id, link_type: 'affected' });
    }
    const out = await invoke('tickets.find_linked_entities', { ticket_id: ticketId, entity_type: 'asset' });
    expect(out.links).toHaveLength(2);
    const byId = new Map(out.links.map((l: any) => [l.entity_id, l]));
    expect(byId.get(legacyOnly)).toMatchObject({ legacy: true, source: 'ticket_entity_links', name: 'Legacy only' });
    expect(byId.get(both)).toMatchObject({ source: 'asset_associations' });
    expect((byId.get(both) as any).legacy).toBeUndefined();
  });

  it('limit caps the result; empty ticket returns [] or NOT_FOUND per on_not_found; unknown ticket is NOT_FOUND', async () => {
    const ticketId = await makeTicket();
    for (let i = 0; i < 3; i += 1) await associate(await makeAsset(`Limit ${i}`), ticketId, 'affected', `2026-03-0${i + 1}T00:00:00Z`);
    const limited = await invoke('tickets.find_linked_entities', { ticket_id: ticketId, limit: 2 });
    expect(limited.links).toHaveLength(2);

    const empty = await makeTicket();
    expect((await invoke('tickets.find_linked_entities', { ticket_id: empty })).links).toEqual([]);
    await expect(invoke('tickets.find_linked_entities', { ticket_id: empty, on_not_found: 'error' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(invoke('tickets.find_linked_entities', { ticket_id: uuidv4() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('denies without asset:read when assets can be returned, but allows non-asset reads', async () => {
    const ticketId = await makeTicket();
    runtimeState.denied.add('asset:read');
    await expect(invoke('tickets.find_linked_entities', { ticket_id: ticketId })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(invoke('tickets.find_linked_entities', { ticket_id: ticketId, entity_type: 'asset' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(invoke('tickets.find_linked_entities', { ticket_id: ticketId, entity_type: 'project' })).resolves.toMatchObject({ links: [] });
    runtimeState.denied.clear();
    runtimeState.denied.add('ticket:read');
    await expect(invoke('tickets.find_linked_entities', { ticket_id: ticketId, entity_type: 'project' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('tickets.link_entities writes asset_associations, is idempotent, and the link is then readable', async () => {
    const ticketId = await makeTicket();
    const assetId = await makeAsset('Linked via workflow');
    const first = await invoke('tickets.link_entities', { ticket_id: ticketId, entity_type: 'asset', entity_id: assetId, link_type: 'affected' });
    const second = await invoke('tickets.link_entities', { ticket_id: ticketId, entity_type: 'asset', entity_id: assetId, link_type: 'affected' });
    expect(first.source).toBe('asset_associations');
    expect(second.link_id).toBe(first.link_id);

    const rows = await db('asset_associations').where({ tenant, asset_id: assetId, entity_id: ticketId, entity_type: 'ticket' });
    expect(rows).toHaveLength(1);
    expect(await db('ticket_entity_links').where({ tenant, ticket_id: ticketId, entity_type: 'asset' })).toHaveLength(0);

    const out = await invoke('tickets.find_linked_entities', { ticket_id: ticketId, entity_type: 'asset' });
    expect(out.links.map((l: any) => l.entity_id)).toEqual([assetId]);
  });

  it('tickets.link_entities keeps CONFLICT for non-asset duplicates and NOT_FOUND for missing targets', async () => {
    const ticketId = await makeTicket();
    const projectId = await makeProject('Dup project');
    const input = { ticket_id: ticketId, entity_type: 'project', entity_id: projectId, link_type: 'related' };
    await invoke('tickets.link_entities', input);
    await expect(invoke('tickets.link_entities', input)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(invoke('tickets.link_entities', { ...input, entity_type: 'asset', entity_id: uuidv4() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
