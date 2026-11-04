const { canCreateDistributedTable, isDistributed } = require('./utils/citusDistribution.cjs');

const TABLE = 'rmm_webhook_events';

/**
 * 1. rmm_webhook_events: durable idempotency ledger for RMM webhook deliveries
 *    that carry a provider event id (Level keeps `event_id` constant across its
 *    retries). The route claims (tenant, provider, event_id) with
 *    INSERT ... ON CONFLICT DO NOTHING before processing; a conflict means the
 *    delivery was already handled. Keyed on event_id rather than
 *    (alert id, transition) because an alert has exactly one active and one
 *    resolved event, and a late-retried `alert_active` after `alert_resolved`
 *    must not reopen the alert - the alert row alone cannot tell it apart.
 *
 * 2. Level automations copied from the old settings template sent the literal
 *    text `{{alert_id}}`, so every alert collapsed into one rmm_alerts row with
 *    that external_alert_id. The route now treats unrendered `{{...}}` values
 *    as absent and never matches those rows again; this closes the ones still
 *    open so they stop showing as live alerts. Tickets are not touched.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      tenant uuid NOT NULL,
      provider varchar(50) NOT NULL,
      event_id varchar(255) NOT NULL,
      event_type varchar(100) NULL,
      received_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ${TABLE}_pkey PRIMARY KEY (tenant, provider, event_id)
    )
  `);
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_${TABLE}_received ON ${TABLE} (tenant, received_at)`
  );

  if ((await canCreateDistributedTable(knex)) && !(await isDistributed(knex, TABLE))) {
    if (await isDistributed(knex, 'rmm_alerts')) {
      await knex.raw(`SELECT create_distributed_table('${TABLE}', 'tenant', colocate_with => 'rmm_alerts')`);
    }
  }

  // tenant is in the join and the SET, so the update is shard-local on Citus.
  // migration-lint: allow 5 - retroactive: UPDATE is scoped to Level.io placeholder alerts only (tenant-joined, shard-local on Citus); merged before the lint existed
  await knex.raw(`
    UPDATE rmm_alerts AS a
    SET status = 'auto_resolved',
        resolved_at = COALESCE(a.resolved_at, now()),
        updated_at = now()
    FROM rmm_integrations AS i
    WHERE i.tenant = a.tenant
      AND i.integration_id = a.integration_id
      AND i.provider = 'levelio'
      AND a.external_alert_id LIKE '{{%}}'
      AND a.status IN ('active', 'acknowledged', 'suppressed')
  `);
};

exports.down = async function down(knex) {
  // The placeholder-row cleanup is not reversible (no record of prior status).
  await knex.raw(`DROP TABLE IF EXISTS ${TABLE}`);
};
