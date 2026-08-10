/**
 * Give project_template_status_mappings explicit, mutually exclusive typed
 * reference columns instead of one collapsed status_id UUID.
 *
 * Historically every referenced status was persisted in status_id and
 * applyProjectTemplate always wrote it to project_status_mappings.status_id
 * with is_standard=false — so a standard-status UUID became a tenant-status FK
 * value and could fail with PostgreSQL 23503. Deleted tenant statuses also left
 * dangling template mappings because status deletion validation never counted
 * template references and the table had no status FK.
 *
 * Each row is now one of four variants, guarded by a status_source
 * discriminator and a CHECK constraint on the exclusive column shape:
 *
 *   - tenant:     status_id references a tenant status.
 *   - standard:   standard_status_id references the global standard catalog.
 *   - inline:     custom_status_name defines a template-owned status; all UUIDs null.
 *   - unresolved: unresolved_status_id preserves the historical UUID;
 *                 unresolved_reason distinguishes missing from ambiguous.
 *
 * Historical rows are repaired deterministically: a UUID found in exactly one
 * catalog moves to that variant; a UUID found in neither is quarantined as
 * unresolved/missing; a UUID found in both (or a shape with no usable data) is
 * quarantined as unresolved/ambiguous with the original UUID preserved and
 * never guessed.
 *
 * Follows the Citus sequencing pattern in
 * 20260610150000_make_standard_statuses_global.cjs: reads of the global
 * standard catalog are injected as bindings rather than correlated subqueries,
 * and tenant reads are scoped by the distribution column.
 */

const COLUMNS = [
  'standard_status_id',
  'unresolved_status_id',
  'unresolved_reason',
  'status_source',
];

const CHECK_CONSTRAINTS = [
  {
    name: 'project_template_status_mappings_status_source_check',
    sql: `CHECK (status_source IN ('tenant', 'standard', 'inline', 'unresolved'))`,
  },
  {
    name: 'project_template_status_mappings_variant_shape_check',
    sql: `CHECK (
      (status_source = 'tenant'     AND status_id IS NOT NULL AND standard_status_id IS NULL AND unresolved_status_id IS NULL)
      OR (status_source = 'standard' AND standard_status_id IS NOT NULL AND status_id IS NULL AND unresolved_status_id IS NULL)
      OR (status_source = 'inline'   AND custom_status_name IS NOT NULL AND status_id IS NULL AND standard_status_id IS NULL AND unresolved_status_id IS NULL)
      OR (status_source = 'unresolved' AND status_id IS NULL AND standard_status_id IS NULL AND unresolved_reason IN ('missing', 'ambiguous'))
    )`,
  },
];

const FKS = [
  {
    name: 'project_template_status_mappings_tenant_status_id_foreign',
    sql: `FOREIGN KEY (tenant, status_id) REFERENCES statuses (tenant, status_id) ON DELETE RESTRICT`,
  },
  {
    name: 'project_template_status_mappings_standard_status_id_foreign',
    sql: `FOREIGN KEY (standard_status_id) REFERENCES standard_statuses (standard_status_id) ON DELETE RESTRICT`,
  },
];

const INDEXES = [
  ['project_template_status_mappings_tenant_status_idx', ['tenant', 'status_id']],
  ['project_template_status_mappings_standard_status_idx', ['standard_status_id']],
  ['project_template_status_mappings_source_idx', ['tenant', 'status_source']],
];

async function tableHasAnyColumn(knex) {
  for (const column of COLUMNS) {
    if (await knex.schema.hasColumn('project_template_status_mappings', column)) {
      return true;
    }
  }
  return false;
}

async function ensureColumns(knex) {
  const existing = new Set(
    (await knex('information_schema.columns')
      .where({ table_schema: 'public', table_name: 'project_template_status_mappings' })
      .select('column_name'))
      .map((row) => row.column_name)
  );

  if (!existing.has('standard_status_id')) {
    await knex.schema.alterTable('project_template_status_mappings', (table) => {
      table.uuid('standard_status_id');
    });
  }
  if (!existing.has('unresolved_status_id')) {
    await knex.schema.alterTable('project_template_status_mappings', (table) => {
      table.uuid('unresolved_status_id');
    });
  }
  if (!existing.has('unresolved_reason')) {
    await knex.schema.alterTable('project_template_status_mappings', (table) => {
      table.text('unresolved_reason');
    });
  }
  if (!existing.has('status_source')) {
    await knex.schema.alterTable('project_template_status_mappings', (table) => {
      table.string('status_source', 20);
    });
  }
}

/**
 * Classify every row that still lacks a status_source. Runs inside a single
 * transaction and is idempotent: rows already typed are left untouched, so a
 * re-run of the data-repair portion is a no-op.
 */
