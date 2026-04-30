import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const HOOK_TIMEOUT = 180_000;
const cloneMigration = require(path.resolve(process.cwd(), 'migrations', '20260314113000_clone_global_ticket_statuses_to_boards.cjs'));
const boardContextRemapMigration = require(
  path.resolve(process.cwd(), 'migrations', '20260314120000_remap_board_context_ticket_status_references.cjs')
);
const workflowStatusRemapMigration = require(
  path.resolve(process.cwd(), 'migrations', '20260314130000_remap_workflow_ticket_status_references.cjs')
);
const unresolvedWorkflowGuardMigration = require(
  path.resolve(process.cwd(), 'migrations', '20260314133000_surface_unresolved_ticket_status_references.cjs')
);
const slaPauseConfigRemapMigration = require(
  path.resolve(process.cwd(), 'migrations', '20260314134000_remap_sla_pause_ticket_status_configs.cjs')
);
const surveyTriggerStatusRemapMigration = require(
  path.resolve(process.cwd(), 'migrations', '20260314135000_remap_survey_trigger_ticket_status_references.cjs')
);

let db: Knex;
const tenantsToCleanup = new Set<string>();
const workflowIdsToCleanup = new Set<string>();

type LegacyFixture = {
  tenantId: string;
  boardIds: [string, string];
  legacyStatuses: Array<Record<string, unknown> & { status_id: string }>;
  tickets: Array<{
    ticket_id: string;
    board_id: string;
    original_status_id: string;
  }>;
  clientId: string;
};

type ColumnInfoMap = Record<string, unknown>;

let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let boardColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;
let ticketColumns: ColumnInfoMap;
let statusColumns: ColumnInfoMap;
let inboundDefaultsColumns: ColumnInfoMap;
let defaultBillingSettingsColumns: ColumnInfoMap;
let clientContractsColumns: ColumnInfoMap;

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

function projectComparableStatus(status: Record<string, unknown>) {
  return {
    name: status.name,
    order_number: status.order_number,
    is_default: status.is_default,
    is_closed: status.is_closed,
    ...(hasColumn(statusColumns, 'color') ? { color: status.color ?? null } : {}),
    ...(hasColumn(statusColumns, 'icon') ? { icon: status.icon ?? null } : {}),
    ...(hasColumn(statusColumns, 'standard_status_id')
      ? { standard_status_id: status.standard_status_id ?? null }
      : {}),
    ...(hasColumn(statusColumns, 'item_type') ? { item_type: status.item_type } : {}),
    ...(hasColumn(statusColumns, 'status_type') ? { status_type: status.status_type } : {}),
    ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: status.is_custom } : {}),
    created_by: status.created_by,
  };
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await db('tickets').where({ tenant: tenantId }).del();
  await db('status_sla_pause_config').where({ tenant: tenantId }).del();
  await db('survey_triggers').where({ tenant: tenantId }).del();
  await db('survey_templates').where({ tenant: tenantId }).del();
  await db('client_contracts').where({ tenant: tenantId }).del();
  await db('default_billing_settings').where({ tenant: tenantId }).del();
  await db('inbound_ticket_defaults').where({ tenant: tenantId }).del();
  await db('statuses').where({ tenant: tenantId }).del();
  await db('boards').where({ tenant: tenantId }).del();
  await db('clients').where({ tenant: tenantId }).del();
  await db('users').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
}

async function cleanupWorkflow(workflowId: string): Promise<void> {
  await db('workflow_definition_versions').where({ workflow_id: workflowId }).del();
  await db('workflow_definitions').where({ workflow_id: workflowId }).del();
}

