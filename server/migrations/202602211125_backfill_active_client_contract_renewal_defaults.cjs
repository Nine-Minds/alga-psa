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

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch (error) {
    console.warn(`Unable to check column ${columnName} on ${tableName}:`, error);
    return false;
  }
};

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  const hasClientContractsTable = await knex.schema.hasTable('client_contracts');
  const hasContractsTable = await knex.schema.hasTable('contracts');
  if (!hasClientContractsTable || !hasContractsTable) {
    console.log('⊘ Skipping renewal backfill: required contracts tables are missing');
    return;
  }

  const [
    hasRenewalMode,
    hasNoticePeriodDays,
    hasUseTenantRenewalDefaults,
    hasDecisionDueDate,
    hasRenewalCycleStart,
    hasRenewalCycleEnd,
    hasRenewalCycleKey,
  ] = await Promise.all([
    hasColumn(knex, 'client_contracts', 'renewal_mode'),
    hasColumn(knex, 'client_contracts', 'notice_period_days'),
    hasColumn(knex, 'client_contracts', 'use_tenant_renewal_defaults'),
    hasColumn(knex, 'client_contracts', 'decision_due_date'),
    hasColumn(knex, 'client_contracts', 'renewal_cycle_start'),
    hasColumn(knex, 'client_contracts', 'renewal_cycle_end'),
    hasColumn(knex, 'client_contracts', 'renewal_cycle_key'),
  ]);

  if (
    !hasRenewalMode ||
    !hasNoticePeriodDays ||
    !hasUseTenantRenewalDefaults ||
    !hasDecisionDueDate ||
    !hasRenewalCycleStart ||
    !hasRenewalCycleEnd ||
    !hasRenewalCycleKey
  ) {
    console.log('⊘ Skipping renewal backfill: required renewal columns are missing');
    return;
  }

  const result = await knex.raw(`
    WITH updated AS (
      UPDATE client_contracts cc
      SET
        renewal_mode = COALESCE(cc.renewal_mode, 'manual'),
        notice_period_days = COALESCE(cc.notice_period_days, 30),
        use_tenant_renewal_defaults = COALESCE(cc.use_tenant_renewal_defaults, true),
        decision_due_date = COALESCE(
          cc.decision_due_date,
          CASE
            WHEN COALESCE(cc.renewal_mode, 'manual') = 'none' THEN NULL
            ELSE (
              cc.end_date::date - (COALESCE(cc.notice_period_days, 30) * INTERVAL '1 day')
            )::date
          END
        ),
        renewal_cycle_start = COALESCE(cc.renewal_cycle_start, cc.start_date::date),
        renewal_cycle_end = COALESCE(cc.renewal_cycle_end, cc.end_date::date),
        renewal_cycle_key = COALESCE(cc.renewal_cycle_key, CONCAT('fixed-term:', cc.end_date::date::text)),
        updated_at = NOW()
      FROM contracts c
      WHERE cc.tenant = c.tenant
        AND cc.contract_id = c.contract_id
        AND cc.is_active = true
        AND c.status = 'active'
        AND cc.end_date IS NOT NULL
        AND (
          cc.renewal_mode IS NULL
          OR cc.notice_period_days IS NULL
          OR cc.use_tenant_renewal_defaults IS NULL
          OR cc.decision_due_date IS NULL
          OR cc.renewal_cycle_start IS NULL
          OR cc.renewal_cycle_end IS NULL
          OR cc.renewal_cycle_key IS NULL
        )
      RETURNING cc.client_contract_id
    )
    SELECT COUNT(*)::int AS updated_count FROM updated;
  `);

  const updatedCount = Number(result?.rows?.[0]?.updated_count ?? 0);
  console.log(`✓ Backfilled renewal defaults/cycle fields for ${updatedCount} active fixed-term client_contracts rows`);
};

exports.down = async function down() {
  console.log('⊘ Renewal defaults backfill is data-only and intentionally non-reversible');
};

exports.config = { transaction: false };
