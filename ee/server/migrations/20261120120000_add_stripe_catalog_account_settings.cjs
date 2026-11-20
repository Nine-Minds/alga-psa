const SETTINGS = 'stripe_offer_catalog_settings';
const AUDIT = 'stripe_offer_catalog_setting_audit';

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
    await knex.raw(`UPDATE co_managed_purchase_operations o SET stripe_account = v.stripe_account, livemode = v.livemode
      FROM stripe_offer_versions v WHERE o.offer_version_id = v.version_id AND o.stripe_account IS NULL AND o.livemode IS NULL`);
    // A price ID is a safe migration key only when the historical catalog assigns it to exactly
    // one merchant and mode. Pending operations with no such evidence remain pinned-null and are
    // explicitly reconciled on resume; never guess from today's environment or database setting.
    await knex.raw(`WITH unique_price_scope AS (
      SELECT price_id, MIN(stripe_account) AS stripe_account, BOOL_AND(livemode) AS livemode
      FROM stripe_offer_versions WHERE offer_key = 'co_managed_technician_seat' AND billing_interval = 'month' GROUP BY price_id
      HAVING COUNT(DISTINCT (stripe_account, livemode)) = 1
    )
    UPDATE co_managed_purchase_operations o SET stripe_account = v.stripe_account, livemode = v.livemode
    FROM unique_price_scope v WHERE o.price_id = v.price_id AND o.stripe_account IS NULL AND o.livemode IS NULL`);
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