async function createLegacyFixture(): Promise<LegacyFixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const boardA = uuidv4();
  const boardB = uuidv4();
  const clientId = uuidv4();
  const legacyOpenStatusId = uuidv4();
  const legacyClosedStatusId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await db('tenants').insert({
    tenant: tenantId,
    ...(hasColumn(tenantColumns, 'company_name')
      ? { company_name: `Tenant ${tenantId.slice(0, 8)}` }
      : { client_name: `Tenant ${tenantId.slice(0, 8)}` }),
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    ...(hasColumn(userColumns, 'role') ? { role: 'admin' } : {}),
    ...(hasColumn(userColumns, 'email') ? { email: `user-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('boards').insert([
    {
      tenant: tenantId,
      board_id: boardA,
      board_name: 'Support',
      ...(hasColumn(boardColumns, 'description') ? { description: 'Primary support board' } : {}),
      ...(hasColumn(boardColumns, 'display_order') ? { display_order: 10 } : {}),
      ...(hasColumn(boardColumns, 'is_default') ? { is_default: true } : {}),
      ...(hasColumn(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
      ...(hasColumn(boardColumns, 'is_active') ? { is_active: true } : {}),
      ...(hasColumn(boardColumns, 'category_type') ? { category_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'priority_type') ? { priority_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(boardColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
    {
      tenant: tenantId,
      board_id: boardB,
      board_name: 'Billing',
      ...(hasColumn(boardColumns, 'description') ? { description: 'Billing board' } : {}),
      ...(hasColumn(boardColumns, 'display_order') ? { display_order: 20 } : {}),
      ...(hasColumn(boardColumns, 'is_default') ? { is_default: false } : {}),
      ...(hasColumn(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
      ...(hasColumn(boardColumns, 'is_active') ? { is_active: true } : {}),
      ...(hasColumn(boardColumns, 'category_type') ? { category_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'priority_type') ? { priority_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(boardColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
  ]);

  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${tenantId.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
  });

  const legacyStatuses = [
    {
      tenant: tenantId,
      status_id: legacyOpenStatusId,
      ...(hasColumn(statusColumns, 'board_id') ? { board_id: null } : {}),
      name: 'Open',
      ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
      ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: userId,
      ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
      ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
      ...(hasColumn(statusColumns, 'color') ? { color: '#22C55E' } : {}),
      ...(hasColumn(statusColumns, 'icon') ? { icon: 'Circle' } : {}),
      ...(hasColumn(statusColumns, 'created_at')
        ? { created_at: new Date('2026-03-10T12:00:00.000Z') }
        : {}),
      ...(hasColumn(statusColumns, 'updated_at')
        ? { updated_at: new Date('2026-03-10T12:00:00.000Z') }
        : {}),
    },
    {
      tenant: tenantId,
      status_id: legacyClosedStatusId,
      ...(hasColumn(statusColumns, 'board_id') ? { board_id: null } : {}),
      name: 'Closed',
      ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
      ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
      is_closed: true,
      is_default: false,
      order_number: 20,
      created_by: userId,
      ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
      ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
      ...(hasColumn(statusColumns, 'color') ? { color: '#64748B' } : {}),
      ...(hasColumn(statusColumns, 'icon') ? { icon: 'CheckCircle2' } : {}),
      ...(hasColumn(statusColumns, 'created_at')
        ? { created_at: new Date('2026-03-10T12:05:00.000Z') }
        : {}),
      ...(hasColumn(statusColumns, 'updated_at')
        ? { updated_at: new Date('2026-03-10T12:05:00.000Z') }
        : {}),
    },
  ];

  await db('statuses').insert(legacyStatuses);

  const tickets = [
    {
      tenant: tenantId,
      ticket_id: uuidv4(),
      ticket_number: `T-${tenantId.slice(0, 6)}-001`,
      title: 'Support ticket',
      board_id: boardA,
      client_id: clientId,
      status_id: legacyOpenStatusId,
      ...(hasColumn(ticketColumns, 'entered_at') ? { entered_at: db.fn.now() } : {}),
      ...(hasColumn(ticketColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
    {
      tenant: tenantId,
      ticket_id: uuidv4(),
      ticket_number: `T-${tenantId.slice(0, 6)}-002`,
      title: 'Billing ticket',
      board_id: boardB,
      client_id: clientId,
      status_id: legacyOpenStatusId,
      ...(hasColumn(ticketColumns, 'entered_at') ? { entered_at: db.fn.now() } : {}),
      ...(hasColumn(ticketColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
  ];

  await db('tickets').insert(tickets);

  return {
    tenantId,
    boardIds: [boardA, boardB],
    legacyStatuses: legacyStatuses.map((status) => ({
      status_id: status.status_id,
      ...projectComparableStatus(status),
    })),
    tickets: tickets.map((ticket) => ({
      ticket_id: ticket.ticket_id,
      board_id: ticket.board_id,
      original_status_id: ticket.status_id,
    })),
    clientId,
  };
}

async function runMigrationForFixture(): Promise<LegacyFixture> {
  const fixture = await createLegacyFixture();
  await cloneMigration.up(db);
  return fixture;
}

async function seedBoardContextStatusReferences(fixture: LegacyFixture) {
  const legacyOpenStatusId = fixture.legacyStatuses.find((status) => status.name === 'Open')?.status_id as string;
  const legacyClosedStatusId = fixture.legacyStatuses.find((status) => status.name === 'Closed')?.status_id as string;
  const [boardA, boardB] = fixture.boardIds;
  const inboundDefaultsId = uuidv4();
  const clientContractId = uuidv4();

  await db('inbound_ticket_defaults').insert({
    id: inboundDefaultsId,
    tenant: fixture.tenantId,
    short_name: `defaults-${fixture.tenantId.slice(0, 8)}`,
    display_name: `Defaults ${fixture.tenantId.slice(0, 8)}`,
    board_id: boardA,
    status_id: legacyOpenStatusId,
    ...(hasColumn(inboundDefaultsColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(inboundDefaultsColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    ...(hasColumn(inboundDefaultsColumns, 'is_active') ? { is_active: true } : {}),
  });

  await db('default_billing_settings').insert({
    tenant: fixture.tenantId,
    renewal_ticket_board_id: boardB,
    renewal_ticket_status_id: legacyOpenStatusId,
    ...(hasColumn(defaultBillingSettingsColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(defaultBillingSettingsColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('client_contracts').insert({
    tenant: fixture.tenantId,
    client_contract_id: clientContractId,
    client_id: fixture.clientId,
    contract_id: uuidv4(),
    start_date: new Date('2026-03-01T00:00:00.000Z'),
    renewal_ticket_board_id: boardA,
    renewal_ticket_status_id: legacyClosedStatusId,
    ...(hasColumn(clientContractsColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientContractsColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    ...(hasColumn(clientContractsColumns, 'is_active') ? { is_active: true } : {}),
  });

  return {
    inboundDefaultsId,
    clientContractId,
  };
}

async function runBoardContextRemapForFixture() {
  const fixture = await createLegacyFixture();
  const references = await seedBoardContextStatusReferences(fixture);
  await cloneMigration.up(db);
  await boardContextRemapMigration.up(db);
  return { fixture, references };
}

async function seedLegacySlaPauseConfig(fixture: LegacyFixture) {
  const legacyOpenStatusId = fixture.legacyStatuses.find((status) => status.name === 'Open')?.status_id as string;

  await db('status_sla_pause_config').insert({
    tenant: fixture.tenantId,
    status_id: legacyOpenStatusId,
    pauses_sla: true,
    created_at: new Date('2026-03-10T12:10:00.000Z')
  });
}

async function seedLegacySurveyTriggerReference(fixture: LegacyFixture) {
  const legacyClosedStatusId = fixture.legacyStatuses.find((status) => status.name === 'Closed')?.status_id as string;
  const templateId = uuidv4();
  const triggerId = uuidv4();

  await db('survey_templates').insert({
    tenant: fixture.tenantId,
    template_id: templateId,
    template_name: `Survey ${templateId.slice(0, 8)}`,
    is_default: true,
    rating_type: 'stars',
    rating_scale: 5,
    rating_labels: { '1': 'Poor', '5': 'Great' },
    prompt_text: 'How was the ticket?',
    comment_prompt: 'Tell us more',
    thank_you_text: 'Thanks!',
    enabled: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('survey_triggers').insert({
    tenant: fixture.tenantId,
    trigger_id: triggerId,
    template_id: templateId,
    trigger_type: 'ticket_closed',
    trigger_conditions: {
      board_id: [fixture.boardIds[0]],
      status_id: [legacyClosedStatusId],
    },
    enabled: true,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { triggerId, legacyClosedStatusId };
}

async function seedWorkflowStatusReferences(fixture: LegacyFixture) {
  const workflowId = uuidv4();
  const legacyOpenStatusId = fixture.legacyStatuses.find((status) => status.name === 'Open')?.status_id as string;
  const legacyClosedStatusId = fixture.legacyStatuses.find((status) => status.name === 'Closed')?.status_id as string;
  const [boardA, boardB] = fixture.boardIds;

  workflowIdsToCleanup.add(workflowId);

  const definition = {
    id: workflowId,
    version: 1,
    name: `Workflow ${workflowId.slice(0, 8)}`,
    description: 'Board-scoped ticket status remap test',
    payloadSchemaRef: 'test.workflow.ticket-status-remap',
    steps: [
      {
        id: 'create-ticket',
        type: 'action.call',
        name: 'Create Ticket',
        config: {
          actionId: 'tickets.create',
          version: 1,
          inputMapping: {
            client_id: fixture.clientId,
            title: 'Workflow-created ticket',
            description: 'Created during migration test',
            board_id: boardA,
            status_id: legacyOpenStatusId,
            priority_id: uuidv4(),
          },
        },
      },
      {
        id: 'branch',
        type: 'control.if',
        condition: { $expr: 'true' },
        then: [
          {
            id: 'create-email-ticket',
            type: 'action.call',
            name: 'Create Ticket From Email',
            config: {
              actionId: 'create_ticket_from_email',
              version: 1,
              inputMapping: {
                title: 'Inbound email ticket',
                description: 'Created from email',
                board_id: boardB,
                status_id: legacyOpenStatusId,
                priority_id: uuidv4(),
              },
            },
          },
        ],
        else: [],
      },
      {
        id: 'guarded-create',
        type: 'control.tryCatch',
        try: [
          {
            id: 'create-ticket-with-comment',
            type: 'action.call',
            name: 'Create Ticket With Initial Comment',
            config: {
              actionId: 'create_ticket_with_initial_comment',
              version: 1,
              inputMapping: {
                emailData: { $expr: 'payload.emailData' },
                parsedEmail: { $expr: 'payload.parsedEmail' },
                ticketDefaults: {
                  board_id: boardA,
                  status_id: legacyClosedStatusId,
                  priority_id: uuidv4(),
                  client_id: fixture.clientId,
                },
                targetClientId: fixture.clientId,
                targetContactId: null,
                targetLocationId: null,
              },
            },
          },
        ],
        catch: [],
      },
    ],
  };

  await db('workflow_definitions').insert({
    workflow_id: workflowId,
    tenant_id: fixture.tenantId,
    name: definition.name,
    description: definition.description,
    payload_schema_ref: definition.payloadSchemaRef,
    draft_definition: definition,
    draft_version: definition.version,
    status: 'published',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('workflow_definition_versions').insert({
    workflow_id: workflowId,
    version: definition.version,
    definition_json: definition,
    published_at: db.fn.now(),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { workflowId };
}

async function runWorkflowStatusRemapForFixture() {
  const fixture = await createLegacyFixture();
  const references = await seedWorkflowStatusReferences(fixture);
  await cloneMigration.up(db);
  await workflowStatusRemapMigration.up(db);
  return { fixture, references };
}

async function seedUnresolvedWorkflowStatusReference(fixture: LegacyFixture) {
  const workflowId = uuidv4();
  const legacyOpenStatusId = fixture.legacyStatuses.find((status) => status.name === 'Open')?.status_id as string;

  workflowIdsToCleanup.add(workflowId);

  const definition = {
    id: workflowId,
    version: 1,
    name: `Workflow ${workflowId.slice(0, 8)} unresolved`,
    description: 'Legacy ticket status without board context',
    payloadSchemaRef: 'test.workflow.ticket-status-unresolved',
    steps: [
      {
        id: 'update-ticket',
        type: 'action.call',
        name: 'Update Ticket',
        config: {
          actionId: 'tickets.update_fields',
          version: 1,
          inputMapping: {
            ticket_id: uuidv4(),
            patch: {
              status_id: legacyOpenStatusId,
            },
          },
        },
      },
    ],
  };

  await db('workflow_definitions').insert({
    workflow_id: workflowId,
    tenant_id: fixture.tenantId,
    name: definition.name,
    description: definition.description,
    payload_schema_ref: definition.payloadSchemaRef,
    draft_definition: definition,
    draft_version: definition.version,
    status: 'draft',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { workflowId, legacyOpenStatusId };
}

describe('Board-specific ticket statuses migration – DB integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await db('tenants').columnInfo();
    userColumns = await db('users').columnInfo();
    boardColumns = await db('boards').columnInfo();
    clientColumns = await db('clients').columnInfo();
    ticketColumns = await db('tickets').columnInfo();
    statusColumns = await db('statuses').columnInfo();
    inboundDefaultsColumns = await db('inbound_ticket_defaults').columnInfo();
    defaultBillingSettingsColumns = await db('default_billing_settings').columnInfo();
    clientContractsColumns = await db('client_contracts').columnInfo();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    for (const workflowId of workflowIdsToCleanup) {
      await cleanupWorkflow(workflowId);
      workflowIdsToCleanup.delete(workflowId);
    }

    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
      tenantsToCleanup.delete(tenantId);
    }
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('T003: clones every legacy tenant ticket status to every board and preserves metadata', async () => {
    const fixture = await runMigrationForFixture();

    const clonedStatuses = await db('statuses')
      .where({ tenant: fixture.tenantId, status_type: 'ticket' })
      .whereNotNull('board_id')
      .orderBy('board_id', 'asc')
      .orderBy('order_number', 'asc');

    expect(clonedStatuses).toHaveLength(fixture.legacyStatuses.length * fixture.boardIds.length);

    for (const boardId of fixture.boardIds) {
      const boardClones = clonedStatuses.filter((status) => status.board_id === boardId);
      expect(boardClones).toHaveLength(fixture.legacyStatuses.length);

      const projectedBoardClones = boardClones.map((status) => projectComparableStatus(status));

      expect(projectedBoardClones).toEqual(
        fixture.legacyStatuses.map((status) => projectComparableStatus(status))
      );
    }
  }, HOOK_TIMEOUT);

  it('T004: cloned board-owned statuses receive fresh ids while preserving board-local ordering and default semantics', async () => {
    const fixture = await runMigrationForFixture();

    const legacyStatusIds = new Set(fixture.legacyStatuses.map((status) => status.status_id));
    const clonedStatuses = await db('statuses')
      .where({ tenant: fixture.tenantId, status_type: 'ticket' })
      .whereNotNull('board_id')
      .select('status_id', 'board_id', 'name', 'order_number', 'is_default', 'is_closed')
      .orderBy('board_id', 'asc')
      .orderBy('order_number', 'asc');

    expect(clonedStatuses.every((status) => !legacyStatusIds.has(status.status_id))).toBe(true);

    for (const boardId of fixture.boardIds) {
      const boardClones = clonedStatuses.filter((status) => status.board_id === boardId);
      expect(boardClones.map((status) => status.name)).toEqual(['Open', 'Closed']);
      expect(boardClones.map((status) => status.order_number)).toEqual([10, 20]);
      expect(boardClones.map((status) => status.is_default)).toEqual([true, false]);
      expect(boardClones.map((status) => status.is_closed)).toEqual([false, true]);
    }
  }, HOOK_TIMEOUT);

  it('T005: remap logic resolves the old global status id to a different board-owned replacement per board', async () => {
    const fixture = await runMigrationForFixture();

    const [boardA, boardB] = fixture.boardIds;
    const legacyOpenStatusId = fixture.legacyStatuses.find((status) => status.name === 'Open')?.status_id;
    expect(legacyOpenStatusId).toBeTruthy();

    const boardAOpen = await db('statuses')
      .where({
        tenant: fixture.tenantId,
        board_id: boardA,
        name: 'Open',
      })
      .first();
    const boardBOpen = await db('statuses')
      .where({
        tenant: fixture.tenantId,
        board_id: boardB,
        name: 'Open',
      })
      .first();

    expect(boardAOpen?.status_id).toBeTruthy();
    expect(boardBOpen?.status_id).toBeTruthy();
    expect(boardAOpen?.status_id).not.toBe(legacyOpenStatusId);
    expect(boardBOpen?.status_id).not.toBe(legacyOpenStatusId);
    expect(boardAOpen?.status_id).not.toBe(boardBOpen?.status_id);
  }, HOOK_TIMEOUT);

  it('T006: ticket rows are rewritten to the cloned board-owned status for their current board', async () => {
    const fixture = await runMigrationForFixture();

    const migratedTickets = await db('tickets')
      .where({ tenant: fixture.tenantId })
      .select('ticket_id', 'board_id', 'status_id')
      .orderBy('ticket_number', 'asc');

    expect(migratedTickets).toHaveLength(2);

    for (const ticket of migratedTickets) {
      const originalTicket = fixture.tickets.find((candidate) => candidate.ticket_id === ticket.ticket_id);
      expect(originalTicket).toBeTruthy();
      expect(ticket.status_id).not.toBe(originalTicket?.original_status_id);

      const clonedStatus = await db('statuses')
        .where({
          tenant: fixture.tenantId,
          board_id: ticket.board_id,
          status_id: ticket.status_id,
        })
        .first();

      expect(clonedStatus?.name).toBe('Open');
      expect(clonedStatus?.board_id).toBe(ticket.board_id);
    }
  }, HOOK_TIMEOUT);

  it('T007: inbound ticket defaults are remapped to board-owned ticket status ids using board_id', async () => {
    const { fixture, references } = await runBoardContextRemapForFixture();
    const [boardA] = fixture.boardIds;

    const remappedDefaults = await db('inbound_ticket_defaults')
      .where({ tenant: fixture.tenantId, id: references.inboundDefaultsId })
      .first();

    const expectedStatus = await db('statuses')
      .where({
        tenant: fixture.tenantId,
        board_id: boardA,
        name: 'Open',
      })
      .first();

    expect(remappedDefaults?.status_id).toBe(expectedStatus?.status_id);
  }, HOOK_TIMEOUT);

  it('T008: tenant billing renewal defaults are remapped to board-owned ticket status ids using renewal_ticket_board_id', async () => {
    const { fixture } = await runBoardContextRemapForFixture();
    const [, boardB] = fixture.boardIds;

    const remappedDefaults = await db('default_billing_settings')
      .where({ tenant: fixture.tenantId })
      .first();

    const expectedStatus = await db('statuses')
      .where({
        tenant: fixture.tenantId,
        board_id: boardB,
        name: 'Open',
      })
      .first();

    expect(remappedDefaults?.renewal_ticket_status_id).toBe(expectedStatus?.status_id);
  }, HOOK_TIMEOUT);

  it('T009: contract-level renewal overrides are remapped to board-owned ticket status ids using renewal_ticket_board_id', async () => {
    const { fixture, references } = await runBoardContextRemapForFixture();
    const [boardA] = fixture.boardIds;

    const remappedContract = await db('client_contracts')
      .where({ tenant: fixture.tenantId, client_contract_id: references.clientContractId })
      .first();

    const expectedStatus = await db('statuses')
      .where({
        tenant: fixture.tenantId,
        board_id: boardA,
        name: 'Closed',
      })
      .first();

    expect(remappedContract?.renewal_ticket_status_id).toBe(expectedStatus?.status_id);
  }, HOOK_TIMEOUT);

  it('remaps legacy SLA pause configs onto each board-owned clone of the configured ticket status', async () => {
    const fixture = await createLegacyFixture();
    await seedLegacySlaPauseConfig(fixture);

    await cloneMigration.up(db);
    await slaPauseConfigRemapMigration.up(db);

    const clonedOpenStatuses = await db('statuses')
      .where({ tenant: fixture.tenantId, status_type: 'ticket', name: 'Open' })
      .whereNotNull('board_id')
      .select('status_id')
      .orderBy('status_id');

    const remappedConfigs = await db('status_sla_pause_config')
      .where({ tenant: fixture.tenantId })
      .select('status_id', 'pauses_sla')
      .orderBy('status_id');

    expect(remappedConfigs).toHaveLength(clonedOpenStatuses.length);
    expect(remappedConfigs.every((config) => config.pauses_sla === true)).toBe(true);
    expect(remappedConfigs.map((config) => config.status_id)).toEqual(
      clonedOpenStatuses.map((status) => status.status_id)
    );
  }, HOOK_TIMEOUT);

  it('T010: saved workflow ticket status references with explicit board context are remapped in draft and published workflow JSON', async () => {
    const { fixture, references } = await runWorkflowStatusRemapForFixture();
    const [boardA, boardB] = fixture.boardIds;

    const remappedDraft = await db('workflow_definitions')
      .where({ workflow_id: references.workflowId })
      .first('draft_definition');
    const remappedVersion = await db('workflow_definition_versions')
      .where({ workflow_id: references.workflowId, version: 1 })
      .first('definition_json');

    const expectedBoardAOpen = await db('statuses')
      .where({ tenant: fixture.tenantId, board_id: boardA, name: 'Open' })
      .first('status_id');
    const expectedBoardBOpen = await db('statuses')
      .where({ tenant: fixture.tenantId, board_id: boardB, name: 'Open' })
      .first('status_id');
    const expectedBoardAClosed = await db('statuses')
      .where({ tenant: fixture.tenantId, board_id: boardA, name: 'Closed' })
      .first('status_id');

    const draftSteps = (remappedDraft?.draft_definition as any)?.steps;
    const versionSteps = (remappedVersion?.definition_json as any)?.steps;

    expect(draftSteps?.[0]?.config?.inputMapping?.status_id).toBe(expectedBoardAOpen?.status_id);
    expect(draftSteps?.[1]?.then?.[0]?.config?.inputMapping?.status_id).toBe(expectedBoardBOpen?.status_id);
    expect(draftSteps?.[2]?.try?.[0]?.config?.inputMapping?.ticketDefaults?.status_id).toBe(expectedBoardAClosed?.status_id);

    expect(versionSteps?.[0]?.config?.inputMapping?.status_id).toBe(expectedBoardAOpen?.status_id);
    expect(versionSteps?.[1]?.then?.[0]?.config?.inputMapping?.status_id).toBe(expectedBoardBOpen?.status_id);
    expect(versionSteps?.[2]?.try?.[0]?.config?.inputMapping?.ticketDefaults?.status_id).toBe(expectedBoardAClosed?.status_id);
  }, HOOK_TIMEOUT);

  it('T011: legacy workflow ticket status references without safe board context are surfaced instead of guessed', async () => {
    const fixture = await createLegacyFixture();
    const references = await seedUnresolvedWorkflowStatusReference(fixture);

    await cloneMigration.up(db);
    await workflowStatusRemapMigration.up(db);

    await expect(unresolvedWorkflowGuardMigration.up(db)).rejects.toThrow(
      new RegExp(`${references.workflowId}.*tickets\\.update_fields.*patch\\.status_id`, 's')
    );

    const unresolvedDraft = await db('workflow_definitions')
      .where({ workflow_id: references.workflowId })
      .first('draft_definition');

    expect((unresolvedDraft?.draft_definition as any)?.steps?.[0]?.config?.inputMapping?.patch?.status_id)
      .toBe(references.legacyOpenStatusId);
  }, HOOK_TIMEOUT);

  it('T050: survey trigger conditions are remapped to the board-owned ticket status ids for their configured board', async () => {
    const fixture = await runMigrationForFixture();
    const references = await seedLegacySurveyTriggerReference(fixture);

    await surveyTriggerStatusRemapMigration.up(db);

    const remappedTrigger = await db('survey_triggers')
      .where({ tenant: fixture.tenantId, trigger_id: references.triggerId })
      .first<{ trigger_conditions: Record<string, unknown> | string | null }>('trigger_conditions');

    const remappedConditions =
      typeof remappedTrigger?.trigger_conditions === 'string'
        ? JSON.parse(remappedTrigger.trigger_conditions)
        : remappedTrigger?.trigger_conditions ?? {};
    const remappedStatusIds = Array.isArray((remappedConditions as any).status_id)
      ? (remappedConditions as any).status_id
      : [];

    const expectedClosedStatus = await db('statuses')
      .where({
        tenant: fixture.tenantId,
        board_id: fixture.boardIds[0],
        name: 'Closed',
        status_type: 'ticket',
      })
      .first<{ status_id: string }>('status_id');

    expect(remappedStatusIds).toEqual([expectedClosedStatus?.status_id]);
    expect(remappedStatusIds).not.toContain(references.legacyClosedStatusId);
  }, HOOK_TIMEOUT);
});
