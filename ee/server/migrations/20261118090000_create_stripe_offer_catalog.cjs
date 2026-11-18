/**
 * Shared Stripe offer catalog (alga-2026-0003362).
 *
 * PLATFORM tables, not tenant data: no `tenant` column, never distributed on `tenant`. On Citus
 * they are reference tables (same treatment as stripe_customer_bindings). EE migration only: CE
 * never receives the catalog, the operator path or the fulfillment ledger (F015).
 *
 *  - stripe_offer_versions: every Price an offer has ever been sold at. A row is never deleted
 *    (renewals on retired prices must keep classifying). UNIQUE (account, mode, price_id) makes
 *    the reverse lookup Price -> offer unambiguous; the partial unique index allows exactly one
 *    current version per (account, mode, offer_key, interval).
 *  - stripe_offer_publications: append-only audit of every change of the current version.
 *  - co_managed_portal_purchases / co_managed_fulfillments: the platform half of appliance
 *    fulfillment (checkout -> entitlement association, and the delivery outbox to the issuer).
 *
 * Amount, currency and interval are NOT stored as authority; Stripe is re-read at review time.
 */
const VERSIONS = 'stripe_offer_versions';
const PUBLICATIONS = 'stripe_offer_publications';
const PURCHASES = 'co_managed_portal_purchases';
const FULFILLMENTS = 'co_managed_fulfillments';

async function makeReference(knex, table) {
  const hasFn = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_reference_table') AS present`);
  if (!hasFn.rows?.[0]?.present) return;
  const dist = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS present`, [table]);
  if (!dist.rows?.[0]?.present) await knex.raw(`SELECT create_reference_table('${table}')`);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(VERSIONS))) {
    await knex.schema.createTable(VERSIONS, (t) => {
      t.uuid('version_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.text('stripe_account').notNullable();
      t.boolean('livemode').notNullable();
      t.text('offer_key').notNullable();
      t.text('billing_interval').notNullable();
      t.integer('version_number').notNullable();
      t.text('price_id').notNullable();
      t.text('product_id').notNullable();
      t.boolean('is_current').notNullable().defaultTo(false);
      t.text('published_by').notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('retired_at', { useTz: true });
      t.unique(['stripe_account', 'livemode', 'price_id'], { indexName: 'stripe_offer_versions_price_uq' });
      t.unique(['stripe_account', 'livemode', 'offer_key', 'billing_interval', 'version_number'], { indexName: 'stripe_offer_versions_number_uq' });
    });
    await knex.raw(`CREATE UNIQUE INDEX stripe_offer_versions_one_current_uq
      ON ${VERSIONS} (stripe_account, livemode, offer_key, billing_interval) WHERE is_current`);
    await knex.raw(`ALTER TABLE ${VERSIONS} ADD CONSTRAINT stripe_offer_versions_interval_chk
      CHECK (billing_interval IN ('day','week','month','year'))`);
  }
  if (!(await knex.schema.hasTable(PUBLICATIONS))) {
    await knex.schema.createTable(PUBLICATIONS, (t) => {
      t.uuid('publication_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.text('stripe_account').notNullable();
      t.boolean('livemode').notNullable();
      t.text('offer_key').notNullable();
      t.text('billing_interval').notNullable();
      t.text('action').notNullable(); // seed | publish | restore
      t.uuid('from_version_id');
      t.uuid('to_version_id').notNullable();
      t.text('actor').notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['stripe_account', 'livemode', 'offer_key', 'billing_interval', 'created_at'], 'stripe_offer_publications_identity_idx');
    });
  }
  if (!(await knex.schema.hasTable(PURCHASES))) {
    await knex.schema.createTable(PURCHASES, (t) => {
      t.uuid('purchase_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.text('stripe_account').notNullable();
      t.boolean('livemode').notNullable();
      t.text('entitlement_id').notNullable(); // the licensing service's entitlement (its stripe_sub_id)
      t.text('license_tenant_id').notNullable();
      t.text('offer_key').notNullable();
      t.text('billing_interval').notNullable();
      t.uuid('offer_version_id').notNullable();
      t.text('price_id').notNullable();
      t.integer('quantity').notNullable();
      t.text('checkout_session_id').notNullable().unique();
      t.text('stripe_subscription_id').unique();
      t.text('state').notNullable().defaultTo('pending'); // pending | paid | closed
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['entitlement_id'], 'co_managed_portal_purchases_entitlement_idx');
    });
  }
  if (!(await knex.schema.hasTable(FULFILLMENTS))) {
    await knex.schema.createTable(FULFILLMENTS, (t) => {
      t.uuid('fulfillment_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('purchase_id').notNullable().references('purchase_id').inTable(PURCHASES);
      t.text('entitlement_id').notNullable();
      t.text('stripe_subscription_id').notNullable();
      t.bigInteger('sequence').notNullable();
      t.timestamp('paid_period_end', { useTz: true }).notNullable();
      t.integer('co_managed_seats').notNullable();
      t.text('idempotency_key').notNullable().unique();
      t.text('state').notNullable().defaultTo('pending'); // pending | delivered | superseded
      t.integer('attempts').notNullable().defaultTo(0);
      t.text('last_error');
      t.timestamp('delivered_at', { useTz: true });
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['entitlement_id', 'sequence'], { indexName: 'co_managed_fulfillments_sequence_uq' });
    });
  }
  for (const table of [VERSIONS, PUBLICATIONS, PURCHASES, FULFILLMENTS]) await makeReference(knex, table);
};

exports.down = async function down(knex) {
  for (const table of [FULFILLMENTS, PURCHASES, PUBLICATIONS, VERSIONS]) await knex.schema.dropTableIfExists(table);
};

exports.config = { transaction: false };