async function backfillStatusSources(knex) {
  const standardIds = new Set(
    (await knex('standard_statuses').select('standard_status_id')).map(
      (row) => row.standard_status_id
    )
  );

  const counts = {
    tenant: 0,
    standard: 0,
    inline: 0,
    unresolved_missing: 0,
    unresolved_ambiguous: 0,
  };

  const tenants = await knex('project_template_status_mappings')
    .distinct('tenant')
    .whereNull('status_source')
    .pluck('tenant');

  for (const tenant of tenants) {
    const tenantStatusIds = new Set(
      (await knex('statuses').where({ tenant }).select('status_id')).map((row) => row.status_id)
    );

    const untypedRows = await knex('project_template_status_mappings')
      .where({ tenant })
      .whereNull('status_source')
      .select('*');

    for (const row of untypedRows) {
      const update = { status_source: undefined };
      let source;

      if (row.status_id == null) {
        if (row.custom_status_name) {
          source = 'inline';
          update.status_source = 'inline';
        } else {
          source = 'unresolved_ambiguous';
          update.status_source = 'unresolved';
          update.unresolved_reason = 'ambiguous';
        }
      } else {
        const inTenant = tenantStatusIds.has(row.status_id);
        const inStandard = standardIds.has(row.status_id);

        if (inTenant && !inStandard) {
          source = 'tenant';
          update.status_source = 'tenant';
        } else if (!inTenant && inStandard) {
          source = 'standard';
          update.status_source = 'standard';
          update.standard_status_id = row.status_id;
          update.status_id = null;
        } else if (!inTenant && !inStandard) {
          source = 'unresolved_missing';
          update.status_source = 'unresolved';
          update.unresolved_status_id = row.status_id;
          update.unresolved_reason = 'missing';
          update.status_id = null;
        } else {
          source = 'unresolved_ambiguous';
          update.status_source = 'unresolved';
          update.unresolved_status_id = row.status_id;
          update.unresolved_reason = 'ambiguous';
          update.status_id = null;
        }
      }

      counts[source] += 1;

      await knex('project_template_status_mappings')
        .where({ tenant, template_status_mapping_id: row.template_status_mapping_id })
        .update(update);
    }
  }

  return counts;
}

async function ensureCheckConstraints(knex) {
  for (const constraint of CHECK_CONSTRAINTS) {
    const existing = await knex.raw(
      `SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = 'project_template_status_mappings'::regclass`,
      [constraint.name]
    );
    if (existing.rows?.length) continue;
    await knex.raw(
      `ALTER TABLE project_template_status_mappings ADD CONSTRAINT "${constraint.name}" ${constraint.sql}`
    );
  }

  const sourceNullable = await knex.raw(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'project_template_status_mappings' AND column_name = 'status_source'`
  );
  if (sourceNullable.rows?.[0]?.is_nullable !== 'NO') {
    await knex.raw('ALTER TABLE project_template_status_mappings ALTER COLUMN status_source SET NOT NULL');
  }
}

async function ensureForeignKeys(knex) {
  for (const fk of FKS) {
    const existing = await knex.raw(
      `SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = 'project_template_status_mappings'::regclass`,
      [fk.name]
    );
    if (existing.rows?.length) continue;
    await knex.raw(
      `ALTER TABLE project_template_status_mappings ADD CONSTRAINT "${fk.name}" ${fk.sql}`
    );
  }
}

async function ensureIndexes(knex) {
  for (const [name, columns] of INDEXES) {
    const existing = await knex.raw(
      `SELECT 1 FROM pg_indexes WHERE indexname = ? AND tablename = 'project_template_status_mappings'`,
      [name]
    );
    if (existing.rows?.length) continue;
    await knex.raw(
      `CREATE INDEX "${name}" ON project_template_status_mappings (${columns.join(', ')})`
    );
  }
}

exports.config = { transaction: false };

exports.up = async function up(knex) {
  const onCitus = await knex.raw(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled"
  );
  if (onCitus.rows?.[0]?.enabled) {
    await knex.raw("SET citus.multi_shard_modify_mode TO 'sequential'");
  }

  if (!(await knex.schema.hasTable('project_template_status_mappings'))) {
    return;
  }

  await ensureColumns(knex);

  // Backfill is transactional so an interruption mid-way cannot leave a
  // partially typed table behind.
  await knex.transaction(async (trx) => {
    const counts = await backfillStatusSources(trx);
    console.log('[type_template_status_mappings] backfill counts:', JSON.stringify(counts));

    const unresolvedRemaining = await trx('project_template_status_mappings')
      .where('status_source', 'unresolved')
      .count('* as count')
      .first();
    console.log(
      '[type_template_status_mappings] unresolved rows:',
      Number(unresolvedRemaining?.count ?? 0)
    );
  });

  await ensureCheckConstraints(knex);
  await ensureForeignKeys(knex);
  await ensureIndexes(knex);
};

exports.down = async function down(knex) {
  // Loss-aware collapse: move every typed or unresolved UUID back into
  // status_id before dropping the typed columns so no evidence is discarded.
  await knex.raw(`
    UPDATE project_template_status_mappings
    SET status_id = COALESCE(status_id, standard_status_id, unresolved_status_id)
    WHERE standard_status_id IS NOT NULL OR unresolved_status_id IS NOT NULL
  `);

  for (const fk of FKS) {
    await knex.raw(
      `ALTER TABLE project_template_status_mappings DROP CONSTRAINT IF EXISTS "${fk.name}"`
    );
  }
  for (const constraint of CHECK_CONSTRAINTS) {
    await knex.raw(
      `ALTER TABLE project_template_status_mappings DROP CONSTRAINT IF EXISTS "${constraint.name}"`
    );
  }
  for (const [name] of INDEXES) {
    await knex.raw(`DROP INDEX IF EXISTS "${name}"`);
  }

  for (const column of COLUMNS) {
    if (await knex.schema.hasColumn('project_template_status_mappings', column)) {
      await knex.schema.alterTable('project_template_status_mappings', (table) => {
        table.dropColumn(column);
      });
    }
  }
};
