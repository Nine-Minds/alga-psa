/**
 * Shared calendars (2026-09-22)
 *
 * - `calendars`: personal calendars (one per owner, created lazily to hold
 *   shares) and group calendars (named, MSP-owned).
 * - `calendar_shares`: access grants on a calendar to a user or a team.
 * - `schedule_entries.calendar_id`: places an entry on a group calendar.
 *
 * See ee/docs/plans/2026-09-22-shared-calendars.
 *
 * Grantee FKs are polymorphic (user | team), so grantee cleanup on user/team
 * deletion happens in application code. Citus does not support
 * ON DELETE SET NULL, so group calendars are archived rather than deleted.
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

async function addConstraintIfMissing(knex, constraintName, sql) {
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

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('calendars'))) {
    await knex.schema.createTable('calendars', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('calendar_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('calendar_type').notNullable();
      table.uuid('owner_user_id').nullable();
      table.text('name').nullable();
      table.text('description').nullable();
      table.text('color').nullable();
      table.boolean('is_archived').notNullable().defaultTo(false);
      table.uuid('created_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'calendar_id']);
    });

    await knex.raw(`
      ALTER TABLE calendars
      ADD CONSTRAINT calendars_type_check
      CHECK (calendar_type IN ('personal', 'group'))
    `);
    await knex.raw(`
      ALTER TABLE calendars
      ADD CONSTRAINT calendars_shape_check
      CHECK (
        (calendar_type = 'personal' AND owner_user_id IS NOT NULL)
        OR (calendar_type = 'group' AND name IS NOT NULL AND length(btrim(name)) > 0)
      )
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX calendars_personal_owner_unique
      ON calendars (tenant, owner_user_id)
      WHERE calendar_type = 'personal'
    `);
  }

  if (!(await knex.schema.hasTable('calendar_shares'))) {
    await knex.schema.createTable('calendar_shares', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('share_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('calendar_id').notNullable();
      table.text('grantee_type').notNullable();
      table.uuid('grantee_id').notNullable();
      table.text('access_level').notNullable();
      table.uuid('created_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'share_id']);
      table.unique(['tenant', 'calendar_id', 'grantee_type', 'grantee_id'], {
        indexName: 'calendar_shares_grantee_unique',
      });
    });

    await knex.raw(`
      ALTER TABLE calendar_shares
      ADD CONSTRAINT calendar_shares_grantee_type_check
      CHECK (grantee_type IN ('user', 'team'))
    `);
    await knex.raw(`
      ALTER TABLE calendar_shares
      ADD CONSTRAINT calendar_shares_access_level_check
      CHECK (access_level IN ('free_busy', 'read', 'edit', 'manage'))
    `);
    await knex.raw(`
      CREATE INDEX calendar_shares_grantee_idx
      ON calendar_shares (tenant, grantee_type, grantee_id)
    `);
  }

  // Distribute before FKs — Citus requires both sides distributed first.
  await ensureTenantDistribution(knex, 'calendars');
  await ensureTenantDistribution(knex, 'calendar_shares');

  await addConstraintIfMissing(knex, 'calendars_tenant_fkey', `
    ALTER TABLE calendars
      ADD CONSTRAINT calendars_tenant_fkey
      FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
  `);
  await addConstraintIfMissing(knex, 'calendars_owner_fkey', `
    ALTER TABLE calendars
      ADD CONSTRAINT calendars_owner_fkey
      FOREIGN KEY (tenant, owner_user_id) REFERENCES users(tenant, user_id) ON DELETE CASCADE
  `);
  await addConstraintIfMissing(knex, 'calendar_shares_tenant_fkey', `
    ALTER TABLE calendar_shares
      ADD CONSTRAINT calendar_shares_tenant_fkey
      FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
  `);
  await addConstraintIfMissing(knex, 'calendar_shares_calendar_fkey', `
    ALTER TABLE calendar_shares
      ADD CONSTRAINT calendar_shares_calendar_fkey
      FOREIGN KEY (tenant, calendar_id) REFERENCES calendars(tenant, calendar_id) ON DELETE CASCADE
  `);

  if (!(await knex.schema.hasColumn('schedule_entries', 'calendar_id'))) {
    await knex.schema.alterTable('schedule_entries', (table) => {
      table.uuid('calendar_id').nullable();
    });
  }
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS schedule_entries_calendar_idx
    ON schedule_entries (tenant, calendar_id)
  `);
  await addConstraintIfMissing(knex, 'schedule_entries_calendar_fkey', `
    ALTER TABLE schedule_entries
      ADD CONSTRAINT schedule_entries_calendar_fkey
      FOREIGN KEY (tenant, calendar_id) REFERENCES calendars(tenant, calendar_id)
  `);
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE schedule_entries DROP CONSTRAINT IF EXISTS schedule_entries_calendar_fkey');
  await knex.raw('DROP INDEX IF EXISTS schedule_entries_calendar_idx');
  if (await knex.schema.hasColumn('schedule_entries', 'calendar_id')) {
    await knex.schema.alterTable('schedule_entries', (table) => {
      table.dropColumn('calendar_id');
    });
  }
  await knex.schema.dropTableIfExists('calendar_shares');
  await knex.schema.dropTableIfExists('calendars');
};

// Citus requires FK manipulation / distribution to run outside a transaction.
exports.config = { transaction: false };
