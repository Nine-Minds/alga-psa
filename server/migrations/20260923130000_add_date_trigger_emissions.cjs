'use strict';

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

// clients.client_since itself comes from 20260923120000_add_client_since_to_clients.
exports.up = async function up(knex) {
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_clients_tenant_client_since ON clients (tenant, client_since)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_assets_tenant_warranty_end_date ON assets (tenant, warranty_end_date)');
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS date_trigger_emissions (
      tenant uuid NOT NULL REFERENCES tenants(tenant),
      dedupe_key text NOT NULL,
      event_type text NOT NULL,
      entity_id uuid NOT NULL,
      occurs_on date NOT NULL,
      emitted_at timestamptz NOT NULL DEFAULT '2026-09-23T00:00:00.000Z',
      PRIMARY KEY (tenant, dedupe_key)
    )
  `);
  await ensureTenantDistribution(knex, 'date_trigger_emissions');
  // Match the scan's local-calendar event keys for records already inside a domain-event window.
  // Series-based date generation avoids year-end BETWEEN errors and uses the same clamped Feb 29 rule.
  await knex.raw(`
    WITH tenant_today AS (
      SELECT t.tenant,
        (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(ts.settings->>'timezone', 'UTC'))::date AS today,
        COALESCE(ts.settings->>'timezone', 'UTC') AS timezone
      FROM tenants t LEFT JOIN tenant_settings ts ON ts.tenant = t.tenant
    ),
    anniversary_occurrences AS (
      SELECT c.tenant, c.client_id AS entity_id, d::date AS occurs_on, d::date AS cycle_key
      FROM clients c JOIN tenant_today tt ON tt.tenant = c.tenant
      CROSS JOIN LATERAL generate_series(tt.today, tt.today + 30, interval '1 day') d
      CROSS JOIN LATERAL (SELECT COALESCE(c.client_since, (c.created_at AT TIME ZONE tt.timezone)::date) AS anchor) a
      WHERE c.is_inactive = false
        AND extract(year FROM d)::int - extract(year FROM a.anchor)::int >= 1
        AND (to_char(d::date, 'MM-DD') = to_char(a.anchor, 'MM-DD')
          OR (to_char(a.anchor, 'MM-DD') = '02-29' AND to_char(d::date, 'MM-DD') = '02-28'
            AND NOT (extract(year FROM d)::int % 4 = 0 AND (extract(year FROM d)::int % 100 <> 0 OR extract(year FROM d)::int % 400 = 0))))
    ),
    renewal_occurrences AS (
      SELECT cc.tenant, cc.client_contract_id AS entity_id, cc.decision_due_date AS occurs_on,
        COALESCE(cc.renewal_cycle_key, cc.decision_due_date::text) AS cycle_key
      FROM client_contracts cc JOIN tenant_today tt ON tt.tenant = cc.tenant
      WHERE cc.is_active = true AND cc.renewal_mode <> 'none' AND cc.decision_due_date BETWEEN tt.today AND tt.today + 90
    ),
    warranty_occurrences AS (
      SELECT a.tenant, a.asset_id AS entity_id, warranty.occurs_on, warranty.occurs_on::text AS cycle_key
      FROM assets a JOIN tenant_today tt ON tt.tenant = a.tenant
      CROSS JOIN LATERAL (SELECT (a.warranty_end_date AT TIME ZONE tt.timezone)::date AS occurs_on) warranty
      WHERE warranty.occurs_on BETWEEN tt.today AND tt.today + 30 AND a.status NOT IN ('retired', 'disposed')
    ),
    eligible AS (
      SELECT tenant, 'CLIENT_ANNIVERSARY_UPCOMING'::text AS event_type, entity_id, occurs_on, cycle_key::text AS cycle_key FROM anniversary_occurrences
      UNION ALL
      SELECT tenant, 'CONTRACT_RENEWAL_UPCOMING', entity_id, occurs_on, cycle_key FROM renewal_occurrences
      UNION ALL
      SELECT tenant, 'ASSET_WARRANTY_EXPIRING', entity_id, occurs_on, cycle_key FROM warranty_occurrences
    )
    INSERT INTO date_trigger_emissions (tenant, dedupe_key, event_type, entity_id, occurs_on, emitted_at)
    SELECT tenant, 'event:' || event_type || ':' || entity_id::text || ':' || cycle_key,
      event_type, entity_id, occurs_on, '2026-09-23T00:00:00.000Z'::timestamptz
    FROM eligible ON CONFLICT (tenant, dedupe_key) DO NOTHING
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('date_trigger_emissions');
  await knex.raw('DROP INDEX IF EXISTS idx_assets_tenant_warranty_end_date');
  await knex.raw('DROP INDEX IF EXISTS idx_clients_tenant_client_since');
};
