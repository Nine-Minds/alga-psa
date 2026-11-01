'use strict';

/**
 * Failing-renewal-payment context from the alga-license /check-in response,
 * stored next to the other subscription_* columns on the license_state singleton
 * so the banner and License page can tell an admin the payment failed while
 * Stripe is retrying, and explain a payment-failure end afterwards.
 *
 * subscription_next_retry_at        — Stripe's next retry (payment_failed only; null = none scheduled)
 * subscription_update_payment_url  — where to update the payment method (payment_failed only)
 * subscription_end_reason          — 'payment_failed' when a cancelled end followed failed payments
 *
 * All nullable: older alga-license servers send none of it, and a healthy
 * subscription stores nothing (the next 'active' check-in clears all three).
 * license_state is an unsharded admin singleton, like the earlier license_state
 * migrations — no Citus distribution handling.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('license_state', (table) => {
    table.timestamp('subscription_next_retry_at', { useTz: true }).nullable();
    table.text('subscription_update_payment_url').nullable();
    table.text('subscription_end_reason').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('license_state', (table) => {
    table.dropColumn('subscription_next_retry_at');
    table.dropColumn('subscription_update_payment_url');
    table.dropColumn('subscription_end_reason');
  });
};
