const SETTINGS = 'stripe_offer_catalog_settings';
const AUDIT = 'stripe_offer_catalog_setting_audit';
const BATCH_SIZE = 1000;

async function reference(knex, table) {
  const fn = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_reference_table') AS present`);
  if (!fn.rows?.[0]?.present) return;
  const dist = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS present`, [table]);
  if (!dist.rows?.[0]?.present) await knex.raw(`SELECT create_reference_table('${table}')`);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(SETTINGS))) {
    await knex.schema.createTable(SETTINGS, (t) => {
      t.boolean('livemode').primary();
      t.text('stripe_account').notNullable();
      t.text('price_id').notNullable();
      t.text('updated_by').notNullable();
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasTable(AUDIT))) {
    await knex.schema.createTable(AUDIT, (t) => {
      t.uuid('change_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.boolean('livemode').notNullable();
      t.text('operator').notNullable();
      t.text('previous_account');
      t.text('previous_price_id');
      t.text('new_account').notNullable();
      t.text('new_price_id').notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }
  for (const table of [SETTINGS, AUDIT]) await reference(knex, table);

  // Account identity is pinned on both a checkout intent and its canonical subscription record.
  for (const table of ['co_managed_purchase_operations', 'stripe_subscriptions']) {
    if (!(await knex.schema.hasTable(table))) continue;
    for (const [column, type] of [['stripe_account', 'text'], ['livemode', 'boolean']]) {
      if (!(await knex.schema.hasColumn(table, column))) {
        await knex.schema.alterTable(table, (t) => { (type === 'text' ? t.text(column) : t.boolean(column)).nullable(); });
      }
    }
  }
  if (await knex.schema.hasTable('co_managed_purchase_operations') && await knex.schema.hasTable('stripe_offer_versions')) {
    const tenants = await knex('co_managed_purchase_operations')
      .whereNull('stripe_account').whereNull('livemode').distinct('tenant').pluck('tenant');
    // Pin each batch to one tenant shard. With Knex's migration transaction disabled,
    // each statement commits separately and a retry skips rows already pinned.
    for (const tenant of tenants) {
      for (;;) {
        // A price ID is safe only when the historical catalog assigns it to exactly
        // one merchant and mode. The catalog's unique scope/price key makes a
        // second matching version evidence of ambiguity. An explicit version wins.
        const result = await knex.raw(`WITH batch AS (
          SELECT o.operation_id,
            COALESCE(v.stripe_account, p.stripe_account) AS stripe_account,
            COALESCE(v.livemode, p.livemode) AS livemode
          FROM co_managed_purchase_operations o
          LEFT JOIN stripe_offer_versions v ON o.offer_version_id = v.version_id
          LEFT JOIN stripe_offer_versions p ON v.version_id IS NULL AND o.price_id = p.price_id
            AND p.offer_key = 'co_managed_technician_seat' AND p.billing_interval = 'month'
            AND NOT EXISTS (
              SELECT 1 FROM stripe_offer_versions other
              WHERE other.price_id = p.price_id AND other.offer_key = p.offer_key
                AND other.billing_interval = p.billing_interval AND other.version_id <> p.version_id
            )
          WHERE o.tenant = ? AND o.stripe_account IS NULL AND o.livemode IS NULL
            AND (v.version_id IS NOT NULL OR p.price_id IS NOT NULL)
          ORDER BY o.operation_id
          LIMIT ?
          FOR UPDATE OF o
        )
        UPDATE co_managed_purchase_operations o
        SET stripe_account = batch.stripe_account, livemode = batch.livemode
        FROM batch
        WHERE o.tenant = ? AND o.operation_id = batch.operation_id
          AND o.stripe_account IS NULL AND o.livemode IS NULL`, [tenant, BATCH_SIZE, tenant]);
        if (result.rowCount < BATCH_SIZE) break;
      }
    }
  }
  // Existing stripe_subscriptions rows without historical account evidence deliberately stay null.
  // Runtime reconciliation resolves them from historical Price mappings or fails closed.
};

exports.down = async function down(knex) {
  for (const table of ['stripe_subscriptions', 'co_managed_purchase_operations']) {
    if (!(await knex.schema.hasTable(table))) continue;
    for (const column of ['stripe_account', 'livemode']) if (await knex.schema.hasColumn(table, column)) {
      await knex.schema.alterTable(table, (t) => t.dropColumn(column));
    }
  }
  await knex.schema.dropTableIfExists(AUDIT);
  await knex.schema.dropTableIfExists(SETTINGS);
};

exports.config = { transaction: false };
