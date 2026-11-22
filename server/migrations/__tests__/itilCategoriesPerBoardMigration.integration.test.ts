/**
 * T045–T060 and T062–T074 — F022–F031 and F033–F037 of `ee/plans/2026-11-21-itil-remediation`
 * (`category-schema`).
 *
 * The per-board ITIL category migration, against a schema that holds only the tables it touches
 * (the pattern of the other migration suites here). Each test builds its own tenant, runs the
 * migration, and asserts what moved and what did not; the reversal tests run `down()` after it.
 *
 * The standard set used here is a small stand-in for the product's 35 rows — three parents and
 * three children — so a scenario stays readable. T061 covers the real set through the dev seed.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Knex } from 'knex';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const isCitus = process.env.TEST_DB_BACKEND === 'citus';
const MIGRATION = '20261122120000_itil_categories_per_board.cjs';
const migrationsRoot = path.resolve(__dirname, '..');

/** The stand-in standard set. Ids are stable so assertions can name them. */
const STD = {
  hardware: '11111111-1111-4111-8111-111111111111',
  software: '22222222-2222-4222-8222-222222222222',
  network: '33333333-3333-4333-8333-333333333333',
  server: '44444444-4444-4444-8444-444444444444',
  workstation: '55555555-5555-4555-8555-555555555555',
  application: '66666666-6666-4666-8666-666666666666',
};

const STANDARD_ROWS = [
  { id: STD.hardware, category_name: 'Hardware', parent_category_uuid: null, display_order: 1 },
  { id: STD.software, category_name: 'Software', parent_category_uuid: null, display_order: 2 },
  { id: STD.network, category_name: 'Network', parent_category_uuid: null, display_order: 3 },
  { id: STD.server, category_name: 'Server', parent_category_uuid: STD.hardware, display_order: 1 },
  { id: STD.workstation, category_name: 'Workstation', parent_category_uuid: STD.hardware, display_order: 2 },
  { id: STD.application, category_name: 'Application', parent_category_uuid: STD.software, display_order: 1 },
];

const FIXTURE_SQL = `
  CREATE TABLE tenants (tenant uuid PRIMARY KEY);
  CREATE TABLE users (tenant uuid, user_id uuid, created_at timestamptz DEFAULT now(), PRIMARY KEY (tenant, user_id));
  CREATE TABLE boards (tenant uuid, board_id uuid, board_name text, category_type text, priority_type text,
    display_order integer DEFAULT 0, list_view_settings jsonb, PRIMARY KEY (tenant, board_id));
  CREATE TABLE categories (tenant uuid, category_id uuid, category_name text NOT NULL, board_id uuid,
    parent_category uuid, is_from_itil_standard boolean DEFAULT false, display_order integer NOT NULL DEFAULT 0,
    created_by uuid NOT NULL, created_at timestamptz DEFAULT now(), PRIMARY KEY (tenant, category_id));
  CREATE TABLE tickets (tenant uuid, ticket_id uuid, board_id uuid, category_id uuid, subcategory_id uuid,
    priority_id uuid, itil_impact integer, itil_urgency integer, PRIMARY KEY (tenant, ticket_id));
  CREATE TABLE ticket_templates (tenant uuid, template_id uuid, board_id uuid, category_id uuid, subcategory_id uuid,
    PRIMARY KEY (tenant, template_id));
  CREATE TABLE recurring_ticket_definitions (tenant uuid, definition_id uuid, board_id uuid, category_id uuid,
    subcategory_id uuid, overrides jsonb, PRIMARY KEY (tenant, definition_id));
  CREATE TABLE recurring_ticket_definition_clients (tenant uuid, definition_client_id uuid, definition_id uuid,
    overrides jsonb, PRIMARY KEY (tenant, definition_client_id));
  CREATE TABLE inbound_ticket_defaults (tenant uuid, id uuid, board_id uuid, category_id uuid, subcategory_id uuid,
    PRIMARY KEY (tenant, id));
  CREATE TABLE checklist_template_apply_rules (tenant uuid, apply_rule_id uuid, board_id uuid, category_id uuid,
    subcategory_id uuid, PRIMARY KEY (tenant, apply_rule_id));
  CREATE TABLE list_views (tenant uuid, view_id uuid, list_key text, settings jsonb, PRIMARY KEY (tenant, view_id));
  CREATE TABLE inbound_webhooks (tenant uuid, inbound_webhook_id uuid, handler_config jsonb,
    PRIMARY KEY (tenant, inbound_webhook_id));
  CREATE TABLE rmm_integrations (tenant uuid, integration_id uuid, provider text, settings jsonb,
    PRIMARY KEY (tenant, integration_id));
  CREATE TABLE workflow_definitions (tenant uuid, workflow_id uuid, draft_definition jsonb,
    PRIMARY KEY (tenant, workflow_id));
  CREATE TABLE workflow_definition_versions (tenant uuid, version_id uuid, workflow_id uuid, definition_json jsonb,
    PRIMARY KEY (tenant, version_id));
  CREATE TABLE standard_categories (id uuid PRIMARY KEY, category_name text, parent_category_uuid uuid,
    is_itil_standard boolean DEFAULT false, display_order integer);
`;

const DISTRIBUTED = [
  'users', 'boards', 'categories', 'tickets', 'ticket_templates', 'recurring_ticket_definitions',
  'recurring_ticket_definition_clients', 'inbound_ticket_defaults', 'checklist_template_apply_rules',
  'list_views', 'inbound_webhooks', 'rmm_integrations', 'workflow_definitions', 'workflow_definition_versions',
];

interface Scenario {
  tenant: string;
  author: string;
  boards: Record<string, string>;
  categories: Record<string, string>;
}

