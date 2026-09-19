'use strict';

/**
 * A deal is a plan, not a single next action: opportunity_steps holds the whole
 * ladder of work (done, current, and greyed-out future), and
 * opportunity_step_templates holds the reusable per-stage step lists.
 *
 * The opportunities.next_action / next_action_due columns stay as a mirror of
 * the current step so the queue, the digest and the discipline jobs keep
 * working untouched.
 *
 * Runs outside a transaction (Citus), so every statement is guarded: a
 * partially-failed run can simply be retried.
 */

const STEP_TABLES = ['opportunity_steps', 'opportunity_step_templates'];

const TEMPLATE_SEED = [
  ['identified', 'Schedule discovery call', 0, 3],
  ['identified', 'Confirm the decision-maker', 1, 5],
  ['qualified', 'Book assessment', 0, 3],
  ['qualified', 'Confirm requirements and budget', 1, 5],
  ['assessment', 'Review assessment findings', 0, 3],
  ['assessment', 'Prepare quote', 1, 5],
  ['proposed', 'Follow up on quote', 0, 3],
  ['proposed', 'Schedule proposal review', 1, 5],
  ['verbal', 'Confirm start date', 0, 3],
  ['verbal', 'Send contract', 1, 5],
];

async function hasCitus(knex) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS available
  `);
  return Boolean(result.rows?.[0]?.available);
}

async function isDistributed(knex, tableName) {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
    ) AS distributed`,
    [tableName],
  );
  return Boolean(result.rows?.[0]?.distributed);
}

async function distributeStepTables(knex) {
  if (!await hasCitus(knex)) return;
  for (const table of STEP_TABLES) {
    if (await isDistributed(knex, table)) continue;
    await knex.raw(
      `SELECT create_distributed_table(?::regclass, 'tenant', colocate_with => 'tenants')`,
      [table],
    );
  }
}

async function constraintExists(knex, tableName, constraintName) {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName],
  );
  return Boolean(result.rows?.[0]?.present);
}

async function addForeignKey(knex, tableName, constraintName, definition) {
  if (await constraintExists(knex, tableName, constraintName)) return;
  await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition}`);
}

exports.up = async function up(knex) {
  if (!await knex.schema.hasTable('opportunity_steps')) {
    await knex.schema.createTable('opportunity_steps', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('step_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('opportunity_id').notNullable();
      table.text('title').notNullable();
      table.timestamp('due_at', { useTz: true }).nullable();
      table.boolean('has_time').notNullable().defaultTo(false);
      table.integer('duration_minutes').notNullable().defaultTo(30);
      table.uuid('assigned_to').nullable();
      table.text('checkpoint').nullable();
      table.text('status').notNullable().defaultTo('planned');
      table.integer('sort_order').notNullable().defaultTo(0);
      table.uuid('ticket_id').nullable();
      table.uuid('project_task_id').nullable();
      table.uuid('interaction_id').nullable();
      table.uuid('schedule_entry_id').nullable();
      table.timestamp('completed_at', { useTz: true }).nullable();
      table.uuid('completed_by').nullable();
      table.uuid('created_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'step_id']);
    });

    await knex.raw(`
      ALTER TABLE opportunity_steps
      ADD CONSTRAINT opportunity_steps_status_check
      CHECK (status IN ('planned', 'current', 'done', 'skipped'))
    `);
    await knex.raw(`
      ALTER TABLE opportunity_steps
      ADD CONSTRAINT opportunity_steps_checkpoint_check
      CHECK (checkpoint IS NULL OR checkpoint IN ('qualified', 'assessment', 'proposed', 'verbal', 'won'))
    `);
  }

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_opportunity_steps_tenant_opportunity ON opportunity_steps (tenant, opportunity_id, sort_order)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_opportunity_steps_tenant_assigned_due ON opportunity_steps (tenant, assigned_to, due_at)');
  // Backstop for the application invariant: one current step per deal.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_steps_single_current
    ON opportunity_steps (tenant, opportunity_id) WHERE status = 'current'
  `);

  if (!await knex.schema.hasTable('opportunity_step_templates')) {
    await knex.schema.createTable('opportunity_step_templates', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('template_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.text('stage').notNullable();
      table.text('title').notNullable();
      table.integer('sort_order').notNullable().defaultTo(0);
      table.integer('due_offset_days').notNullable().defaultTo(3);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'template_id']);
    });

    await knex.raw(`
      ALTER TABLE opportunity_step_templates
      ADD CONSTRAINT opportunity_step_templates_stage_check
      CHECK (stage IN ('identified', 'qualified', 'assessment', 'proposed', 'verbal'))
    `);
  }

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_opportunity_step_templates_tenant_stage ON opportunity_step_templates (tenant, stage, sort_order)');

  // Citus: distribute before any cross-table foreign key is added.
  await distributeStepTables(knex);

  await addForeignKey(knex, 'opportunity_steps', 'opportunity_steps_tenant_foreign',
    'FOREIGN KEY (tenant) REFERENCES tenants(tenant)');
  await addForeignKey(knex, 'opportunity_steps', 'opportunity_steps_tenant_opportunity_id_foreign',
    'FOREIGN KEY (tenant, opportunity_id) REFERENCES opportunities(tenant, opportunity_id) ON DELETE CASCADE');
  await addForeignKey(knex, 'opportunity_steps', 'opportunity_steps_tenant_assigned_to_foreign',
    'FOREIGN KEY (tenant, assigned_to) REFERENCES users(tenant, user_id)');
  await addForeignKey(knex, 'opportunity_steps', 'opportunity_steps_tenant_completed_by_foreign',
    'FOREIGN KEY (tenant, completed_by) REFERENCES users(tenant, user_id)');
  await addForeignKey(knex, 'opportunity_steps', 'opportunity_steps_tenant_created_by_foreign',
    'FOREIGN KEY (tenant, created_by) REFERENCES users(tenant, user_id)');
  await addForeignKey(knex, 'opportunity_step_templates', 'opportunity_step_templates_tenant_foreign',
    'FOREIGN KEY (tenant) REFERENCES tenants(tenant)');

  // Seed the stock per-stage step lists for every existing tenant. A retried
  // run only fills the gaps it left.
  for (const [stage, title, sortOrder, offsetDays] of TEMPLATE_SEED) {
    await knex.raw(
      `
        INSERT INTO opportunity_step_templates (tenant, stage, title, sort_order, due_offset_days)
        SELECT t.tenant, ?, ?, ?, ?
        FROM tenants t
        WHERE NOT EXISTS (
          SELECT 1 FROM opportunity_step_templates existing
          WHERE existing.tenant = t.tenant AND existing.stage = ? AND existing.title = ?
        )
      `,
      [stage, title, sortOrder, offsetDays, stage, title],
    );
  }

  // Every open deal's single next action becomes its current step. Deals that
  // already have steps (from a previous partial run) are left alone.
  await knex.raw(`
    INSERT INTO opportunity_steps (
      tenant, opportunity_id, title, due_at, status, sort_order, created_by, created_at, updated_at
    )
    SELECT
      o.tenant,
      o.opportunity_id,
      o.next_action,
      o.next_action_due,
      'current',
      0,
      o.created_by,
      o.created_at,
      o.updated_at
    FROM opportunities o
    WHERE o.status = 'open' AND o.next_action IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM opportunity_steps s
        WHERE s.tenant = o.tenant AND s.opportunity_id = o.opportunity_id
      )
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('opportunity_steps');
  await knex.schema.dropTableIfExists('opportunity_step_templates');
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
