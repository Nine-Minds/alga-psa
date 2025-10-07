const hasColumn = (knex, table, column) => knex.schema.hasColumn(table, column);

const ensureSequentialMode = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) THEN
        EXECUTE 'SET citus.multi_shard_modify_mode TO ''sequential''';
      END IF;
    END $$;
  `);
};

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  if (!await hasColumn(knex, 'service_categories', 'is_active')) {
    await knex.schema.alterTable('service_categories', table => {
      table.boolean('is_active').notNullable().defaultTo(true);
    });
  }

  const lacksCreatedAt = !await hasColumn(knex, 'service_categories', 'created_at');

  if (lacksCreatedAt) {
    await knex.schema.alterTable('service_categories', table => {
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');
      table.uuid('updated_by');
    });

    await knex.raw('UPDATE service_categories SET created_at = DEFAULT WHERE created_at IS NULL');
    await knex.raw('UPDATE service_categories SET updated_at = DEFAULT WHERE updated_at IS NULL');

    await knex.raw(`
      WITH first_users AS (
        SELECT tenant, user_id
        FROM (
          SELECT tenant, user_id,
                 ROW_NUMBER() OVER (PARTITION BY tenant ORDER BY created_at) AS rn
          FROM users
        ) ranked
        WHERE rn = 1
      )
      UPDATE service_categories AS sc
      SET created_by = first_users.user_id
      FROM first_users
      WHERE sc.tenant = first_users.tenant
        AND sc.created_by IS NULL;
    `);

    await knex.raw(`
      WITH first_users AS (
        SELECT tenant, user_id
        FROM (
          SELECT tenant, user_id,
                 ROW_NUMBER() OVER (PARTITION BY tenant ORDER BY created_at) AS rn
          FROM users
        ) ranked
        WHERE rn = 1
      )
      UPDATE service_categories AS sc
      SET updated_by = first_users.user_id
      FROM first_users
      WHERE sc.tenant = first_users.tenant
        AND sc.updated_by IS NULL;
    `);

    await knex.schema.alterTable('service_categories', table => {
      table
        .foreign(['tenant', 'created_by'])
        .references(['tenant', 'user_id'])
        .inTable('users')
        .onDelete('SET NULL');
      table
        .foreign(['tenant', 'updated_by'])
        .references(['tenant', 'user_id'])
        .inTable('users')
        .onDelete('SET NULL');
    });
  }
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);

  if (await hasColumn(knex, 'service_categories', 'created_by')) {
    await knex.schema.alterTable('service_categories', table => {
      table.dropForeign(['tenant', 'created_by']);
      table.dropForeign(['tenant', 'updated_by']);
    });

    await knex.schema.alterTable('service_categories', table => {
      table.dropColumn('created_by');
      table.dropColumn('updated_by');
      table.dropColumn('created_at');
      table.dropColumn('updated_at');
    });
  }

  if (await hasColumn(knex, 'service_categories', 'is_active')) {
    await knex.schema.alterTable('service_categories', table => {
      table.dropColumn('is_active');
    });
  }
};

exports.config = { transaction: false };
