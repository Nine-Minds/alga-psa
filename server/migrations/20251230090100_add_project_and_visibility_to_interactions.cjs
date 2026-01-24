/**
 * Extend interactions to support workflow-created activity notes targeting projects
 * and to persist visibility/category/tags for reporting/search.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasProjectId = await knex.schema.hasColumn('interactions', 'project_id');
  const hasVisibility = await knex.schema.hasColumn('interactions', 'visibility');
  const hasCategory = await knex.schema.hasColumn('interactions', 'category');
  const hasTags = await knex.schema.hasColumn('interactions', 'tags');

  if (!hasProjectId || !hasVisibility || !hasCategory || !hasTags) {
    await knex.schema.alterTable('interactions', (table) => {
      if (!hasProjectId) table.uuid('project_id').nullable();
      if (!hasVisibility) table.text('visibility').notNullable().defaultTo('internal');
      if (!hasCategory) table.text('category');
      if (!hasTags) table.specificType('tags', 'text[]');
    });
  }

  // Add FK + constraint best-effort (older deployments may not have projects table).
  // Note: Citus doesn't support ON DELETE SET NULL when distribution key is in FK,
  // so we use NO ACTION (default). Application must handle cleanup before project deletion.
  const hasProjects = await knex.schema.hasTable('projects');
  if (hasProjects && !hasProjectId) {
    await knex.raw(`
      ALTER TABLE interactions
      ADD CONSTRAINT interactions_project_fk
      FOREIGN KEY (tenant, project_id)
      REFERENCES projects (tenant, project_id)
    `);
  }

  // Check constraint for visibility values.
  if (!hasVisibility) {
    await knex.raw(`
      ALTER TABLE interactions
      ADD CONSTRAINT interactions_visibility_check
      CHECK (visibility IN ('internal', 'client_visible'))
    `);
  }

  await knex.raw(`CREATE INDEX IF NOT EXISTS interactions_tenant_project_idx ON interactions (tenant, project_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS interactions_tenant_visibility_idx ON interactions (tenant, visibility)`);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  // Drop indexes
  await knex.raw(`DROP INDEX IF EXISTS interactions_tenant_project_idx`);
  await knex.raw(`DROP INDEX IF EXISTS interactions_tenant_visibility_idx`);

  // Drop constraints if present
  await knex.raw(`ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_project_fk`);
  await knex.raw(`ALTER TABLE interactions DROP CONSTRAINT IF EXISTS interactions_visibility_check`);

  const hasProjectId = await knex.schema.hasColumn('interactions', 'project_id');
  const hasVisibility = await knex.schema.hasColumn('interactions', 'visibility');
  const hasCategory = await knex.schema.hasColumn('interactions', 'category');
  const hasTags = await knex.schema.hasColumn('interactions', 'tags');

  if (hasProjectId || hasVisibility || hasCategory || hasTags) {
    await knex.schema.alterTable('interactions', (table) => {
      if (hasTags) table.dropColumn('tags');
      if (hasCategory) table.dropColumn('category');
      if (hasVisibility) table.dropColumn('visibility');
      if (hasProjectId) table.dropColumn('project_id');
    });
  }
};

