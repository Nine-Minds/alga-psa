import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

import { deleteBoard } from '../../../../packages/tickets/src/actions/board-actions/boardActions';

const HOOK_TIMEOUT = 180_000;

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
  await tenantTable(tenantId, 'canned_responses').del();
  await tenantTable(tenantId, 'checklist_template_apply_rules').del();
  await tenantTable(tenantId, 'checklist_templates').del();
  await tenantTable(tenantId, 'recurring_ticket_definitions').del();
  await tenantTable(tenantId, 'ticket_templates').del();
  await tenantTable(tenantId, 'email_sender_routes').del();
  await tenantTable(tenantId, 'email_sender_addresses').del();
  await tenantTable(tenantId, 'tag_mappings').del();
  await tenantTable(tenantId, 'tag_definitions').del();
  await tenantTable(tenantId, 'client_portal_visibility_group_boards').del();
  await tenantTable(tenantId, 'client_portal_visibility_groups').del();
  await tenantTable(tenantId, 'tickets').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantTable(tenantId, 'statuses').del();
  await tenantTable(tenantId, 'boards').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createTenantFixture(boards: Array<{ boardId: string; name: string; isDefault?: boolean }>) {
  const tenantId = uuidv4();
  const userId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });

  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `user-${tenantId.slice(0, 8)}@example.com`,
  });

  await tenantTable(tenantId, 'boards').insert(boards.map((board, index) => ({
    tenant: tenantId,
    board_id: board.boardId,
    board_name: board.name,
    display_order: (index + 1) * 10,
    is_default: board.isDefault ?? false,
    is_inactive: false,
    category_type: 'custom',
    priority_type: 'custom',
  })));

  dbRef.knex = db;
  dbRef.tenant = tenantId;
  userRef.user = { user_id: userId, user_type: 'internal', tenant: tenantId };

  return { tenantId, userId };
}

async function addTicketStatus(tenantId: string, userId: string, boardId: string): Promise<string> {
  const statusId = uuidv4();
  await tenantTable(tenantId, 'statuses').insert({
    tenant: tenantId,
    status_id: statusId,
    board_id: boardId,
    name: 'New',
    status_type: 'ticket',
    item_type: 'ticket',
    order_number: 1,
    is_default: true,
    is_closed: false,
    created_by: userId,
  });
  return statusId;
}

