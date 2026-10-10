/**
 * Board notification rules and board default watchers: schema (2026-10-06)
 *
 *  - board_notification_rules           zero or more rules per board (create trigger flag)
 *  - board_notification_rule_statuses   statuses that trigger a rule (no cascade from statuses:
 *                                       deleting a referenced status is blocked)
 *  - board_notification_rule_recipients one user OR one team per row (teams expand at send time)
 *  - board_default_watchers             internal users seeded into watch_list on ticket creation
 *
 * See docs/plans/2026-10-06-board-notification-rules-plan.md.
 * Modelled on 20260610100000_create_ticket_close_rules_tables.cjs.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

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
  if (!(await knex.schema.hasTable('board_notification_rules'))) {
    await knex.schema.createTable('board_notification_rules', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('rule_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('board_id').notNullable();
      table.boolean('notify_on_create').notNullable().defaultTo(false);
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.uuid('created_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'rule_id']);
      table.index(['tenant', 'board_id'], 'board_notification_rules_board_idx');
    });
  }

  if (!(await knex.schema.hasTable('board_notification_rule_statuses'))) {
    await knex.schema.createTable('board_notification_rule_statuses', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('rule_id').notNullable();
      table.uuid('status_id').notNullable();
      table.primary(['tenant', 'rule_id', 'status_id']);
      table.index(['tenant', 'status_id'], 'board_notification_rule_statuses_status_idx');
    });
  }

  if (!(await knex.schema.hasTable('board_notification_rule_recipients'))) {
    await knex.schema.createTable('board_notification_rule_recipients', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('recipient_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('rule_id').notNullable();
      table.text('recipient_type').notNullable();
      table.uuid('user_id').nullable();
      table.uuid('team_id').nullable();
      table.primary(['tenant', 'recipient_id']);
      table.index(['tenant', 'rule_id'], 'board_notification_rule_recipients_rule_idx');
    });
    await knex.raw(`
      ALTER TABLE board_notification_rule_recipients
      ADD CONSTRAINT board_notification_rule_recipients_type_check
      CHECK (recipient_type IN ('user', 'team'))
    `);
    await knex.raw(`
      ALTER TABLE board_notification_rule_recipients
      ADD CONSTRAINT board_notification_rule_recipients_shape_check
      CHECK (
        (recipient_type = 'user' AND user_id IS NOT NULL AND team_id IS NULL)
        OR (recipient_type = 'team' AND team_id IS NOT NULL AND user_id IS NULL)
      )
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX board_notification_rule_recipients_user_uq
      ON board_notification_rule_recipients (tenant, rule_id, user_id) WHERE user_id IS NOT NULL
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX board_notification_rule_recipients_team_uq
      ON board_notification_rule_recipients (tenant, rule_id, team_id) WHERE team_id IS NOT NULL
    `);
  }

  if (!(await knex.schema.hasTable('board_default_watchers'))) {
    await knex.schema.createTable('board_default_watchers', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('board_id').notNullable();
      table.uuid('user_id').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'board_id', 'user_id']);
    });
  }

  // Distribute before FKs — Citus requires both sides distributed first.
  for (const t of [
    'board_notification_rules',
    'board_notification_rule_statuses',
    'board_notification_rule_recipients',
    'board_default_watchers',
  ]) {
    await ensureTenantDistribution(knex, t);
  }

  await addForeignKeyIfMissing(knex, 'board_notification_rules_board_fkey', `
    ALTER TABLE board_notification_rules
      ADD CONSTRAINT board_notification_rules_board_fkey
      FOREIGN KEY (tenant, board_id) REFERENCES boards(tenant, board_id) ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'board_notification_rule_statuses_rule_fkey', `
    ALTER TABLE board_notification_rule_statuses
      ADD CONSTRAINT board_notification_rule_statuses_rule_fkey
      FOREIGN KEY (tenant, rule_id) REFERENCES board_notification_rules(tenant, rule_id) ON DELETE CASCADE
  `);
  // No cascade: deleting a referenced status is blocked.
  await addForeignKeyIfMissing(knex, 'board_notification_rule_statuses_status_fkey', `
    ALTER TABLE board_notification_rule_statuses
      ADD CONSTRAINT board_notification_rule_statuses_status_fkey
      FOREIGN KEY (tenant, status_id) REFERENCES statuses(tenant, status_id)
  `);
  await addForeignKeyIfMissing(knex, 'board_notification_rule_recipients_rule_fkey', `
    ALTER TABLE board_notification_rule_recipients
      ADD CONSTRAINT board_notification_rule_recipients_rule_fkey
      FOREIGN KEY (tenant, rule_id) REFERENCES board_notification_rules(tenant, rule_id) ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'board_notification_rule_recipients_user_fkey', `
    ALTER TABLE board_notification_rule_recipients
      ADD CONSTRAINT board_notification_rule_recipients_user_fkey
      FOREIGN KEY (tenant, user_id) REFERENCES users(tenant, user_id)
  `);
  await addForeignKeyIfMissing(knex, 'board_notification_rule_recipients_team_fkey', `
    ALTER TABLE board_notification_rule_recipients
      ADD CONSTRAINT board_notification_rule_recipients_team_fkey
      FOREIGN KEY (tenant, team_id) REFERENCES teams(tenant, team_id)
  `);
  await addForeignKeyIfMissing(knex, 'board_default_watchers_board_fkey', `
    ALTER TABLE board_default_watchers
      ADD CONSTRAINT board_default_watchers_board_fkey
      FOREIGN KEY (tenant, board_id) REFERENCES boards(tenant, board_id) ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'board_default_watchers_user_fkey', `
    ALTER TABLE board_default_watchers
      ADD CONSTRAINT board_default_watchers_user_fkey
      FOREIGN KEY (tenant, user_id) REFERENCES users(tenant, user_id)
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('board_default_watchers');
  await knex.schema.dropTableIfExists('board_notification_rule_recipients');
  await knex.schema.dropTableIfExists('board_notification_rule_statuses');
  await knex.schema.dropTableIfExists('board_notification_rules');
};

// Citus requires FK manipulation to run outside a transaction block.
exports.config = { transaction: false };
