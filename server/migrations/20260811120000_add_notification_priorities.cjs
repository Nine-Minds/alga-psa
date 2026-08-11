/**
 * Configurable notification priorities (task 29.8.46).
 *
 * Adds a three-layer priority configuration chain to the in-app
 * `internal_notification_*` system plus a stamped priority on each
 * notification instance:
 *
 *   1. internal_notification_subtypes.default_priority (system default)
 *   2. tenant_internal_notification_subtype_settings.priority (tenant override)
 *   3. user_internal_notification_preferences.priority (per-user override)
 *   4. internal_notifications.priority (resolved value stamped at creation)
 *
 * All four are CHECK-constrained text columns (high|normal|low) — matching the
 * tenant-settings migration style and avoiding enum-alteration friction later.
 *
 * Column adds propagate automatically on Citus (ALTER TABLE ... ADD COLUMN),
 * so no explicit distribution work is needed here; the backfill is written as
 * a set of `WHERE template_name IN (...)` multi-shard updates rather than a
 * cross-table distributed join so it is safe on both Citus and plain Postgres.
 */

const PRIORITY_CHECK = "IN ('high','normal','low')";

// Exact High/Low subtype lists from the plan
// (docs/plans/2026-08-11-notification-priorities-plan.md, §"Data model").
// Everything not listed keeps the column default 'normal'.
//
// NOTE: the plan lists `rmm-alert-triggered`, but the live subtype is named
// `RMM Alert Triggered`; both spellings are included so the plan's intent is
// realized regardless of which name a given database carries. Names that do
// not resolve (e.g. `project-budget-exceeded`, not yet seeded) are harmless
// no-ops.
const HIGH_SUBTYPES = [
  'sla-breach',
  'sla-escalation',
  'rmm-alert-triggered',
  'RMM Alert Triggered',
  'payment-overdue',
  'system-announcement',
  'project-budget-exceeded',
];

const LOW_SUBTYPES = [
  'opportunity-weekly-digest',
  'milestone-completed',
  'sla-response-met',
  'sla-resolution-met',
];

async function addPriorityColumn(knex, table, column, { notNull }) {
  const nullClause = notNull ? "NOT NULL DEFAULT 'normal'" : 'NULL';
  await knex.raw(
    `ALTER TABLE ?? ADD COLUMN IF NOT EXISTS ?? text ${nullClause} ` +
    `CHECK (?? ${PRIORITY_CHECK})`,
    [table, column, column]
  );
}

async function dropPriorityColumn(knex, table, column) {
  await knex.raw('ALTER TABLE ?? DROP COLUMN IF EXISTS ??', [table, column]);
}

exports.up = async function up(knex) {
  console.log('Adding notification priority columns...');

  // 1. System default per subtype.
  await addPriorityColumn(knex, 'internal_notification_subtypes', 'default_priority', { notNull: true });
  // 2. Tenant override (NULL = inherit default).
  await addPriorityColumn(knex, 'tenant_internal_notification_subtype_settings', 'priority', { notNull: false });
  // 3. Per-user override (NULL = inherit tenant/default; meaningful on subtype rows only).
  await addPriorityColumn(knex, 'user_internal_notification_preferences', 'priority', { notNull: false });
  // 4. Stamped priority on the distributed instance table.
  await addPriorityColumn(knex, 'internal_notifications', 'priority', { notNull: true });
  console.log('  ✓ Added priority columns');

  // 5. Seed subtype system defaults (everything else stays 'normal').
  const highUpdated = await knex('internal_notification_subtypes')
    .whereIn('name', HIGH_SUBTYPES)
    .update({ default_priority: 'high', updated_at: knex.fn.now() });
  const lowUpdated = await knex('internal_notification_subtypes')
    .whereIn('name', LOW_SUBTYPES)
    .update({ default_priority: 'low', updated_at: knex.fn.now() });
  console.log(`  ✓ Seeded subtype defaults (high: ${highUpdated}, low: ${lowUpdated})`);

  // 6. Backfill existing instance rows from their subtype default via the
  //    template-name join. Computed on the coordinator (templates + subtypes
  //    are small catalog tables), then applied as multi-shard IN-list updates
  //    so it works identically on Citus and plain Postgres. Rows whose
  //    template name no longer resolves keep the column default 'normal'.
  const templatePriorities = await knex('internal_notification_templates as t')
    .join('internal_notification_subtypes as s', 't.subtype_id', 's.internal_notification_subtype_id')
    .whereIn('s.default_priority', ['high', 'low'])
    .distinct('t.name as template_name', 's.default_priority as priority');

  const namesByPriority = { high: [], low: [] };
  for (const row of templatePriorities) {
    if (namesByPriority[row.priority]) {
      namesByPriority[row.priority].push(row.template_name);
    }
  }

  let backfilled = 0;
  for (const priority of ['high', 'low']) {
    const names = namesByPriority[priority];
    if (names.length === 0) continue;
    // Batch to keep the IN-list bounded on very large template catalogs.
    for (let i = 0; i < names.length; i += 100) {
      const batch = names.slice(i, i + 100);
      backfilled += await knex('internal_notifications')
        .whereIn('template_name', batch)
        .update({ priority, updated_at: knex.fn.now() });
    }
  }
  console.log(`  ✓ Backfilled ${backfilled} existing notification rows`);

  console.log('Notification priority migration completed.');
};

exports.down = async function down(knex) {
  console.log('Reverting notification priority columns...');
  await dropPriorityColumn(knex, 'internal_notifications', 'priority');
  await dropPriorityColumn(knex, 'user_internal_notification_preferences', 'priority');
  await dropPriorityColumn(knex, 'tenant_internal_notification_subtype_settings', 'priority');
  await dropPriorityColumn(knex, 'internal_notification_subtypes', 'default_priority');
  console.log('  ✓ Dropped priority columns');
};
