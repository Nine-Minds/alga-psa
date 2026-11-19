exports.up = async function (knex) {
  await knex.raw('ALTER TABLE co_managed_seat_trials ADD COLUMN IF NOT EXISTS conversion_quote jsonb');
  await knex.raw('ALTER TABLE stripe_subscriptions ADD COLUMN IF NOT EXISTS cancel_at timestamptz');
  await knex.raw('ALTER TABLE stripe_subscriptions ADD COLUMN IF NOT EXISTS trial_end timestamptz');
  await knex.raw(`CREATE OR REPLACE VIEW co_managed_trial_funding AS
    SELECT tenant, allocation_id FROM co_managed_allocations WHERE funding_source = 'seat_trial'
    UNION SELECT tenant, allocation_id FROM co_managed_seat_trials WHERE state <> 'paid'`);
  // Match the canonical base license selection: a paid subscription takes precedence over a
  // remaining trial row. Legacy trial mirrors stored the trial cutoff in current_period_end.
  await knex.raw(`CREATE OR REPLACE VIEW co_managed_trial_sponsors AS
    SELECT DISTINCT ON (s.tenant) s.tenant,
      least(s.current_period_end, s.cancel_at, CASE WHEN s.status = 'trialing' THEN s.trial_end END) AS base_until,
      s.status::text
    FROM stripe_subscriptions s JOIN tenants t ON t.tenant = s.tenant
    WHERE t.product_code = 'psa' AND t.plan = 'pro' AND t.suspended_at IS NULL
      AND t.billing_source IS DISTINCT FROM 'manual' AND NOT EXISTS (SELECT 1 FROM license_state)
      AND NOT EXISTS (SELECT 1 FROM co_managed_entitlements e WHERE e.tenant = s.tenant AND e.source <> 'hosted')
      AND s.status IN ('active','trialing') AND s.current_period_end IS NOT NULL
      AND coalesce(s.metadata->>'addon_key','') = ''
      AND coalesce(s.metadata->>'subscription_kind','') <> 'co_managed'
    ORDER BY s.tenant, (s.status = 'active') DESC, s.created_at DESC, s.stripe_subscription_id`);
  await knex.raw(`CREATE OR REPLACE VIEW co_managed_trial_access AS
    SELECT p.tenant, p.allocation_id, p.assignment_id
    FROM co_managed_seat_trials p JOIN co_managed_trial_sponsors s ON s.tenant = p.tenant
    JOIN co_managed_allocations f ON f.tenant = p.tenant AND f.allocation_id = p.allocation_id
    JOIN co_managed_seat_arrangements r ON r.tenant = p.tenant AND r.arrangement_id = p.arrangement_id AND r.allocation_id = f.allocation_id
    JOIN co_managed_seat_assignments a ON a.tenant = p.tenant AND a.assignment_id = p.assignment_id AND a.arrangement_id = r.arrangement_id
    WHERE f.funding_source = 'seat_trial' AND f.state = 'active' AND r.state = 'active' AND a.state = 'active'
      AND p.state = 'active' AND p.deadline_at > statement_timestamp()
      AND s.base_until > statement_timestamp()`);
};

exports.down = async function (knex) {
  if (await knex('co_managed_allocations').where('funding_source', 'seat_trial').first()) {
    throw new Error('Trial-funded allocations require the hosted admission views');
  }
  await knex.raw(`CREATE OR REPLACE VIEW co_managed_trial_funding AS
    SELECT tenant, allocation_id FROM co_managed_allocations WHERE funding_source = 'seat_trial'`);
  await knex.raw(`CREATE OR REPLACE VIEW co_managed_trial_access AS SELECT NULL::uuid AS tenant,
    NULL::uuid AS allocation_id, NULL::uuid AS assignment_id WHERE false`);
  await knex.raw(`CREATE OR REPLACE VIEW co_managed_trial_sponsors AS SELECT NULL::uuid AS tenant,
    NULL::timestamptz AS base_until, NULL::text AS status WHERE false`);
  await knex.schema.alterTable('co_managed_seat_trials', table => table.dropColumn('conversion_quote'));
  await knex.schema.alterTable('stripe_subscriptions', table => table.dropColumn('trial_end'));
};
