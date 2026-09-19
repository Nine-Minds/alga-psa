/**
 * Create tenant-scoped login domain mappings for MSP SSO discovery.
 *
 * - Multiple domains per tenant.
 * - Case-insensitive domain normalization via lower(domain) indexes.
 * - Cross-tenant duplicates are allowed so discovery can fail-closed on ambiguity.
 * - Optional backfill from tenants.email domain only when unambiguous globally.
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('msp_sso_tenant_login_domains');
  if (!hasTable) {
    await knex.schema.createTable('msp_sso_tenant_login_domains', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('domain').notNullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.uuid('created_by');
      table.uuid('updated_by');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'id']);
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
    });
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS msp_sso_tenant_login_domains_tenant_domain_uniq
    ON msp_sso_tenant_login_domains (tenant, lower(domain));
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS msp_sso_tenant_login_domains_domain_active_idx
    ON msp_sso_tenant_login_domains (lower(domain))
    WHERE is_active = true;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS msp_sso_tenant_login_domains_tenant_active_idx
    ON msp_sso_tenant_login_domains (tenant, is_active, domain);
  `);

  // Backfill from tenant primary email domain only when that domain maps to exactly one tenant.
  await knex.raw(`
    WITH candidate_domains AS (
      SELECT
        t.tenant,
        lower(split_part(trim(t.email), '@', 2)) AS domain
      FROM tenants t
      WHERE t.email IS NOT NULL
        AND position('@' in t.email) > 1
    ),
    normalized_domains AS (
      SELECT tenant, domain
      FROM candidate_domains
      WHERE domain <> ''
        AND domain !~ '[\\s@]'
        AND domain LIKE '%.%'
        AND domain !~ '^\\.'
        AND domain !~ '\\.$'
        AND domain !~ '\\.\\.'
    ),
    unambiguous_domains AS (
      SELECT domain
      FROM normalized_domains
      GROUP BY domain
      HAVING count(*) = 1
    )
    INSERT INTO msp_sso_tenant_login_domains (
      tenant,
      domain,
      is_active,
      created_at,
      updated_at
    )
    SELECT nd.tenant, nd.domain, true, now(), now()
    FROM normalized_domains nd
    INNER JOIN unambiguous_domains ud ON ud.domain = nd.domain
    ON CONFLICT DO NOTHING;
  `);

  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'msp_sso_tenant_login_domains'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw("SELECT create_distributed_table('msp_sso_tenant_login_domains', 'tenant')");
    }
  } else {
    console.warn('[create_msp_sso_tenant_login_domains] Skipping create_distributed_table (function unavailable)');
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('msp_sso_tenant_login_domains');
};

exports.config = { transaction: false };
