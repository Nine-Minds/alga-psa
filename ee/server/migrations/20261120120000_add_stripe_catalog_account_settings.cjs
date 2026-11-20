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
      FROM stripe_offer_versions v WHERE o.offer_version_id = v.version_id AND (o.stripe_account IS NULL OR o.livemode IS NULL)`);
    const account = process.env.STRIPE_ACCOUNT_ID;
    const key = process.env.STRIPE_SECRET_KEY || '';
    const livemode = /^(sk|rk)_live_/.test(key) ? true : /^(sk|rk)_test_/.test(key) ? false : null;
    if (account && livemode !== null) {
      await knex('co_managed_purchase_operations').whereNull('stripe_account').update({ stripe_account: account, livemode });
    }
  }
  const bootstrapAccount = process.env.STRIPE_ACCOUNT_ID;
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  const bootstrapMode = /^(sk|rk)_live_/.test(stripeKey) ? true : /^(sk|rk)_test_/.test(stripeKey) ? false : null;
  if (bootstrapAccount && bootstrapMode !== null && await knex.schema.hasTable('stripe_subscriptions')) {
    await knex('stripe_subscriptions').whereNull('stripe_account').update({ stripe_account: bootstrapAccount, livemode: bootstrapMode });
  }
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
