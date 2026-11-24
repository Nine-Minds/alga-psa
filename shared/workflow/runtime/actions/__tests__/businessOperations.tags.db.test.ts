import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from './_dbTestUtils';
import { useNativeCoManagedVerdict } from './helpers/nativeCoManagedVerdict';

/**
 * tags.add / tags.remove and tickets.update_fields patch.tags write real tag_definitions / tag_mappings.
 * Real DB and real TagModel; only the tenant transaction, permissions, audit capture and event publishing are stubbed.
 */
const runtimeState = vi.hoisted(() => ({
  db: null as Knex | null,
  tenantId: '',
  actorUserId: '',
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
    requirePermission: async () => undefined,
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
import { registerTagActions } from '../businessOperations/tags';

function ctx() {
  return {
    runId: uuidv4(), stepPath: 'steps.tag-action', idempotencyKey: uuidv4(), attempt: 1,
    nowIso: () => new Date().toISOString(), env: {}, tenantId: runtimeState.tenantId,
  } as any;
}

async function invoke(actionId: string, input: Record<string, unknown>) {
  const action = getActionRegistryV2().get(actionId, 1);
  if (!action) throw new Error(`Missing action ${actionId}@1`);
  return action.handler(action.inputSchema.parse(input), ctx());
}

describe('tag workflow actions (DB-backed)', () => {
  let db: Knex;
  let clientId: string;
  let boardId: string;
  let statusId: string;
  const tenant = () => runtimeState.tenantId;

  useNativeCoManagedVerdict();

  beforeAll(async () => {
    db = await createTestDbConnection();
    runtimeState.db = db;
    const tenantRow = await db('tenants').first('tenant');
    runtimeState.tenantId = String(tenantRow.tenant);
    const user = await db('users').where({ tenant: runtimeState.tenantId }).first('user_id');
    runtimeState.actorUserId = String(user.user_id);
    registerTicketActions();
    registerTagActions();

    clientId = uuidv4();
    await db('clients').insert({ tenant: tenant(), client_id: clientId, client_name: 'Tag action client', created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' });
    boardId = uuidv4();
    await db('boards').insert({ tenant: tenant(), board_id: boardId, board_name: 'Tag board', display_order: 0 });
    statusId = uuidv4();
    await db('statuses').insert({ tenant: tenant(), status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', order_number: 1, is_closed: false });
  }, 900_000);

  afterAll(async () => { await db?.destroy(); });

  async function makeTicket(extra: Record<string, unknown> = {}) {
    const ticketId = uuidv4();
    await db('tickets').insert({
      tenant: tenant(), ticket_id: ticketId, ticket_number: `TAG-${ticketId.slice(0, 8)}`, title: 'Tag ticket',
      board_id: boardId, status_id: statusId, client_id: clientId, entered_at: '2026-01-01T00:00:00Z', ...extra,
    });
    return ticketId;
  }

  const mappings = (entityId: string) =>
    db('tag_mappings as tm')
      .join('tag_definitions as td', function () { this.on('td.tenant', 'tm.tenant').andOn('td.tag_id', 'tm.tag_id'); })
      .where({ 'tm.tenant': tenant(), 'tm.tagged_id': entityId })
      .select('tm.mapping_id', 'td.tag_text', 'td.tag_id');
  const texts = async (entityId: string) => (await mappings(entityId)).map((m: any) => m.tag_text).sort();
  const definitionCount = async (text: string, type: string) =>
    Number((await db('tag_definitions').where({ tenant: tenant(), tag_text: text, tagged_type: type }).count('* as c').first())!.c);

  beforeEach(() => undefined);

  it('tags.add on a ticket creates the definition and mapping; a repeat call skips', async () => {
    const ticketId = await makeTicket();
    const text = `wf-${uuidv4().slice(0, 8)}`;

    const first = await invoke('tags.add', { entity_type: 'ticket', entity_id: ticketId, tags: [text, ` ${text} `] });
    expect(first).toMatchObject({ added_count: 1, skipped_count: 0, tags: [text] });
    expect(await definitionCount(text, 'ticket')).toBe(1);
    const before = await mappings(ticketId);
    expect(before).toHaveLength(1);

    const second = await invoke('tags.add', { entity_type: 'ticket', entity_id: ticketId, tags: [text] });
    expect(second).toMatchObject({ added_count: 0, skipped_count: 1, tags: [text] });
    expect(await mappings(ticketId)).toEqual(before);
    expect(await definitionCount(text, 'ticket')).toBe(1);
  });

  it('tags.add reuses an existing definition regardless of case instead of duplicating it', async () => {
    const ticketId = await makeTicket();
    const suffix = uuidv4().slice(0, 8);
    await invoke('tags.add', { entity_type: 'ticket', entity_id: ticketId, tags: [`Urgent-${suffix}`] });
    const other = await makeTicket();
    const out = await invoke('tags.add', { entity_type: 'ticket', entity_id: other, tags: [`urgent-${suffix}`] });
    expect(out.tags).toEqual([`Urgent-${suffix}`]);
    const defs = await db('tag_definitions').where({ tenant: tenant(), tagged_type: 'ticket' }).whereRaw('lower(tag_text) = ?', [`urgent-${suffix}`]);
    expect(defs).toHaveLength(1);
  });

  it('tags.add works on a client', async () => {
    const text = `client-${uuidv4().slice(0, 8)}`;
    const out = await invoke('tags.add', { entity_type: 'client', entity_id: clientId, tags: [text] });
    expect(out).toMatchObject({ added_count: 1, tags: expect.arrayContaining([text]) });
    expect(await definitionCount(text, 'client')).toBe(1);
    expect(await texts(clientId)).toContain(text);
  });

  it('tags.add with an unknown entity_id fails NOT_FOUND and writes nothing', async () => {
    const text = `ghost-${uuidv4().slice(0, 8)}`;
    const ghost = uuidv4();
    await expect(invoke('tags.add', { entity_type: 'ticket', entity_id: ghost, tags: [text] }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await definitionCount(text, 'ticket')).toBe(0);
    expect(await mappings(ghost)).toHaveLength(0);
  });

  it('tags.remove detaches one of two tags, ignores unmapped tags, and keeps the definition', async () => {
    const ticketId = await makeTicket();
    const a = `a-${uuidv4().slice(0, 8)}`;
    const b = `b-${uuidv4().slice(0, 8)}`;
    await invoke('tags.add', { entity_type: 'ticket', entity_id: ticketId, tags: [a, b] });

    const out = await invoke('tags.remove', { entity_type: 'ticket', entity_id: ticketId, tags: [a, 'never-mapped'] });
    expect(out).toMatchObject({ removed_count: 1, missing_count: 1, tags: [b] });
    expect(await texts(ticketId)).toEqual([b]);
    expect(await definitionCount(a, 'ticket')).toBe(1);

    const noop = await invoke('tags.remove', { entity_type: 'ticket', entity_id: ticketId, tags: [a] });
    expect(noop).toMatchObject({ removed_count: 0, missing_count: 1, tags: [b] });
  });

  it('tickets.update_fields patch.tags replaces real tags as a diff, does not write attributes.tags, and [] clears', async () => {
    const ticketId = await makeTicket({ attributes: JSON.stringify({ keep: 'me' }) });
    const keep = `keep-${uuidv4().slice(0, 8)}`;
    const drop = `drop-${uuidv4().slice(0, 8)}`;
    const fresh = `new-${uuidv4().slice(0, 8)}`;
    await invoke('tags.add', { entity_type: 'ticket', entity_id: ticketId, tags: [keep, drop] });
    const keptMapping = (await mappings(ticketId)).find((m: any) => m.tag_text === keep)!.mapping_id;

    const out = await invoke('tickets.update_fields', { ticket_id: ticketId, patch: { tags: [keep, fresh] } });
    expect(out.tags).toEqual([keep, fresh].sort((a, b) => a.localeCompare(b)));
    expect(await texts(ticketId)).toEqual([keep, fresh].sort((a, b) => a.localeCompare(b)));
    // Unchanged mapping keeps its identity; the dropped tag's definition survives.
    expect((await mappings(ticketId)).find((m: any) => m.tag_text === keep)!.mapping_id).toBe(keptMapping);
    expect(await definitionCount(drop, 'ticket')).toBe(1);
    const row = await db('tickets').where({ tenant: tenant(), ticket_id: ticketId }).first('attributes');
    const attrs = typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes;
    expect(attrs).toEqual({ keep: 'me' });

    const cleared = await invoke('tickets.update_fields', { ticket_id: ticketId, patch: { tags: [] } });
    expect(cleared.tags).toEqual([]);
    expect(await mappings(ticketId)).toHaveLength(0);
  });
});
