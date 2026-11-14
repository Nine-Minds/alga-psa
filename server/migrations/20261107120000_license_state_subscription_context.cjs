'use strict';

/**
 * Subscription context from the alga-license /check-in response, stored on the
 * license_state singleton so the License page and the app-wide banner can warn
 * before a Pro subscription lapses and explain the downgrade afterwards.
 *
 * subscription_state               — 'cancel_scheduled' | 'term_ends' | 'cancelled' (null = none known or healthy)
 * subscription_cancels_at          — when the subscription ends/ended, if the server knows (for cancel_scheduled
 *                                    this is the mirrored Stripe cancel_at / current_period_end)
 * subscription_resubscribe_url     — where to resubscribe
 * subscription_context_updated_at  — when the context was last written by a check-in
 *
 * All nullable: legacy servers send none of it, and a healthy subscription
 * stores nothing (the next 'ok' check-in clears it on reactivation).
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE license_state
      ADD COLUMN IF NOT EXISTS subscription_state text,
      ADD COLUMN IF NOT EXISTS subscription_cancels_at timestamptz,
      ADD COLUMN IF NOT EXISTS subscription_resubscribe_url text,
      ADD COLUMN IF NOT EXISTS subscription_context_updated_at timestamptz
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE license_state
      DROP COLUMN IF EXISTS subscription_state,
      DROP COLUMN IF EXISTS subscription_cancels_at,
      DROP COLUMN IF EXISTS subscription_resubscribe_url,
      DROP COLUMN IF EXISTS subscription_context_updated_at
  `);
};
