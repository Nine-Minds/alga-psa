const CREATED_BY_FK = 'service_categories_tenant_created_by_foreign';
const UPDATED_BY_FK = 'service_categories_tenant_updated_by_foreign';

const hasColumn = (knex, table, column) => knex.schema.hasColumn(table, column);

const constraintExists = async (knex, constraintName) => {
  const { rows } = await knex.raw(
    'SELECT 1 FROM pg_constraint WHERE conname = ? LIMIT 1',
    [constraintName]
  );

  return rows.length > 0;
};

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

const isCitus = async (knex) => {
  const { rows } = await knex.raw(
    "SELECT 1 FROM pg_extension WHERE extname = 'citus'"
  );
  return rows.length > 0;
};

const addForeignKey = async (knex, constraintName, column) => {
  if (await constraintExists(knex, constraintName)) {
    return;
  }

  const citus = await isCitus(knex);
  const onDeleteClause = citus ? '' : ' ON DELETE SET NULL';

  await knex.raw(`
    ALTER TABLE service_categories
    ADD CONSTRAINT ${constraintName}
    FOREIGN KEY (tenant, ${column})
    REFERENCES users (tenant, user_id)${onDeleteClause};
  `);
};

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  const needsIsActive = !(await hasColumn(knex, 'service_categories', 'is_active'));
  const lacksCreatedAt = !(await hasColumn(knex, 'service_categories', 'created_at'));
  const lacksUpdatedAt = !(await hasColumn(knex, 'service_categories', 'updated_at'));
  const lacksCreatedBy = !(await hasColumn(knex, 'service_categories', 'created_by'));
  const lacksUpdatedBy = !(await hasColumn(knex, 'service_categories', 'updated_by'));

  if (needsIsActive) {
    await knex.schema.alterTable('service_categories', (table) => {
      table.boolean('is_active').notNullable().defaultTo(true);
    });
  }

  if (lacksCreatedAt || lacksUpdatedAt || lacksCreatedBy || lacksUpdatedBy) {
    await knex.schema.alterTable('service_categories', (table) => {
      if (lacksCreatedAt) {
        table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      }
      if (lacksUpdatedAt) {
        table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      }
      if (lacksCreatedBy) {
        table.uuid('created_by');
      }
      if (lacksUpdatedBy) {
        table.uuid('updated_by');
      }
    });
  }

  if (await hasColumn(knex, 'service_categories', 'created_at')) {
    await knex.raw('UPDATE service_categories SET created_at = DEFAULT WHERE created_at IS NULL');
  }

  if (await hasColumn(knex, 'service_categories', 'updated_at')) {
    await knex.raw('UPDATE service_categories SET updated_at = DEFAULT WHERE updated_at IS NULL');
  }

  if (await hasColumn(knex, 'service_categories', 'created_by')) {
    await knex.raw(`
      WITH first_users AS (
        SELECT tenant, user_id
        FROM (
          SELECT tenant,
                 user_id,
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

    await addForeignKey(knex, CREATED_BY_FK, 'created_by');
  }

  if (await hasColumn(knex, 'service_categories', 'updated_by')) {
    await knex.raw(`
      WITH first_users AS (
        SELECT tenant, user_id
        FROM (
          SELECT tenant,
                 user_id,
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

    await addForeignKey(knex, UPDATED_BY_FK, 'updated_by');
  }
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);

  if (await constraintExists(knex, CREATED_BY_FK)) {
    await knex.raw(`
      ALTER TABLE service_categories
      DROP CONSTRAINT ${CREATED_BY_FK};
    `);
  }

  if (await constraintExists(knex, UPDATED_BY_FK)) {
    await knex.raw(`
      ALTER TABLE service_categories
      DROP CONSTRAINT ${UPDATED_BY_FK};
    `);
  }

  const hasCreatedBy = await hasColumn(knex, 'service_categories', 'created_by');
  const hasUpdatedBy = await hasColumn(knex, 'service_categories', 'updated_by');
  const hasCreatedAt = await hasColumn(knex, 'service_categories', 'created_at');
  const hasUpdatedAt = await hasColumn(knex, 'service_categories', 'updated_at');
  const hasIsActive = await hasColumn(knex, 'service_categories', 'is_active');

  if (hasCreatedBy || hasUpdatedBy || hasCreatedAt || hasUpdatedAt) {
    await knex.schema.alterTable('service_categories', (table) => {
      if (hasCreatedBy) {
        table.dropColumn('created_by');
      }
      if (hasUpdatedBy) {
        table.dropColumn('updated_by');
      }
      if (hasCreatedAt) {
        table.dropColumn('created_at');
      }
      if (hasUpdatedAt) {
        table.dropColumn('updated_at');
      }
    });
  }

  if (hasIsActive) {
    await knex.schema.alterTable('service_categories', (table) => {
      table.dropColumn('is_active');
    });
  }
};

exports.config = { transaction: false };
