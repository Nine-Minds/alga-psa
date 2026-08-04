'use strict';

/**
 * A deal is a plan, not a single next action: opportunity_steps holds the whole
 * ladder of work (done, current, and greyed-out future), and
 * opportunity_step_templates holds the reusable per-stage step lists.
 *
 * The opportunities.next_action / next_action_due columns stay as a mirror of
 * the current step so the queue, the digest and the discipline jobs keep
 * working untouched.
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

async function distributeStepTables(knex) {
  if (!await hasCitus(knex)) return;
  for (const table of STEP_TABLES) {
    await knex.raw(
      `SELECT create_distributed_table(?::regclass, 'tenant', colocate_with => 'tenants')`,
      [table],
    );
  }
}

exports.up = async function up(knex) {
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
  await knex.raw('CREATE INDEX idx_opportunity_steps_tenant_opportunity ON opportunity_steps (tenant, opportunity_id, sort_order)');
  await knex.raw('CREATE INDEX idx_opportunity_steps_tenant_assigned_due ON opportunity_steps (tenant, assigned_to, due_at)');

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
  await knex.raw('CREATE INDEX idx_opportunity_step_templates_tenant_stage ON opportunity_step_templates (tenant, stage, sort_order)');

  // Citus: distribute before any cross-table foreign key is added.
  await distributeStepTables(knex);

  await knex.schema.alterTable('opportunity_steps', (table) => {
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'opportunity_id']).references(['tenant', 'opportunity_id']).inTable('opportunities').onDelete('CASCADE');
    table.foreign(['tenant', 'assigned_to']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant', 'completed_by']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
  });
  await knex.schema.alterTable('opportunity_step_templates', (table) => {
    table.foreign('tenant').references('tenants.tenant');
  });

  // Seed the stock per-stage step lists for every existing tenant.
  for (const [stage, title, sortOrder, offsetDays] of TEMPLATE_SEED) {
    await knex.raw(
      `
        INSERT INTO opportunity_step_templates (tenant, stage, title, sort_order, due_offset_days)
        SELECT tenant, ?, ?, ?, ? FROM tenants
      `,
      [stage, title, sortOrder, offsetDays],
    );
  }

  // Every open deal's single next action becomes its current step.
  await knex.raw(`
    INSERT INTO opportunity_steps (
      tenant, opportunity_id, title, due_at, status, sort_order, created_by, created_at, updated_at
    )
    SELECT
      tenant,
      opportunity_id,
      next_action,
      next_action_due,
      'current',
      0,
      created_by,
      created_at,
      updated_at
    FROM opportunities
    WHERE status = 'open' AND next_action IS NOT NULL
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('opportunity_steps');
  await knex.schema.dropTableIfExists('opportunity_step_templates');
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
