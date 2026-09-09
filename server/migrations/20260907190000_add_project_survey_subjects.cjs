const tables = ['survey_invitations', 'survey_responses'];

exports.up = async function (knex) {
  for (const table of tables) {
    await knex.schema.alterTable(table, builder => {
      builder.uuid('project_id').nullable();
      builder.foreign(['project_id', 'tenant'], `${table}_project_tenant_fk`)
        .references(['project_id', 'tenant']).inTable('projects').onDelete('CASCADE');
      builder.index(['tenant', 'project_id'], `${table}_tenant_project_idx`);
    });
    await knex.raw('ALTER TABLE ?? ALTER COLUMN ticket_id DROP NOT NULL', [table]);
    await knex.raw('ALTER TABLE ?? ADD CONSTRAINT ?? CHECK ((ticket_id IS NOT NULL) <> (project_id IS NOT NULL))',
      [table, `${table}_one_subject_check`]);
  }
};

exports.down = async function (knex) {
  // Never discard project responses or silently relabel them as tickets.
  for (const table of tables) {
    if (await knex(table).whereNotNull('project_id').first()) {
      throw new Error('Cannot remove project survey support while project invitations or responses exist');
    }
  }
  for (const table of [...tables].reverse()) {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [table, `${table}_one_subject_check`]);
    await knex.schema.alterTable(table, builder => {
      builder.dropForeign(['project_id', 'tenant'], `${table}_project_tenant_fk`);
      builder.dropIndex(['tenant', 'project_id'], `${table}_tenant_project_idx`);
      builder.dropColumn('project_id');
    });
    await knex.raw('ALTER TABLE ?? ALTER COLUMN ticket_id SET NOT NULL', [table]);
  }
};
