/**
 * Ticket close rules: schema (2026-06-10)
 *
 * Creates the seven tables behind per-board close validation gates, ticket
 * checklists (with accountability + template provenance), and auto-close
 * rules. See docs/plans/2026-06-10-ticket-close-rules/PRD.md.
 *
 *  - board_close_rules              one row per board: which gates are on
 *  - checklist_templates            admin-defined reusable checklists
 *  - checklist_template_items       items belonging to a template
 *  - checklist_template_apply_rules auto-apply matchers (null = match any)
 *  - ticket_checklist_items         live checklist on a ticket (items are
 *                                   COPIED from templates, never referenced,
 *                                   so template edits don't rewrite history)
 *  - board_auto_close_rules         status + inactivity timers per board
 *  - ticket_auto_close_state        scan scratchpad: pending close per ticket
 *
 * All tables are tenant-scoped with composite (tenant, id) primary keys and
 * Citus distribution, following ticket_audit_logs. No RLS policies — newer
 * tables rely on application-level tenant scoping (see
 * 20251111120000_disable_rls_on_survey_tables.cjs).
 */

// Helper: distribute a table by tenant if Citus is available
async function distributeIfCitus(knex, tableName) {
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);
  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;
    `);
    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant')`);
    }
  }
}

// Helper: add a composite FK only if it doesn't already exist
async function addForeignKeyIfMissing(knex, constraintName, sql) {
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${constraintName}'
      ) THEN
        ${sql};
      END IF;
    END $$;
  `);
}

exports.up = async function (knex) {
  // --- board_close_rules -------------------------------------------------
  if (!(await knex.schema.hasTable('board_close_rules'))) {
    await knex.schema.createTable('board_close_rules', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('board_id').notNullable();
      table.boolean('require_resolution_comment').notNullable().defaultTo(false);
      table.boolean('require_time_entry').notNullable().defaultTo(false);
      table.boolean('require_checklist_complete').notNullable().defaultTo(false);
      table.boolean('require_no_open_children').notNullable().defaultTo(false);
      table.jsonb('required_fields').notNullable().defaultTo('[]')
        .comment('Ticket fields that must be non-null to close: category_id, subcategory_id, priority_id, assigned_to.');
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'board_id']);
    });
  }

  // --- checklist_templates -----------------------------------------------
  if (!(await knex.schema.hasTable('checklist_templates'))) {
    await knex.schema.createTable('checklist_templates', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('template_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('name').notNullable();
      table.text('description');
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'template_id']);
    });
  }

  // --- checklist_template_items -------------------------------------------
  if (!(await knex.schema.hasTable('checklist_template_items'))) {
    await knex.schema.createTable('checklist_template_items', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('template_item_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('template_id').notNullable();
      table.text('item_name').notNullable();
      table.text('description');
      table.integer('order_number').notNullable().defaultTo(0);
      table.boolean('is_required').notNullable().defaultTo(true);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'template_item_id']);
      table.index(['tenant', 'template_id'], 'checklist_template_items_template_idx');
    });
  }

  // --- checklist_template_apply_rules --------------------------------------
  if (!(await knex.schema.hasTable('checklist_template_apply_rules'))) {
    await knex.schema.createTable('checklist_template_apply_rules', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('apply_rule_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('template_id').notNullable();
      table.uuid('board_id').nullable().comment('Null matches any board.');
      table.uuid('category_id').nullable().comment('Null matches any category.');
      table.uuid('subcategory_id').nullable().comment('Null matches any subcategory.');
      table.uuid('priority_id').nullable().comment('Null matches any priority.');
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'apply_rule_id']);
      table.index(['tenant', 'template_id'], 'checklist_template_apply_rules_template_idx');
    });
  }

  // --- ticket_checklist_items ----------------------------------------------
  if (!(await knex.schema.hasTable('ticket_checklist_items'))) {
    await knex.schema.createTable('ticket_checklist_items', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('checklist_item_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('ticket_id').notNullable();
      table.text('item_name').notNullable();
      table.text('description');
      table.integer('order_number').notNullable().defaultTo(0);
      table.uuid('assigned_to').nullable();
      table.boolean('is_required').notNullable().defaultTo(true)
        .comment('Only required items gate ticket closure.');
      table.boolean('completed').notNullable().defaultTo(false);
      table.uuid('completed_by').nullable()
        .comment('Accountability: who checked the item. Cleared on uncheck (uncheck is audit-logged).');
      table.timestamp('completed_at', { useTz: true }).nullable();
      table.string('source', 16).notNullable().defaultTo('manual')
        .comment('Provenance: manual, template, workflow.');
      table.uuid('template_id').nullable()
        .comment('Template the item was copied from; also the idempotency key for re-application. No FK — items outlive their template.');
      table.uuid('created_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'checklist_item_id']);
      table.index(['tenant', 'ticket_id'], 'ticket_checklist_items_ticket_idx');
    });

    await knex.raw(`
      ALTER TABLE ticket_checklist_items
      ADD CONSTRAINT ticket_checklist_items_source_check
      CHECK (source IN ('manual', 'template', 'workflow'))
    `);
  }

  // --- board_auto_close_rules ----------------------------------------------
  if (!(await knex.schema.hasTable('board_auto_close_rules'))) {
    await knex.schema.createTable('board_auto_close_rules', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('rule_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('board_id').notNullable();
      table.uuid('trigger_status_id').notNullable()
        .comment('Open status whose tickets age toward auto-close.');
      table.integer('inactivity_days').notNullable();
      table.integer('warning_days_before').nullable()
        .comment('Send the warning this many days before the scheduled close. Null = no warning.');
      table.uuid('close_to_status_id').notNullable()
        .comment('Target status; must have is_closed = true (enforced by the server action).');
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'rule_id']);
      table.unique(['tenant', 'board_id', 'trigger_status_id'], 'board_auto_close_rules_board_status_uq');
    });

    await knex.raw(`
      ALTER TABLE board_auto_close_rules
      ADD CONSTRAINT board_auto_close_rules_inactivity_check
      CHECK (inactivity_days > 0)
    `);
    await knex.raw(`
      ALTER TABLE board_auto_close_rules
      ADD CONSTRAINT board_auto_close_rules_warning_check
      CHECK (warning_days_before IS NULL OR (warning_days_before > 0 AND warning_days_before < inactivity_days))
    `);
  }

  // --- ticket_auto_close_state ----------------------------------------------
  if (!(await knex.schema.hasTable('ticket_auto_close_state'))) {
    await knex.schema.createTable('ticket_auto_close_state', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('ticket_id').notNullable();
      table.uuid('rule_id').notNullable();
      table.timestamp('scheduled_close_at', { useTz: true }).notNullable();
      table.timestamp('warning_sent_at', { useTz: true }).nullable();
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'ticket_id']);
      table.index(['tenant', 'scheduled_close_at'], 'ticket_auto_close_state_due_idx');
    });
  }

  // Distribute before FKs — Citus requires both sides distributed first.
  await distributeIfCitus(knex, 'board_close_rules');
  await distributeIfCitus(knex, 'checklist_templates');
  await distributeIfCitus(knex, 'checklist_template_items');
  await distributeIfCitus(knex, 'checklist_template_apply_rules');
  await distributeIfCitus(knex, 'ticket_checklist_items');
  await distributeIfCitus(knex, 'board_auto_close_rules');
  await distributeIfCitus(knex, 'ticket_auto_close_state');

  await addForeignKeyIfMissing(knex, 'board_close_rules_board_fkey', `
    ALTER TABLE board_close_rules
      ADD CONSTRAINT board_close_rules_board_fkey
      FOREIGN KEY (tenant, board_id)
      REFERENCES boards(tenant, board_id)
      ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, 'checklist_template_items_template_fkey', `
    ALTER TABLE checklist_template_items
      ADD CONSTRAINT checklist_template_items_template_fkey
      FOREIGN KEY (tenant, template_id)
      REFERENCES checklist_templates(tenant, template_id)
      ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, 'checklist_template_apply_rules_template_fkey', `
    ALTER TABLE checklist_template_apply_rules
      ADD CONSTRAINT checklist_template_apply_rules_template_fkey
      FOREIGN KEY (tenant, template_id)
      REFERENCES checklist_templates(tenant, template_id)
      ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, 'ticket_checklist_items_ticket_fkey', `
    ALTER TABLE ticket_checklist_items
      ADD CONSTRAINT ticket_checklist_items_ticket_fkey
      FOREIGN KEY (tenant, ticket_id)
      REFERENCES tickets(tenant, ticket_id)
      ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, 'board_auto_close_rules_board_fkey', `
    ALTER TABLE board_auto_close_rules
      ADD CONSTRAINT board_auto_close_rules_board_fkey
      FOREIGN KEY (tenant, board_id)
      REFERENCES boards(tenant, board_id)
      ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, 'board_auto_close_rules_trigger_status_fkey', `
    ALTER TABLE board_auto_close_rules
      ADD CONSTRAINT board_auto_close_rules_trigger_status_fkey
      FOREIGN KEY (tenant, trigger_status_id)
      REFERENCES statuses(tenant, status_id)
  `);

  await addForeignKeyIfMissing(knex, 'board_auto_close_rules_close_status_fkey', `
    ALTER TABLE board_auto_close_rules
      ADD CONSTRAINT board_auto_close_rules_close_status_fkey
      FOREIGN KEY (tenant, close_to_status_id)
      REFERENCES statuses(tenant, status_id)
  `);

  await addForeignKeyIfMissing(knex, 'ticket_auto_close_state_ticket_fkey', `
    ALTER TABLE ticket_auto_close_state
      ADD CONSTRAINT ticket_auto_close_state_ticket_fkey
      FOREIGN KEY (tenant, ticket_id)
      REFERENCES tickets(tenant, ticket_id)
      ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, 'ticket_auto_close_state_rule_fkey', `
    ALTER TABLE ticket_auto_close_state
      ADD CONSTRAINT ticket_auto_close_state_rule_fkey
      FOREIGN KEY (tenant, rule_id)
      REFERENCES board_auto_close_rules(tenant, rule_id)
      ON DELETE CASCADE
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('ticket_auto_close_state');
  await knex.schema.dropTableIfExists('board_auto_close_rules');
  await knex.schema.dropTableIfExists('ticket_checklist_items');
  await knex.schema.dropTableIfExists('checklist_template_apply_rules');
  await knex.schema.dropTableIfExists('checklist_template_items');
  await knex.schema.dropTableIfExists('checklist_templates');
  await knex.schema.dropTableIfExists('board_close_rules');
};

// Citus requires FK manipulation to run outside a transaction block.
exports.config = { transaction: false };
