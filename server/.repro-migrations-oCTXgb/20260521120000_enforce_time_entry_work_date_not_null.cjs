// Enforce the current time-entry date model: work_date/work_timezone are required.
// This is intentionally idempotent because an older migration already populated these
// columns in most environments; this migration closes any drift before UI code treats
// work_date as canonical.

exports.config = { transaction: false };

async function isCitusDistributedTable(knex, tableName) {
  try {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
      ) as is_distributed
    `, [tableName]);
    return result.rows[0]?.is_distributed === true;
  } catch (_error) {
    return false;
  }
}

function assertKnownTimeEntryColumn(tableName, columnName) {
  if (tableName !== 'time_entries' || !['work_date', 'work_timezone'].includes(columnName)) {
    throw new Error(`Unexpected NOT NULL target: ${tableName}.${columnName}`);
  }
}

async function setNotNull(knex, tableName, columnName) {
  assertKnownTimeEntryColumn(tableName, columnName);
  const isDistributed = await isCitusDistributedTable(knex, tableName);

  if (isDistributed) {
    await knex.raw(`
      SELECT * FROM run_command_on_shards(
        ?,
        $$ALTER TABLE %s ALTER COLUMN ${columnName} SET NOT NULL$$
      )
    `, [tableName]);

    await knex.raw(`
      UPDATE pg_attribute
      SET attnotnull = true
      WHERE attrelid = ?::regclass
        AND attname = ?
        AND attnotnull = false
    `, [tableName, columnName]);
    return;
  }

  await knex.raw(`ALTER TABLE ${tableName} ALTER COLUMN ${columnName} SET NOT NULL`);
}

async function dropNotNull(knex, tableName, columnName) {
  assertKnownTimeEntryColumn(tableName, columnName);
  const isDistributed = await isCitusDistributedTable(knex, tableName);

  if (isDistributed) {
    await knex.raw(`
      SELECT * FROM run_command_on_shards(
        ?,
        $$ALTER TABLE %s ALTER COLUMN ${columnName} DROP NOT NULL$$
      )
    `, [tableName]);

    await knex.raw(`
      UPDATE pg_attribute
      SET attnotnull = false
      WHERE attrelid = ?::regclass
        AND attname = ?
        AND attnotnull = true
    `, [tableName, columnName]);
    return;
  }

  await knex.raw(`ALTER TABLE ${tableName} ALTER COLUMN ${columnName} DROP NOT NULL`);
}

exports.up = async function up(knex) {
  const hasWorkDate = await knex.schema.hasColumn('time_entries', 'work_date');
  const hasWorkTimezone = await knex.schema.hasColumn('time_entries', 'work_timezone');

  if (!hasWorkDate || !hasWorkTimezone) {
    await knex.schema.alterTable('time_entries', (table) => {
      if (!hasWorkDate) table.date('work_date').nullable();
      if (!hasWorkTimezone) table.text('work_timezone').nullable();
    });
  }

  const tenantsResult = await knex.raw(`
    SELECT DISTINCT tenant
    FROM time_entries
    WHERE work_date IS NULL OR work_timezone IS NULL OR work_timezone = ''
  `);

  for (const row of tenantsResult.rows) {
    const tenant = String(row.tenant);

    await knex.raw(`
      UPDATE time_entries te
      SET
        work_timezone = COALESCE(NULLIF(te.work_timezone, ''), NULLIF(u.timezone, ''), 'UTC'),
        work_date = COALESCE(te.work_date, (te.start_time AT TIME ZONE COALESCE(NULLIF(te.work_timezone, ''), NULLIF(u.timezone, ''), 'UTC'))::date)
      FROM users u
      WHERE te.tenant = ?::uuid
        AND te.tenant = u.tenant
        AND te.user_id = u.user_id
        AND te.start_time IS NOT NULL
        AND (te.work_date IS NULL OR te.work_timezone IS NULL OR te.work_timezone = '')
    `, [tenant]);

    await knex.raw(`
      UPDATE time_entries
      SET
        work_timezone = COALESCE(NULLIF(work_timezone, ''), 'UTC'),
        work_date = COALESCE(work_date, (start_time AT TIME ZONE COALESCE(NULLIF(work_timezone, ''), 'UTC'))::date)
      WHERE tenant = ?::uuid
        AND start_time IS NOT NULL
        AND (work_date IS NULL OR work_timezone IS NULL OR work_timezone = '')
    `, [tenant]);

    await knex.raw(`
      UPDATE time_entries
      SET
        work_timezone = COALESCE(NULLIF(work_timezone, ''), 'UTC'),
        work_date = COALESCE(work_date, (created_at AT TIME ZONE 'UTC')::date, CURRENT_DATE)
      WHERE tenant = ?::uuid
        AND (work_date IS NULL OR work_timezone IS NULL OR work_timezone = '')
    `, [tenant]);
  }

  const nullCheck = await knex.raw(`
    SELECT COUNT(*)::integer as count
    FROM time_entries
    WHERE work_date IS NULL OR work_timezone IS NULL OR work_timezone = ''
  `);
  const nullCount = Number(nullCheck.rows[0]?.count ?? 0);
  if (nullCount > 0) {
    throw new Error(`Cannot enforce time_entries work_date/work_timezone NOT NULL; ${nullCount} rows remain incomplete.`);
  }

  await setNotNull(knex, 'time_entries', 'work_date');
  await setNotNull(knex, 'time_entries', 'work_timezone');

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS time_entries_tenant_user_work_date_idx
      ON time_entries (tenant, user_id, work_date)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS time_entries_tenant_work_date_idx
      ON time_entries (tenant, work_date)
  `);
};

exports.down = async function down(knex) {
  const hasWorkDate = await knex.schema.hasColumn('time_entries', 'work_date');
  const hasWorkTimezone = await knex.schema.hasColumn('time_entries', 'work_timezone');

  if (hasWorkDate) {
    await dropNotNull(knex, 'time_entries', 'work_date');
  }
  if (hasWorkTimezone) {
    await dropNotNull(knex, 'time_entries', 'work_timezone');
  }
};