describe('board deletion dependency cleanup', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
      tenantsToCleanup.delete(tenantId);
    }
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('deletes a board that nothing references through the lightweight path', async () => {
    const defaultBoardId = uuidv4();
    const bareBoardId = uuidv4();
    const { tenantId } = await createTenantFixture([
      { boardId: defaultBoardId, name: 'General', isDefault: true },
      { boardId: bareBoardId, name: 'Empty' },
    ]);

    const result = await deleteBoard(bareBoardId);

    expect(result.success).toBe(true);

    const remainingBoards = await tenantTable(tenantId, 'boards').pluck('board_id');
    expect(remainingBoards).toEqual([defaultBoardId]);
  }, HOOK_TIMEOUT);

  it('keeps tenant-wide tags and removes portal visibility assignments', async () => {
    const defaultBoardId = uuidv4();
    const doomedBoardId = uuidv4();
    const { tenantId, userId } = await createTenantFixture([
      { boardId: defaultBoardId, name: 'General', isDefault: true },
      { boardId: doomedBoardId, name: 'Field Work' },
    ]);

    await addTicketStatus(tenantId, userId, doomedBoardId);

    // A tag definition is unique per (tenant, tag_text, tagged_type) and shared
    // tenant-wide; board_id is only provenance from the channels era. The
    // mapping below stands in for the ones that live on OTHER boards: deleting
    // the definition would cascade them all away.
    const tagId = uuidv4();
    await tenantTable(tenantId, 'tag_definitions').insert({
      tenant: tenantId,
      tag_id: tagId,
      tag_text: 'onsite',
      tagged_type: 'ticket',
      board_id: doomedBoardId,
    });
    const tagMappingId = uuidv4();
    await tenantTable(tenantId, 'tag_mappings').insert({
      tenant: tenantId,
      mapping_id: tagMappingId,
      tag_id: tagId,
      tagged_id: uuidv4(),
      tagged_type: 'ticket',
    });

    const clientId = uuidv4();
    await tenantTable(tenantId, 'clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: 'Acme',
    });
    const groupId = uuidv4();
    await tenantTable(tenantId, 'client_portal_visibility_groups').insert({
      tenant: tenantId,
      group_id: groupId,
      client_id: clientId,
      name: 'Field techs',
    });
    await tenantTable(tenantId, 'client_portal_visibility_group_boards').insert({
      tenant: tenantId,
      group_id: groupId,
      board_id: doomedBoardId,
    });

    // The user must see the portal assignments before they go: the confirmation
    // enumerates them and only the confirmed delete removes them. Tags are NOT
    // listed — nothing is removed, so there is nothing to consent to.
    const confirmation = await deleteBoard(doomedBoardId);
    expect(confirmation.success).toBe(false);
    expect(confirmation.code).toBe('BOARD_HAS_STATUSES');
    expect(confirmation.counts).toEqual({
      statuses: 1,
      portal_visibility_assignments: 1,
    });

    const result = await deleteBoard(doomedBoardId, true);
    expect(result.success).toBe(true);

    const remainingBoards = await tenantTable(tenantId, 'boards').pluck('board_id');
    expect(remainingBoards).toEqual([defaultBoardId]);

    // The tag survives with its provenance cleared: deleting it would strip the
    // tag off every entity in the tenant through the tag_mappings cascade.
    const tagDef = await tenantTable(tenantId, 'tag_definitions').where({ tag_id: tagId }).first();
    expect(tagDef).toBeTruthy();
    expect(tagDef.board_id).toBeNull();

    const remainingTagMappings = await tenantTable(tenantId, 'tag_mappings').pluck('mapping_id');
    expect(remainingTagMappings).toEqual([tagMappingId]);

    const remainingGroupBoards = await tenantTable(tenantId, 'client_portal_visibility_group_boards').select('*');
    expect(remainingGroupBoards).toHaveLength(0);

    // The group itself belongs to the client, not the board.
    const remainingGroups = await tenantTable(tenantId, 'client_portal_visibility_groups').pluck('group_id');
    expect(remainingGroups).toEqual([groupId]);
  }, HOOK_TIMEOUT);

  it('blocks deletion while other settings still target the board', async () => {
    const defaultBoardId = uuidv4();
    const doomedBoardId = uuidv4();
    const { tenantId, userId } = await createTenantFixture([
      { boardId: defaultBoardId, name: 'General', isDefault: true },
      { boardId: doomedBoardId, name: 'Automated' },
    ]);

    await addTicketStatus(tenantId, userId, doomedBoardId);

    await tenantTable(tenantId, 'ticket_templates').insert({
      tenant: tenantId,
      template_id: uuidv4(),
      name: 'Onboarding',
      title: 'Onboard a workstation',
      board_id: doomedBoardId,
    });

    await tenantTable(tenantId, 'recurring_ticket_definitions').insert({
      tenant: tenantId,
      definition_id: uuidv4(),
      name: 'Monthly maintenance',
      title_template: 'Monthly maintenance',
      board_id: doomedBoardId,
      priority_id: uuidv4(),
      recurrence: JSON.stringify({ frequency: 'monthly', interval: 1 }),
      start_date: '2026-01-01',
    });

    const checklistTemplateId = uuidv4();
    await tenantTable(tenantId, 'checklist_templates').insert({
      tenant: tenantId,
      template_id: checklistTemplateId,
      name: 'Site visit',
    });
    await tenantTable(tenantId, 'checklist_template_apply_rules').insert({
      tenant: tenantId,
      apply_rule_id: uuidv4(),
      template_id: checklistTemplateId,
      where: JSON.stringify({ join: 'and', clauses: [{ join: 'or', clauses: [
        { path: 'board_id', operator: 'in', value: [doomedBoardId] },
      ] }] }),
    });

    // A board-scoped canned response cannot drop its board_id (the
    // scope_target_check requires one), so it would survive as a library entry
    // that silently never matches a ticket again. Inactive ones count too: they
    // can be switched back on.
    await tenantTable(tenantId, 'canned_responses').insert({
      tenant: tenantId,
      canned_response_id: uuidv4(),
      name: 'Dispatch confirmation',
      body: '<p>On our way.</p>',
      body_markdown: 'On our way.',
      scope: 'board',
      board_id: doomedBoardId,
      is_active: false,
    });

    for (const force of [false, true]) {
      const result = await deleteBoard(doomedBoardId, force);
      expect(result.success).toBe(false);
      expect(result.code).toBe('BOARD_REFERENCED_BY_AUTOMATIONS');
      expect(result.counts).toEqual({
        ticket_templates: 1,
        recurring_ticket_definitions: 1,
        checklist_template_apply_rules: 1,
        canned_responses: 1,
      });
    }

    const remainingBoards = await tenantTable(tenantId, 'boards').pluck('board_id');
    expect(remainingBoards.sort()).toEqual([defaultBoardId, doomedBoardId].sort());
  }, HOOK_TIMEOUT);

  it('deletes a board whose only recurring schedule is archived', async () => {
    const defaultBoardId = uuidv4();
    const doomedBoardId = uuidv4();
    const { tenantId, userId } = await createTenantFixture([
      { boardId: defaultBoardId, name: 'General', isDefault: true },
      { boardId: doomedBoardId, name: 'Retired' },
    ]);

    await addTicketStatus(tenantId, userId, doomedBoardId);

    // Archived definitions are read-only forever (no unarchive, no delete), so
    // blocking on one would leave the board permanently undeletable. They also
    // never generate tickets, so a stale board_id on them is inert.
    const archivedDefinitionId = uuidv4();
    await tenantTable(tenantId, 'recurring_ticket_definitions').insert({
      tenant: tenantId,
      definition_id: archivedDefinitionId,
      name: 'Retired maintenance',
      title_template: 'Retired maintenance',
      board_id: doomedBoardId,
      priority_id: uuidv4(),
      recurrence: JSON.stringify({ frequency: 'monthly', interval: 1 }),
      start_date: '2026-01-01',
      is_active: false,
      archived_at: new Date(),
    });

    const confirm = await deleteBoard(doomedBoardId, false);
    expect(confirm.success).toBe(false);
    expect(confirm.code).toBe('BOARD_HAS_STATUSES');

    const result = await deleteBoard(doomedBoardId, true);
    expect(result.success).toBe(true);

    const remainingBoards = await tenantTable(tenantId, 'boards').pluck('board_id');
    expect(remainingBoards).toEqual([defaultBoardId]);

    // The archived row survives as history; only its board is gone.
    const archived = await tenantTable(tenantId, 'recurring_ticket_definitions')
      .where({ definition_id: archivedDefinitionId })
      .first();
    expect(archived).toBeTruthy();
  }, HOOK_TIMEOUT);

  it('blocks deletion while the board has its own outbound sender route', async () => {
    const defaultBoardId = uuidv4();
    const doomedBoardId = uuidv4();
    const { tenantId, userId } = await createTenantFixture([
      { boardId: defaultBoardId, name: 'General', isDefault: true },
      { boardId: doomedBoardId, name: 'Support' },
    ]);

    await addTicketStatus(tenantId, userId, doomedBoardId);

    const senderId = uuidv4();
    await tenantTable(tenantId, 'email_sender_addresses').insert({
      tenant: tenantId,
      sender_id: senderId,
      email_address: `support-${tenantId.slice(0, 8)}@example.com`,
      verification_status: 'verified',
    });
    await tenantTable(tenantId, 'email_sender_routes').insert({
      tenant: tenantId,
      route_id: uuidv4(),
      route_type: 'board',
      board_id: doomedBoardId,
      sender_id: senderId,
    });

    for (const force of [false, true]) {
      const result = await deleteBoard(doomedBoardId, force);
      expect(result.success).toBe(false);
      expect(result.code).toBe('BOARD_HAS_EMAIL_SENDER_ROUTE');
      expect(result.counts).toEqual({ email_sender_routes: 1 });
    }

    // The route would otherwise have been cascaded away silently.
    const remainingRoutes = await tenantTable(tenantId, 'email_sender_routes').select('*');
    expect(remainingRoutes).toHaveLength(1);

    const remainingBoards = await tenantTable(tenantId, 'boards').pluck('board_id');
    expect(remainingBoards.sort()).toEqual([defaultBoardId, doomedBoardId].sort());
  }, HOOK_TIMEOUT);
});