describe('ITIL per-board category migration', () => {
  let db: Knex;
  let scratch: string;
  const tenants = new Set<string>();

  beforeAll(async () => {
    wireLocalTestDbEnv();
    scratch = mkdtempSync(path.join(tmpdir(), 'itil-categories-per-board-'));
    writeFileSync(
      path.join(scratch, '20261122000000_fixture.cjs'),
      `
      exports.config = { transaction: false };
      exports.up = async (knex) => {
        await knex.raw(${JSON.stringify(FIXTURE_SQL)});
        if (process.env.TEST_DB_BACKEND === 'citus') {
          await knex.raw("SELECT create_distributed_table('tenants', 'tenant')");
          for (const table of ${JSON.stringify(DISTRIBUTED)}) {
            await knex.raw("SELECT create_distributed_table(?, 'tenant', colocate_with => 'tenants')", [table]);
          }
          await knex.raw("SELECT create_reference_table('standard_categories')");
        }
        await knex('standard_categories').insert(${JSON.stringify(
          STANDARD_ROWS.map((row) => ({ ...row, is_itil_standard: true }))
        )});
      };
      exports.down = async () => {};
    `
    );
    writeFileSync(
      path.join(scratch, MIGRATION),
      `module.exports = require(${JSON.stringify(path.join(migrationsRoot, MIGRATION))});\n`
    );

    db = await createTestDbConnection({
      databaseName: 'itil_categories_per_board_migration_test',
      migrationsDir: scratch,
      runSeeds: false,
    });
    // The bootstrap leaves the migration applied; every test drives it itself.
    await down();
  }, 300_000);

  afterAll(async () => {
    try {
      await db?.destroy();
    } finally {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    await down();
    for (const tenant of tenants) {
      for (const table of [...DISTRIBUTED, 'tenants']) {
        await db(table).where({ tenant }).del();
      }
    }
    tenants.clear();
  });

  // The bootstrap applies the migration; each test rolls it back in afterEach and drives it itself.
  let applied = true;
  const up = async () => {
    if (applied) return;
    await db.migrate.up({ name: MIGRATION });
    applied = true;
  };
  const down = async () => {
    if (!applied) return;
    await db.migrate.down({ name: MIGRATION });
    applied = false;
  };

  async function newTenant(): Promise<Scenario> {
    const tenant = randomUUID();
    const author = randomUUID();
    tenants.add(tenant);
    await db('tenants').insert({ tenant });
    await db('users').insert({ tenant, user_id: author });
    return { tenant, author, boards: {}, categories: {} };
  }

  async function addBoard(
    scenario: Scenario,
    name: string,
    kind: 'itil' | 'custom',
    extra: Record<string, unknown> = {}
  ): Promise<string> {
    const boardId = randomUUID();
    await db('boards').insert({
      tenant: scenario.tenant,
      board_id: boardId,
      board_name: name,
      category_type: kind === 'itil' ? 'itil' : 'custom',
      priority_type: kind === 'itil' ? 'itil' : 'custom',
      ...extra,
    });
    scenario.boards[name] = boardId;
    return boardId;
  }

  async function addCategory(
    scenario: Scenario,
    key: string,
    row: { name: string; boardId: string | null; parent?: string | null; flagged?: boolean }
  ): Promise<string> {
    const categoryId = randomUUID();
    await db('categories').insert({
      tenant: scenario.tenant,
      category_id: categoryId,
      category_name: row.name,
      board_id: row.boardId,
      parent_category: row.parent ?? null,
      is_from_itil_standard: row.flagged ?? false,
      created_by: scenario.author,
    });
    scenario.categories[key] = categoryId;
    return categoryId;
  }

  /** The legacy shape: one flagged set, stamped with the first ITIL board's id. */
  async function addLegacySet(scenario: Scenario, boardId: string | null, prefix = ''): Promise<void> {
    const hardware = await addCategory(scenario, `${prefix}Hardware`, { name: 'Hardware', boardId, flagged: true });
    const software = await addCategory(scenario, `${prefix}Software`, { name: 'Software', boardId, flagged: true });
    await addCategory(scenario, `${prefix}Network`, { name: 'Network', boardId, flagged: true });
    await addCategory(scenario, `${prefix}Server`, { name: 'Server', boardId, parent: hardware, flagged: true });
    await addCategory(scenario, `${prefix}Workstation`, { name: 'Workstation', boardId, parent: hardware, flagged: true });
    await addCategory(scenario, `${prefix}Application`, { name: 'Application', boardId, parent: software, flagged: true });
  }

  const categoriesOf = (tenant: string) =>
    db('categories').where({ tenant }).orderBy('category_name').select('*');

  async function copyOn(tenant: string, boardId: string, standardId: string) {
    return db('categories').where({ tenant, board_id: boardId, standard_category_id: standardId }).first();
  }

  async function ticket(tenant: string, ticketId: string) {
    return db('tickets').where({ tenant, ticket_id: ticketId }).first();
  }

  // -------------------------------------------------------------------------
  // Schema (F022, F029)
  // -------------------------------------------------------------------------

  it('T045: adds standard_category_id and the partial unique index', async () => {
    await up();
    expect(await db.schema.hasColumn('categories', 'standard_category_id')).toBe(true);
    expect(await db.schema.hasTable('itil_category_remap')).toBe(true);
    const { rows } = await db.raw(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'categories_tenant_board_standard_category_unique'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('tenant');
    expect(rows[0].indexdef).toContain('standard_category_id IS NOT NULL');
  });

  it('T057: a second row for the same board and standard category violates the index', async () => {
    const scenario = await newTenant();
    const board = await addBoard(scenario, 'ITIL One', 'itil');
    await addLegacySet(scenario, board);
    await up();

    const copy = await copyOn(scenario.tenant, board, STD.hardware);
    await expect(
      db('categories').insert({
        tenant: scenario.tenant,
        category_id: randomUUID(),
        category_name: 'Hardware again',
        board_id: board,
        is_from_itil_standard: true,
        standard_category_id: copy.standard_category_id,
        created_by: scenario.author,
      })
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  // -------------------------------------------------------------------------
  // The mapping (F023) and the flags (F024)
  // -------------------------------------------------------------------------

  it('T046: maps a flagged standard row on an ITIL board, on a non-ITIL board and with no board', async () => {
    const scenario = await newTenant();
    const itil = await addBoard(scenario, 'ITIL One', 'itil');
    const custom = await addBoard(scenario, 'General', 'custom');
    const onItil = await addCategory(scenario, 'onItil', { name: 'Hardware', boardId: itil, flagged: true });
    const onCustom = await addCategory(scenario, 'onCustom', { name: 'Software', boardId: custom, flagged: true });
    const boardless = await addCategory(scenario, 'boardless', { name: 'Network', boardId: null, flagged: true });
    const childOfBoardless = await addCategory(scenario, 'childOfBoardless', {
      name: 'Server',
      boardId: null,
      parent: boardless,
      flagged: true,
    });
    const ticketId = randomUUID();
    await db('tickets').insert({ tenant: scenario.tenant, ticket_id: ticketId, board_id: itil, category_id: boardless });

    await up();

    // The row on the ITIL board kept its id and is now linked.
    expect((await db('categories').where({ tenant: scenario.tenant, category_id: onItil }).first()).standard_category_id)
      .toBe(STD.hardware);
    // The other two were mapped — the ticket moved to the board's copy — but hold no link now.
    expect(await copyOn(scenario.tenant, itil, STD.network)).toBeTruthy();
    expect((await ticket(scenario.tenant, ticketId)).category_id).toBe(
      (await copyOn(scenario.tenant, itil, STD.network)).category_id
    );
    for (const id of [onCustom, boardless, childOfBoardless]) {
      const row = await db('categories').where({ tenant: scenario.tenant, category_id: id }).first();
      expect(row.standard_category_id).toBeNull();
      expect(row.is_from_itil_standard).toBe(false);
    }
  });

  it('T047: a flagged category with a non-standard name loses the flag and gets no link', async () => {
    const scenario = await newTenant();
    const itil = await addBoard(scenario, 'ITIL One', 'itil');
    const odd = await addCategory(scenario, 'odd', { name: 'Telephony', boardId: itil, flagged: true });

    await up();

    const row = await db('categories').where({ tenant: scenario.tenant, category_id: odd }).first();
    expect(row.standard_category_id).toBeNull();
    expect(row.is_from_itil_standard).toBe(false);
    expect(row.board_id).toBe(itil);
  });

  it('T048: a flagged category on a non-ITIL board loses the flag and stays on that board', async () => {
    const scenario = await newTenant();
    const custom = await addBoard(scenario, 'General', 'custom');
    const hardware = await addCategory(scenario, 'hardware', { name: 'Hardware', boardId: custom, flagged: true });

    await up();

    const row = await db('categories').where({ tenant: scenario.tenant, category_id: hardware }).first();
    expect(row.board_id).toBe(custom);
    expect(row.is_from_itil_standard).toBe(false);
    expect(row.standard_category_id).toBeNull();
  });

  // -------------------------------------------------------------------------
  // One set per board (F025, F033, F051)
  // -------------------------------------------------------------------------

  it('T049: three ITIL boards end with three complete sets, each child under its own parent', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    const second = await addBoard(scenario, 'ITIL Two', 'itil');
    const third = await addBoard(scenario, 'ITIL Three', 'itil');
    await addLegacySet(scenario, first);

    await up();

    for (const board of [first, second, third]) {
      const rows = await db('categories').where({ tenant: scenario.tenant, board_id: board });
      expect(rows).toHaveLength(STANDARD_ROWS.length);
      expect(rows.every((row: any) => row.is_from_itil_standard === true)).toBe(true);
      const parent = await copyOn(scenario.tenant, board, STD.hardware);
      const child = await copyOn(scenario.tenant, board, STD.server);
      expect(child.parent_category).toBe(parent.category_id);
      expect(child.board_id).toBe(board);
    }
    // The first board kept its original ids.
    expect((await copyOn(scenario.tenant, first, STD.hardware)).category_id).toBe(scenario.categories.Hardware);
  });

  it('T050: an ITIL board with a partial set gets only the missing rows', async () => {
    const scenario = await newTenant();
    const board = await addBoard(scenario, 'ITIL One', 'itil');
    const hardware = await addCategory(scenario, 'hardware', { name: 'Hardware', boardId: board, flagged: true });
    await addCategory(scenario, 'server', { name: 'Server', boardId: board, parent: hardware, flagged: true });

    await up();

    expect((await copyOn(scenario.tenant, board, STD.hardware)).category_id).toBe(hardware);
    expect((await copyOn(scenario.tenant, board, STD.server)).category_id).toBe(scenario.categories.server);
    const rows = await db('categories').where({ tenant: scenario.tenant, board_id: board });
    expect(rows).toHaveLength(STANDARD_ROWS.length);
  });

  it('T051: a tenant with ITIL boards and no flagged categories gets a full set per board', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    const second = await addBoard(scenario, 'ITIL Two', 'itil');

    await up();

    for (const board of [first, second]) {
      const rows = await db('categories').where({ tenant: scenario.tenant, board_id: board });
      expect(rows).toHaveLength(STANDARD_ROWS.length);
    }
  });

  it('a standard child whose parent sits on another board is re-parented to the board’s own parent (F033)', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    const second = await addBoard(scenario, 'ITIL Two', 'itil');
    const hardware = await addCategory(scenario, 'hardware', { name: 'Hardware', boardId: first, flagged: true });
    const strayChild = await addCategory(scenario, 'strayChild', {
      name: 'Server',
      boardId: second,
      parent: hardware,
      flagged: true,
    });

    await up();

    const row = await db('categories').where({ tenant: scenario.tenant, category_id: strayChild }).first();
    expect(row.board_id).toBe(second);
    expect(row.parent_category).toBe((await copyOn(scenario.tenant, second, STD.hardware)).category_id);
    expect(row.standard_category_id).toBe(STD.server);
  });

  // -------------------------------------------------------------------------
  // Re-pointing (F026, F027, F028, F034, F035)
  // -------------------------------------------------------------------------

  it('T052: a ticket on the second ITIL board ends on that board’s copy, same name and parent', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    const second = await addBoard(scenario, 'ITIL Two', 'itil');
    await addLegacySet(scenario, first);
    const ticketId = randomUUID();
    await db('tickets').insert({
      tenant: scenario.tenant,
      ticket_id: ticketId,
      board_id: second,
      category_id: scenario.categories.Hardware,
      subcategory_id: scenario.categories.Server,
    });

    await up();

    const row = await ticket(scenario.tenant, ticketId);
    const parent = await copyOn(scenario.tenant, second, STD.hardware);
    const child = await copyOn(scenario.tenant, second, STD.server);
    expect(row.category_id).toBe(parent.category_id);
    expect(row.subcategory_id).toBe(child.category_id);
    expect(parent.category_name).toBe('Hardware');
    expect(child.category_name).toBe('Server');
    expect(child.parent_category).toBe(parent.category_id);
  });

  it('T053: a ticket on the board that held the set keeps its category id', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    await addBoard(scenario, 'ITIL Two', 'itil');
    await addLegacySet(scenario, first);
    const ticketId = randomUUID();
    await db('tickets').insert({
      tenant: scenario.tenant,
      ticket_id: ticketId,
      board_id: first,
      category_id: scenario.categories.Hardware,
    });

    await up();

    expect((await ticket(scenario.tenant, ticketId)).category_id).toBe(scenario.categories.Hardware);
  });

  it('T054: a ticket on a non-ITIL board using a formerly flagged category keeps its category id', async () => {
    const scenario = await newTenant();
    const itil = await addBoard(scenario, 'ITIL One', 'itil');
    const custom = await addBoard(scenario, 'General', 'custom');
    const own = await addCategory(scenario, 'own', { name: 'Hardware', boardId: custom, flagged: true });
    const ticketId = randomUUID();
    await db('tickets').insert({
      tenant: scenario.tenant,
      ticket_id: ticketId,
      board_id: custom,
      category_id: own,
    });

    await up();

    expect((await ticket(scenario.tenant, ticketId)).category_id).toBe(own);
    expect(await copyOn(scenario.tenant, itil, STD.hardware)).toBeTruthy();
  });

  it('T055: templates, recurring definitions, their overrides and inbound defaults move to the board’s copy', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    const second = await addBoard(scenario, 'ITIL Two', 'itil');
    await addLegacySet(scenario, first);
    const shared = scenario.categories.Hardware;
    const sharedChild = scenario.categories.Server;

    const templateId = randomUUID();
    const definitionId = randomUUID();
    const definitionClientId = randomUUID();
    const defaultsId = randomUUID();
    const ruleId = randomUUID();
    await db('ticket_templates').insert({
      tenant: scenario.tenant, template_id: templateId, board_id: second, category_id: shared, subcategory_id: sharedChild,
    });
    await db('recurring_ticket_definitions').insert({
      tenant: scenario.tenant, definition_id: definitionId, board_id: second, category_id: shared,
      overrides: JSON.stringify({ category: { category_id: shared, subcategory_id: sharedChild } }),
    });
    await db('recurring_ticket_definition_clients').insert({
      tenant: scenario.tenant, definition_client_id: definitionClientId, definition_id: definitionId,
      overrides: JSON.stringify({ category: { category_id: shared, subcategory_id: null } }),
    });
    await db('inbound_ticket_defaults').insert({
      tenant: scenario.tenant, id: defaultsId, board_id: second, category_id: shared, subcategory_id: sharedChild,
    });
    await db('checklist_template_apply_rules').insert({
      tenant: scenario.tenant, apply_rule_id: ruleId, board_id: second, category_id: shared,
    });

    await up();

    const parent = (await copyOn(scenario.tenant, second, STD.hardware)).category_id;
    const child = (await copyOn(scenario.tenant, second, STD.server)).category_id;
    const template = await db('ticket_templates').where({ tenant: scenario.tenant, template_id: templateId }).first();
    expect([template.category_id, template.subcategory_id]).toEqual([parent, child]);
    const definition = await db('recurring_ticket_definitions')
      .where({ tenant: scenario.tenant, definition_id: definitionId })
      .first();
    expect(definition.category_id).toBe(parent);
    expect(definition.overrides.category).toEqual({ category_id: parent, subcategory_id: child });
    const definitionClient = await db('recurring_ticket_definition_clients')
      .where({ tenant: scenario.tenant, definition_client_id: definitionClientId })
      .first();
    expect(definitionClient.overrides.category).toEqual({ category_id: parent, subcategory_id: null });
    const defaults = await db('inbound_ticket_defaults').where({ tenant: scenario.tenant, id: defaultsId }).first();
    expect([defaults.category_id, defaults.subcategory_id]).toEqual([parent, child]);
    const rule = await db('checklist_template_apply_rules')
      .where({ tenant: scenario.tenant, apply_rule_id: ruleId })
      .first();
    expect(rule.category_id).toBe(parent);
  });

  it('T056: a workflow tickets.create input with a fixed board is re-pointed; update_fields, with no board, is not', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    const second = await addBoard(scenario, 'ITIL Two', 'itil');
    await addLegacySet(scenario, first);
    const shared = scenario.categories.Hardware;

    const workflowId = randomUUID();
    const versionId = randomUUID();
    const definition = {
      id: 'wf',
      steps: [
        {
          id: 'create',
          type: 'action.call',
          config: { actionId: 'tickets.create', inputMapping: { board_id: second, category_id: shared } },
        },
        {
          id: 'branch',
          type: 'control.if',
          then: [
            {
              id: 'update',
              type: 'action.call',
              config: { actionId: 'tickets.update_fields', inputMapping: { category_id: shared } },
            },
          ],
        },
      ],
    };
    await db('workflow_definitions').insert({
      tenant: scenario.tenant, workflow_id: workflowId, draft_definition: JSON.stringify(definition),
    });
    await db('workflow_definition_versions').insert({
      tenant: scenario.tenant, version_id: versionId, workflow_id: workflowId, definition_json: JSON.stringify(definition),
    });
    const webhookId = randomUUID();
    await db('inbound_webhooks').insert({
      tenant: scenario.tenant,
      inbound_webhook_id: webhookId,
      handler_config: JSON.stringify({
        type: 'direct_action',
        action: 'createTicket',
        field_mapping: { board_id: `"${second}"`, category_id: `"${shared}"`, title: 'payload.subject' },
      }),
    });
    const integrationId = randomUUID();
    await db('rmm_integrations').insert({
      tenant: scenario.tenant,
      integration_id: integrationId,
      provider: 'huntress',
      settings: JSON.stringify({ boardId: second, categoryId: shared, subcategoryId: scenario.categories.Server }),
    });

    await up();

    const parent = (await copyOn(scenario.tenant, second, STD.hardware)).category_id;
    const child = (await copyOn(scenario.tenant, second, STD.server)).category_id;
    for (const [table, key, id, column] of [
      ['workflow_definitions', 'workflow_id', workflowId, 'draft_definition'],
      ['workflow_definition_versions', 'version_id', versionId, 'definition_json'],
    ] as const) {
      const row = await db(table).where({ tenant: scenario.tenant, [key]: id }).first();
      const stored = row[column];
      expect(stored.steps[0].config.inputMapping.category_id).toBe(parent);
      expect(stored.steps[1].then[0].config.inputMapping.category_id).toBe(shared);
    }
    const webhook = await db('inbound_webhooks').where({ tenant: scenario.tenant, inbound_webhook_id: webhookId }).first();
    expect(webhook.handler_config.field_mapping.category_id).toBe(`"${parent}"`);
    expect(webhook.handler_config.field_mapping.title).toBe('payload.subject');
    const integration = await db('rmm_integrations').where({ tenant: scenario.tenant, integration_id: integrationId }).first();
    expect(integration.settings).toMatchObject({ categoryId: parent, subcategoryId: child });
  });

  it('T068: a board view keeps its category filter, pointing at the board’s copies', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    await addLegacySet(scenario, first);
    const second = await addBoard(scenario, 'ITIL Two', 'itil', {
      list_view_settings: JSON.stringify({
        filters: {
          categoryIds: [scenario.categories.Hardware],
          excludeCategoryIds: [scenario.categories.Software],
        },
      }),
    });

    await up();

    const board = await db('boards').where({ tenant: scenario.tenant, board_id: second }).first();
    expect(board.list_view_settings.filters).toEqual({
      categoryIds: [(await copyOn(scenario.tenant, second, STD.hardware)).category_id],
      excludeCategoryIds: [(await copyOn(scenario.tenant, second, STD.software)).category_id],
    });
  });

  it('T069: a personal view naming the second ITIL board is re-pointed; one spanning all boards is not', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    const second = await addBoard(scenario, 'ITIL Two', 'itil');
    await addLegacySet(scenario, first);
    const scopedId = randomUUID();
    const allBoardsId = randomUUID();
    await db('list_views').insert([
      {
        tenant: scenario.tenant, view_id: scopedId, list_key: 'tickets',
        settings: JSON.stringify({ filters: { boardId: second, categoryId: scenario.categories.Hardware } }),
      },
      {
        tenant: scenario.tenant, view_id: allBoardsId, list_key: 'tickets',
        settings: JSON.stringify({ filters: { categoryId: scenario.categories.Hardware } }),
      },
    ]);

    await up();

    const scoped = await db('list_views').where({ tenant: scenario.tenant, view_id: scopedId }).first();
    expect(scoped.settings.filters.categoryId).toBe((await copyOn(scenario.tenant, second, STD.hardware)).category_id);
    const allBoards = await db('list_views').where({ tenant: scenario.tenant, view_id: allBoardsId }).first();
    expect(allBoards.settings.filters.categoryId).toBe(scenario.categories.Hardware);
  });

  it('T070: a saved view on a non-ITIL board is unchanged', async () => {
    const scenario = await newTenant();
    const itil = await addBoard(scenario, 'ITIL One', 'itil');
    await addLegacySet(scenario, itil);
    const custom = await addBoard(scenario, 'General', 'custom', {
      list_view_settings: JSON.stringify({ filters: { categoryIds: [scenario.categories.Hardware] } }),
    });
    const viewId = randomUUID();
    await db('list_views').insert({
      tenant: scenario.tenant, view_id: viewId, list_key: 'tickets',
      settings: JSON.stringify({ filters: { boardId: custom, categoryId: scenario.categories.Hardware } }),
    });

    await up();

    const board = await db('boards').where({ tenant: scenario.tenant, board_id: custom }).first();
    expect(board.list_view_settings.filters.categoryIds).toEqual([scenario.categories.Hardware]);
    const view = await db('list_views').where({ tenant: scenario.tenant, view_id: viewId }).first();
    expect(view.settings.filters.categoryId).toBe(scenario.categories.Hardware);
  });

  // -------------------------------------------------------------------------
  // The three outcomes the PRD states (F035 and the two re-homing cases)
  // -------------------------------------------------------------------------

  it('T062: the set sits on a board that is no longer ITIL: both ITIL boards end on their own copies', async () => {
    const scenario = await newTenant();
    const retired = await addBoard(scenario, 'Retired', 'custom');
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    const second = await addBoard(scenario, 'ITIL Two', 'itil');
    await addLegacySet(scenario, retired);
    const firstTicket = randomUUID();
    const secondTicket = randomUUID();
    await db('tickets').insert([
      {
        tenant: scenario.tenant, ticket_id: firstTicket, board_id: first,
        category_id: scenario.categories.Hardware, subcategory_id: scenario.categories.Server,
      },
      {
        tenant: scenario.tenant, ticket_id: secondTicket, board_id: second,
        category_id: scenario.categories.Hardware, subcategory_id: scenario.categories.Server,
      },
    ]);

    await up();

    for (const [board, ticketId] of [[first, firstTicket], [second, secondTicket]] as const) {
      const row = await ticket(scenario.tenant, ticketId);
      const parent = await copyOn(scenario.tenant, board, STD.hardware);
      const child = await copyOn(scenario.tenant, board, STD.server);
      expect(row.category_id).toBe(parent.category_id);
      expect(row.subcategory_id).toBe(child.category_id);
      expect(parent.category_name).toBe('Hardware');
      expect(child.parent_category).toBe(parent.category_id);
    }
  });

  it('T063: in that case the original rows stay on the non-ITIL board, without flag or link, and its tickets are untouched', async () => {
    const scenario = await newTenant();
    const retired = await addBoard(scenario, 'Retired', 'custom');
    await addBoard(scenario, 'ITIL One', 'itil');
    await addLegacySet(scenario, retired);
    const retiredTicket = randomUUID();
    await db('tickets').insert({
      tenant: scenario.tenant, ticket_id: retiredTicket, board_id: retired,
      category_id: scenario.categories.Hardware, subcategory_id: scenario.categories.Server,
    });

    await up();

    const rows = await db('categories').where({ tenant: scenario.tenant, board_id: retired });
    expect(rows).toHaveLength(STANDARD_ROWS.length);
    expect(rows.every((row: any) => row.is_from_itil_standard === false && row.standard_category_id === null)).toBe(true);
    expect(rows.map((row: any) => row.category_id).sort()).toEqual(
      Object.values(scenario.categories).sort()
    );
    const row = await ticket(scenario.tenant, retiredTicket);
    expect(row.category_id).toBe(scenario.categories.Hardware);
    expect(row.subcategory_id).toBe(scenario.categories.Server);
  });

  it('T064: a tenant’s own Hardware flagged by name: the ITIL board gets its own, the ITIL children move under it', async () => {
    const scenario = await newTenant();
    const custom = await addBoard(scenario, 'General', 'custom');
    const itil = await addBoard(scenario, 'ITIL One', 'itil');
    const own = await addCategory(scenario, 'own', { name: 'Hardware', boardId: custom, flagged: true });
    const ownChild = await addCategory(scenario, 'ownChild', { name: 'Printers', boardId: custom, parent: own });
    const itilChild = await addCategory(scenario, 'itilChild', {
      name: 'Server', boardId: itil, parent: own, flagged: true,
    });

    await up();

    const boardHardware = await copyOn(scenario.tenant, itil, STD.hardware);
    expect(boardHardware.category_id).not.toBe(own);
    expect(boardHardware.board_id).toBe(itil);
    const movedChild = await db('categories').where({ tenant: scenario.tenant, category_id: itilChild }).first();
    expect(movedChild.parent_category).toBe(boardHardware.category_id);
    expect(movedChild.standard_category_id).toBe(STD.server);
    expect(await copyOn(scenario.tenant, itil, STD.workstation)).toBeTruthy();
    expect((await db('categories').where({ tenant: scenario.tenant, category_id: ownChild }).first()).parent_category)
      .toBe(own);
  });

  it('T065: in that case the tenant’s Hardware keeps its board, its children and its tickets, and loses the flag', async () => {
    const scenario = await newTenant();
    const custom = await addBoard(scenario, 'General', 'custom');
    await addBoard(scenario, 'ITIL One', 'itil');
    const own = await addCategory(scenario, 'own', { name: 'Hardware', boardId: custom, flagged: true });
    const ownChild = await addCategory(scenario, 'ownChild', { name: 'Printers', boardId: custom, parent: own });
    const ticketId = randomUUID();
    await db('tickets').insert({
      tenant: scenario.tenant, ticket_id: ticketId, board_id: custom, category_id: own, subcategory_id: ownChild,
    });

    await up();

    const row = await db('categories').where({ tenant: scenario.tenant, category_id: own }).first();
    expect(row.board_id).toBe(custom);
    expect(row.is_from_itil_standard).toBe(false);
    expect(row.standard_category_id).toBeNull();
    const child = await db('categories').where({ tenant: scenario.tenant, category_id: ownChild }).first();
    expect(child.parent_category).toBe(own);
    expect(child.board_id).toBe(custom);
    const stored = await ticket(scenario.tenant, ticketId);
    expect([stored.category_id, stored.subcategory_id]).toEqual([own, ownChild]);
  });

  it('T066: a ticket using a re-parented child keeps the same subcategory row and gets the board’s own parent', async () => {
    const scenario = await newTenant();
    const custom = await addBoard(scenario, 'General', 'custom');
    const itil = await addBoard(scenario, 'ITIL One', 'itil');
    const own = await addCategory(scenario, 'own', { name: 'Hardware', boardId: custom, flagged: true });
    const itilChild = await addCategory(scenario, 'itilChild', {
      name: 'Server', boardId: itil, parent: own, flagged: true,
    });
    const ticketId = randomUUID();
    await db('tickets').insert({
      tenant: scenario.tenant, ticket_id: ticketId, board_id: itil, category_id: own, subcategory_id: itilChild,
    });

    await up();

    const row = await ticket(scenario.tenant, ticketId);
    expect(row.subcategory_id).toBe(itilChild);
    expect(row.category_id).toBe((await copyOn(scenario.tenant, itil, STD.hardware)).category_id);
  });

  it('T067: boardless flagged rows: the ITIL board’s ticket is re-pointed, another board’s is not', async () => {
    const scenario = await newTenant();
    const itil = await addBoard(scenario, 'ITIL One', 'itil');
    const custom = await addBoard(scenario, 'General', 'custom');
    await addLegacySet(scenario, null);
    const itilTicket = randomUUID();
    const customTicket = randomUUID();
    await db('tickets').insert([
      {
        tenant: scenario.tenant, ticket_id: itilTicket, board_id: itil,
        category_id: scenario.categories.Hardware, subcategory_id: scenario.categories.Server,
      },
      {
        tenant: scenario.tenant, ticket_id: customTicket, board_id: custom,
        category_id: scenario.categories.Hardware,
      },
    ]);

    await up();

    const onItil = await ticket(scenario.tenant, itilTicket);
    expect(onItil.category_id).toBe((await copyOn(scenario.tenant, itil, STD.hardware)).category_id);
    expect(onItil.subcategory_id).toBe((await copyOn(scenario.tenant, itil, STD.server)).category_id);
    expect((await ticket(scenario.tenant, customTicket)).category_id).toBe(scenario.categories.Hardware);
    for (const key of Object.keys(scenario.categories)) {
      const row = await db('categories').where({ tenant: scenario.tenant, category_id: scenario.categories[key] }).first();
      expect(row.board_id).toBeNull();
      expect(row.is_from_itil_standard).toBe(false);
      expect(row.standard_category_id).toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // Shape of the run (F030, F031, F037, F074)
  // -------------------------------------------------------------------------

  it('T058: running the migration twice produces the same rows', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    const second = await addBoard(scenario, 'ITIL Two', 'itil');
    await addLegacySet(scenario, first);
    const ticketId = randomUUID();
    await db('tickets').insert({
      tenant: scenario.tenant, ticket_id: ticketId, board_id: second, category_id: scenario.categories.Hardware,
    });

    await up();
    const afterFirst = await categoriesOf(scenario.tenant);
    const remapAfterFirst = await db('itil_category_remap').where({ tenant: scenario.tenant });

    // The migration is written to be re-runnable; call its up() again on the same database.
    const migration = createRequire(__filename)(path.join(migrationsRoot, MIGRATION));
    await migration.up(db);

    expect(await categoriesOf(scenario.tenant)).toEqual(afterFirst);
    expect(await db('itil_category_remap').where({ tenant: scenario.tenant })).toHaveLength(remapAfterFirst.length);
  });

  it('T059: runs against a Citus-distributed schema', async () => {
    const scenario = await newTenant();
    const board = await addBoard(scenario, 'ITIL One', 'itil');
    await addLegacySet(scenario, board);

    await up();

    expect(await db('categories').where({ tenant: scenario.tenant, board_id: board })).toHaveLength(
      STANDARD_ROWS.length
    );
    if (isCitus) {
      const { rows } = await db.raw(
        "SELECT partmethod FROM pg_dist_partition WHERE logicalrelid = 'itil_category_remap'::regclass"
      );
      expect(rows).toEqual([{ partmethod: 'h' }]);
    }
  });

  it('T060: every ticket keeps its priority, Impact and Urgency', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    const second = await addBoard(scenario, 'ITIL Two', 'itil');
    await addLegacySet(scenario, first);
    const priority = randomUUID();
    const ids = [randomUUID(), randomUUID()];
    await db('tickets').insert([
      {
        tenant: scenario.tenant, ticket_id: ids[0], board_id: second, category_id: scenario.categories.Hardware,
        priority_id: priority, itil_impact: 2, itil_urgency: 3,
      },
      {
        tenant: scenario.tenant, ticket_id: ids[1], board_id: first, category_id: scenario.categories.Software,
        priority_id: priority, itil_impact: null, itil_urgency: null,
      },
    ]);
    const before = await db('tickets')
      .where({ tenant: scenario.tenant })
      .orderBy('ticket_id')
      .select('ticket_id', 'priority_id', 'itil_impact', 'itil_urgency');

    await up();

    const after = await db('tickets')
      .where({ tenant: scenario.tenant })
      .orderBy('ticket_id')
      .select('ticket_id', 'priority_id', 'itil_impact', 'itil_urgency');
    expect(after).toEqual(before);
  });

  it('T071: the remap journal holds one row per replaced (board, old id) pair and none for a board that kept its rows', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    const second = await addBoard(scenario, 'ITIL Two', 'itil');
    await addLegacySet(scenario, first);
    const ticketId = randomUUID();
    await db('tickets').insert({
      tenant: scenario.tenant, ticket_id: ticketId, board_id: second,
      category_id: scenario.categories.Hardware, subcategory_id: scenario.categories.Server,
    });

    await up();

    const replacements = await db('itil_category_remap')
      .where({ tenant: scenario.tenant, kind: 'replace' })
      .select('board_id', 'standard_category_id', 'old_category_id', 'new_category_id');
    expect(replacements).toHaveLength(2);
    expect(replacements.every((row: any) => row.board_id === second)).toBe(true);
    expect(replacements.map((row: any) => row.old_category_id).sort()).toEqual(
      [scenario.categories.Hardware, scenario.categories.Server].sort()
    );
    expect(await db('itil_category_remap').where({ tenant: scenario.tenant, kind: 'replace', board_id: first }))
      .toHaveLength(0);
  });

  it('T074: deletes no category row', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    await addBoard(scenario, 'ITIL Two', 'itil');
    const custom = await addBoard(scenario, 'General', 'custom');
    await addLegacySet(scenario, first);
    await addCategory(scenario, 'ownOnCustom', { name: 'Telephony', boardId: custom });
    await addCategory(scenario, 'oddFlagged', { name: 'Smart hands', boardId: custom, flagged: true });
    const before = (await categoriesOf(scenario.tenant)).map((row: any) => row.category_id).sort();

    await up();

    const after = (await categoriesOf(scenario.tenant)).map((row: any) => row.category_id);
    expect(before.every((id: string) => after.includes(id))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Reversal (F036)
  // -------------------------------------------------------------------------

  it('T072: down() restores every re-pointed reference and removes every inserted copy', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    await addLegacySet(scenario, first);
    const second = await addBoard(scenario, 'ITIL Two', 'itil', {
      list_view_settings: JSON.stringify({ filters: { categoryIds: [scenario.categories.Hardware] } }),
    });
    const ticketId = randomUUID();
    const templateId = randomUUID();
    const definitionId = randomUUID();
    const defaultsId = randomUUID();
    const viewId = randomUUID();
    await db('tickets').insert({
      tenant: scenario.tenant, ticket_id: ticketId, board_id: second,
      category_id: scenario.categories.Hardware, subcategory_id: scenario.categories.Server,
    });
    await db('ticket_templates').insert({
      tenant: scenario.tenant, template_id: templateId, board_id: second, category_id: scenario.categories.Hardware,
    });
    await db('recurring_ticket_definitions').insert({
      tenant: scenario.tenant, definition_id: definitionId, board_id: second, category_id: scenario.categories.Software,
    });
    await db('inbound_ticket_defaults').insert({
      tenant: scenario.tenant, id: defaultsId, board_id: second, category_id: scenario.categories.Hardware,
    });
    await db('list_views').insert({
      tenant: scenario.tenant, view_id: viewId, list_key: 'tickets',
      settings: JSON.stringify({ filters: { boardId: second, categoryId: scenario.categories.Hardware } }),
    });
    const categoriesBefore = await categoriesOf(scenario.tenant);

    await up();
    await down();

    const row = await ticket(scenario.tenant, ticketId);
    expect([row.category_id, row.subcategory_id]).toEqual([
      scenario.categories.Hardware,
      scenario.categories.Server,
    ]);
    expect((await db('ticket_templates').where({ tenant: scenario.tenant, template_id: templateId }).first()).category_id)
      .toBe(scenario.categories.Hardware);
    expect(
      (await db('recurring_ticket_definitions').where({ tenant: scenario.tenant, definition_id: definitionId }).first())
        .category_id
    ).toBe(scenario.categories.Software);
    expect((await db('inbound_ticket_defaults').where({ tenant: scenario.tenant, id: defaultsId }).first()).category_id)
      .toBe(scenario.categories.Hardware);
    expect(
      (await db('boards').where({ tenant: scenario.tenant, board_id: second }).first()).list_view_settings.filters
        .categoryIds
    ).toEqual([scenario.categories.Hardware]);
    expect((await db('list_views').where({ tenant: scenario.tenant, view_id: viewId }).first()).settings.filters.categoryId)
      .toBe(scenario.categories.Hardware);

    const categoriesAfter = await categoriesOf(scenario.tenant);
    expect(categoriesAfter.map((entry: any) => entry.category_id).sort()).toEqual(
      categoriesBefore.map((entry: any) => entry.category_id).sort()
    );
    expect(categoriesAfter.every((entry: any) => entry.is_from_itil_standard === true)).toBe(true);
    expect(await db.schema.hasColumn('categories', 'standard_category_id')).toBe(false);
    expect(await db.schema.hasTable('itil_category_remap')).toBe(false);
  });

  it('T073: up, down, up yields the same set as a single up', async () => {
    const scenario = await newTenant();
    const first = await addBoard(scenario, 'ITIL One', 'itil');
    const second = await addBoard(scenario, 'ITIL Two', 'itil');
    await addLegacySet(scenario, first);
    const ticketId = randomUUID();
    await db('tickets').insert({
      tenant: scenario.tenant, ticket_id: ticketId, board_id: second, category_id: scenario.categories.Hardware,
    });

    const shape = async () => {
      const rows = await db('categories')
        .where({ tenant: scenario.tenant })
        .orderBy(['board_id', 'standard_category_id', 'category_name']);
      const parentStandardOf = new Map(rows.map((row: any) => [row.category_id, row.standard_category_id]));
      return rows.map((row: any) => ({
        board_id: row.board_id,
        name: row.category_name,
        standard_category_id: row.standard_category_id,
        parent_standard_category_id: row.parent_category ? parentStandardOf.get(row.parent_category) ?? null : null,
        flagged: row.is_from_itil_standard,
      }));
    };

    await up();
    const once = await shape();
    const ticketOnce = (await ticket(scenario.tenant, ticketId)).category_id;
    await down();
    await up();

    expect(await shape()).toEqual(once);
    const twice = await ticket(scenario.tenant, ticketId);
    expect(twice.category_id).toBe(
      (await copyOn(scenario.tenant, second, STD.hardware)).category_id
    );
    expect(ticketOnce).toBeTruthy();
  });
});
