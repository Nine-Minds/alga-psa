'use strict';

/**
 * Canned ticket responses: a reusable-reply library for the ticket comment editor.
 *
 *   canned_responses            name + rich-text body + category + scope (personal/team/board/client_portal)
 *   canned_response_favorites   per-user favourite flag + last_used_at (drives "favourites" and "recents")
 *
 * Design notes
 *   - Separate entity, not a ticket-template kind (Design Session decision).
 *   - `body` holds serialized BlockNote JSON, exactly what `comments.note` holds, so the editor can load it
 *     as initial content and insert it as blocks. `body_markdown` is the derived plain rendering
 *     (what `comments.markdown_content` is for comments); it feeds search and list previews and is
 *     rewritten by the actions on every save.
 *   - `category` is a free-text folder rather than a FK to a category table. A canned-response library is
 *     personal/team-curated and a category here is a label, not a managed taxonomy: a FK would need its own
 *     admin screen, ownership rules per scope, and merge/rename tooling for no behavioural gain.
 *     Distinct values are listed straight from the table.
 *   - Scope target columns (owner_user_id / team_id / board_id) carry no FK, the same deliberate omission as
 *     ticket_templates: deleting a board or team must not be blocked by a response, and the actions validate
 *     the references on save. A response whose target is gone is simply never visible.
 *   - `actions jsonb` is reserved for macros (applying a response also sets ticket fields). Nullable,
 *     unused in v1.
 *   - canned_response_favorites has a row per (user, response) that was favourited OR used. `is_favorite`
 *     separates the two; `last_used_at` drives recents. A row exists after first use even if never favourited.
 *   - No RLS: row-level security was retired repo-wide (20260509120000_disable_remaining_rls_policies);
 *     tenant isolation is enforced by tenantDb in every action, as for ticket_templates.
 *
 * Citus: both tables are new (no stale local heap data). Unique and trigram indexes that include the
 * distribution column are created after distribution; foreign keys last. create_distributed_table cannot run
 * inside a transaction.
 */

const RESPONSES = 'canned_responses';
const FAVORITES = 'canned_response_favorites';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

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
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  if (!(await knex.schema.hasTable(RESPONSES))) {
    await knex.schema.createTable(RESPONSES, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('canned_response_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('name').notNullable();
      table.text('body').notNullable();
      table.text('body_markdown').notNullable().defaultTo('');
      table.text('category').nullable();
      table.text('scope').notNullable().defaultTo('personal');
      table.uuid('owner_user_id').nullable();
      table.uuid('team_id').nullable();
      table.uuid('board_id').nullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.jsonb('actions').nullable();
      table.uuid('created_by').nullable();
      table.uuid('updated_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'canned_response_id']);
    });
  }

  if (!(await knex.schema.hasTable(FAVORITES))) {
    await knex.schema.createTable(FAVORITES, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('user_id').notNullable();
      table.uuid('canned_response_id').notNullable();
      table.boolean('is_favorite').notNullable().defaultTo(false);
      table.timestamp('last_used_at', { useTz: true }).nullable();
      table.integer('use_count').notNullable().defaultTo(0);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'user_id', 'canned_response_id']);
    });
  }

  await addConstraint(knex, RESPONSES, `${RESPONSES}_scope_check`,
    "CHECK (scope IN ('personal', 'team', 'board', 'client_portal'))");
  // Each scope names exactly the target it needs, and no other.
  await addConstraint(knex, RESPONSES, `${RESPONSES}_scope_target_check`,
    `CHECK (
      (scope = 'personal'      AND owner_user_id IS NOT NULL AND team_id IS NULL     AND board_id IS NULL) OR
      (scope = 'team'          AND team_id IS NOT NULL       AND owner_user_id IS NULL AND board_id IS NULL) OR
      (scope = 'board'         AND board_id IS NOT NULL      AND owner_user_id IS NULL AND team_id IS NULL) OR
      (scope = 'client_portal' AND owner_user_id IS NULL     AND team_id IS NULL     AND board_id IS NULL)
    )`);

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  for (const table of [RESPONSES, FAVORITES]) {
    await ensureTenantDistribution(knex, table);
  }

  // Unique active name per scope target within a tenant (two agents may each own a "Greeting").
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${RESPONSES}_active_name_unique
    ON ${RESPONSES} (
      tenant, scope,
      COALESCE(owner_user_id, '${ZERO_UUID}'::uuid),
      COALESCE(team_id, '${ZERO_UUID}'::uuid),
      COALESCE(board_id, '${ZERO_UUID}'::uuid),
      lower(name)
    )
    WHERE is_active
  `);

  // Visibility lookups: by scope, then by the scope's target.
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_${RESPONSES}_scope ON ${RESPONSES} (tenant, scope, is_active)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_${RESPONSES}_owner ON ${RESPONSES} (tenant, owner_user_id) WHERE owner_user_id IS NOT NULL`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_${RESPONSES}_team ON ${RESPONSES} (tenant, team_id) WHERE team_id IS NOT NULL`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_${RESPONSES}_board ON ${RESPONSES} (tenant, board_id) WHERE board_id IS NOT NULL`);
  // Category filter and ordered listing.
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_${RESPONSES}_category ON ${RESPONSES} (tenant, lower(category), lower(name))`);
  // Substring search (ILIKE '%q%') over name, category and body for libraries with hundreds of entries.
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_${RESPONSES}_name_trgm ON ${RESPONSES} USING gin (name gin_trgm_ops)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_${RESPONSES}_category_trgm ON ${RESPONSES} USING gin (category gin_trgm_ops)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_${RESPONSES}_body_trgm ON ${RESPONSES} USING gin (body_markdown gin_trgm_ops)`);

  // Recents and favourites for one user.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${FAVORITES}_user_recent
    ON ${FAVORITES} (tenant, user_id, last_used_at DESC)
    WHERE last_used_at IS NOT NULL
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${FAVORITES}_user_favorite
    ON ${FAVORITES} (tenant, user_id)
    WHERE is_favorite
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_${FAVORITES}_response ON ${FAVORITES} (tenant, canned_response_id)`);

  for (const table of [RESPONSES, FAVORITES]) {
    await addConstraint(knex, table, `${table}_tenant_foreign`,
      'FOREIGN KEY (tenant) REFERENCES tenants(tenant)');
  }
  await addConstraint(knex, FAVORITES, `${FAVORITES}_response_foreign`,
    `FOREIGN KEY (tenant, canned_response_id) REFERENCES ${RESPONSES} (tenant, canned_response_id) ON DELETE CASCADE`);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(FAVORITES);
  await knex.schema.dropTableIfExists(RESPONSES);
  // pg_trgm is left installed: other migrations (app_search_index) depend on it.
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
