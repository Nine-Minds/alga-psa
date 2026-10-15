'use strict';

/**
 * First-class ticket templates ("Create template from ticket" / "New ticket from template").
 *
 *   ticket_templates                  name + ticket fields + tags + custom fields
 *   ticket_template_checklist_items   the template's own checklist (child of ticket_templates)
 *   tickets.created_from_template_id  provenance, written by addTicket only
 *
 * Deliberate foreign-key omissions (plan D5/D10):
 *   - board/category/subcategory/priority references are validated on save and again when a template
 *     is applied; deleting a board must not be blocked by a template.
 *   - ticket_templates.source_ticket_id and ticket_template_checklist_items.checklist_template_id are
 *     informational / replacement-rule hints, not integrity links.
 *   - tickets.created_from_template_id has no FK and no index: deleting a template must neither be
 *     blocked nor cascade, and a composite ON DELETE SET NULL would null `tenant` on Citus.
 *
 * Citus: both tables are new (no pre-existing rows, so no stale local heap data to truncate). The
 * unique name index includes the distribution column (`tenant`) and is created after distribution.
 */

const TEMPLATES = 'ticket_templates';
const ITEMS = 'ticket_template_checklist_items';

async function constraintExists(knex, tableName, constraintName) {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName]
  );
  return Boolean(result.rows?.[0]?.present);
}

async function addConstraint(knex, tableName, constraintName, definition) {
  if (await constraintExists(knex, tableName, constraintName)) return;
  await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition}`);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TEMPLATES))) {
    await knex.schema.createTable(TEMPLATES, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('template_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('name').notNullable();
      table.text('notes').nullable();
      table.text('title').notNullable();
      table.text('description').nullable();
      table.uuid('board_id').nullable();
      table.uuid('category_id').nullable();
      table.uuid('subcategory_id').nullable();
      table.uuid('priority_id').nullable();
      table.integer('itil_impact').nullable();
      table.integer('itil_urgency').nullable();
      table.jsonb('tags').notNullable().defaultTo('[]');
      table.jsonb('custom_fields').notNullable().defaultTo('{}');
      table.boolean('is_active').notNullable().defaultTo(true);
      table.uuid('source_ticket_id').nullable();
      table.uuid('created_by').nullable();
      table.uuid('updated_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'template_id']);
    });
  }

  if (!(await knex.schema.hasTable(ITEMS))) {
    await knex.schema.createTable(ITEMS, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('template_item_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('template_id').notNullable();
      table.text('item_name').notNullable();
      table.text('description').nullable();
      table.boolean('is_required').notNullable().defaultTo(true);
      table.integer('order_number').notNullable().defaultTo(0);
      table.uuid('checklist_template_id').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'template_item_id']);
    });
  }

  await addConstraint(knex, TEMPLATES, `${TEMPLATES}_itil_impact_check`,
    'CHECK (itil_impact IS NULL OR (itil_impact BETWEEN 1 AND 5))');
  await addConstraint(knex, TEMPLATES, `${TEMPLATES}_itil_urgency_check`,
    'CHECK (itil_urgency IS NULL OR (itil_urgency BETWEEN 1 AND 5))');
  await addConstraint(knex, TEMPLATES, `${TEMPLATES}_subcategory_needs_category_check`,
    'CHECK (subcategory_id IS NULL OR category_id IS NOT NULL)');

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${ITEMS}_template
    ON ${ITEMS} (tenant, template_id)
  `);

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  for (const table of [TEMPLATES, ITEMS]) {
    await ensureTenantDistribution(knex, table);
  }

  // Unique active name per tenant. Includes the distribution column, created after distribution.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${TEMPLATES}_active_name_unique
    ON ${TEMPLATES} (tenant, lower(name))
    WHERE is_active
  `);

  // Tenant-composite foreign keys, added after distribution.
  for (const table of [TEMPLATES, ITEMS]) {
    await addConstraint(knex, table, `${table}_tenant_foreign`,
      'FOREIGN KEY (tenant) REFERENCES tenants(tenant)');
  }
  await addConstraint(knex, ITEMS, `${ITEMS}_template_foreign`,
    `FOREIGN KEY (tenant, template_id) REFERENCES ${TEMPLATES} (tenant, template_id) ON DELETE CASCADE`);

  if (await knex.schema.hasTable('tickets')) {
    if (!(await knex.schema.hasColumn('tickets', 'created_from_template_id'))) {
      await knex.raw('ALTER TABLE tickets ADD COLUMN IF NOT EXISTS created_from_template_id uuid NULL');
    }
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('tickets')) {
    if (await knex.schema.hasColumn('tickets', 'created_from_template_id')) {
      await knex.raw('ALTER TABLE tickets DROP COLUMN IF EXISTS created_from_template_id');
    }
  }
  await knex.schema.dropTableIfExists(ITEMS);
  await knex.schema.dropTableIfExists(TEMPLATES);
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
