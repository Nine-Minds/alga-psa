/**
 * Normalize the retired Premium tier before application types stop accepting it.
 *
 * Existing Premium tenants keep their access through Pro. Premium-trial state is
 * removed from local subscription metadata. Only a schedule carrying the full
 * confirmation tuple is marked as the retired Pro-to-Premium transition;
 * ordinary seat and interval schedules remain intact.
 *
 * @param {unknown} value
 * @returns {{ metadata: Record<string, unknown>, changed: boolean }}
 */
function normalizePremiumTrialMetadata(value) {
  let metadata = value;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = {};
    }
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    metadata = {};
  }

  const normalized = { ...metadata };
  const premiumTrialKeys = [
    'premium_trial',
    'premium_trial_started',
    'premium_trial_end',
    'premium_trial_confirmed',
    'premium_trial_effective_date',
    'premium_trial_reverted',
  ];
  const changed = premiumTrialKeys.some((key) =>
    Object.prototype.hasOwnProperty.call(normalized, key),
  );
  const confirmedPremiumTrialSchedule =
    normalized.premium_trial === 'confirmed' &&
    typeof normalized.premium_trial_confirmed === 'string' &&
    normalized.premium_trial_confirmed.length > 0 &&
    typeof normalized.premium_trial_effective_date === 'string' &&
    normalized.premium_trial_effective_date.length > 0 &&
    typeof normalized.schedule_id === 'string' &&
    normalized.schedule_id.length > 0;

  for (const key of premiumTrialKeys) {
    delete normalized[key];
  }
  if (confirmedPremiumTrialSchedule) {
    normalized.retired_premium_schedule_id = normalized.schedule_id;
    normalized.retired_premium_schedule_source = 'confirmed_premium_trial';
    delete normalized.schedule_id;
  }

  return { metadata: normalized, changed };
}

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex('tenants').where({ plan: 'premium' }).update({ plan: 'pro' });

  if (!(await knex.schema.hasTable('stripe_subscriptions'))) {
    return;
  }

  const subscriptions = await knex('stripe_subscriptions')
    .whereNotNull('metadata')
    .select('tenant', 'stripe_subscription_id', 'metadata');

  for (const subscription of subscriptions) {
    const { metadata, changed } = normalizePremiumTrialMetadata(
      subscription.metadata,
    );
    if (!changed) continue;

    await knex('stripe_subscriptions')
      .where({
        tenant: subscription.tenant,
        stripe_subscription_id: subscription.stripe_subscription_id,
      })
      .update({ metadata: JSON.stringify(metadata) });
  }
};

/**
 * The original Premium distinction and trial state cannot be reconstructed.
 *
 * @param {import('knex').Knex} _knex
 */
exports.down = async function down(_knex) {};

exports.normalizePremiumTrialMetadata = normalizePremiumTrialMetadata;
