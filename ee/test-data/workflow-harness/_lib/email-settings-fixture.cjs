const {
  deleteTenantRows,
  insertTenantRow,
  selectTenantRows,
  updateTenantRows
} = require('./tenant-sql.cjs');

async function ensureTenantEmailSettings(ctx) {
  const tenantId = ctx.config.tenantId;

  const fixtureProviderConfigs = [
    {
      providerId: 'fixture-smtp',
      providerType: 'smtp',
      isEnabled: true,
      config: {
        host: 'imap-test-server',
        port: 3025,
        secure: false,
        username: 'imap_user',
        password: 'imap_pass',
        from: 'no-reply@example.com',
        rejectUnauthorized: false
      }
    }
  ];

  const existing = await selectTenantRows(ctx, {
    table: 'tenant_email_settings',
    columns: [
      'id',
      'default_from_domain',
      'ticketing_from_email',
      'custom_domains',
      'email_provider',
      'provider_configs',
      'fallback_enabled',
      'tracking_enabled',
      'max_daily_emails',
      'updated_at'
    ].join(', '),
    tenantId,
    orderBy: 'id asc',
    limit: 1
  });

  if (existing.length) {
    const row = existing[0];

    await updateTenantRows(ctx, {
      table: 'tenant_email_settings',
      tenantId,
      set: `
        default_from_domain = $2,
        ticketing_from_email = $3,
        custom_domains = $4::json,
        email_provider = $5,
        provider_configs = $6::json,
        fallback_enabled = $7,
        tracking_enabled = $8,
        max_daily_emails = $9,
        updated_at = now()
      `,
      where: 'id = $10',
      params: [
        'example.com',
        null,
        JSON.stringify([]),
        'smtp',
        JSON.stringify(fixtureProviderConfigs),
        true,
        false,
        null,
        row.id
      ]
    });

    ctx.onCleanup(async () => {
      await updateTenantRows(ctx, {
        table: 'tenant_email_settings',
        tenantId,
        set: `
          default_from_domain = $2,
          ticketing_from_email = $3,
          custom_domains = $4::json,
          email_provider = $5,
          provider_configs = $6::json,
          fallback_enabled = $7,
          tracking_enabled = $8,
          max_daily_emails = $9,
          updated_at = $10
        `,
        where: 'id = $11',
        params: [
          row.default_from_domain,
          row.ticketing_from_email,
          JSON.stringify(row.custom_domains ?? []),
          row.email_provider,
          JSON.stringify(row.provider_configs ?? []),
          row.fallback_enabled,
          row.tracking_enabled,
          row.max_daily_emails,
          row.updated_at,
          row.id
        ]
      });
    });

    return;
  }

  const inserted = await insertTenantRow(ctx, {
    table: 'tenant_email_settings',
    tenantId,
    columns: [
      'default_from_domain',
      'ticketing_from_email',
      'custom_domains',
      'email_provider',
      'provider_configs',
      'fallback_enabled',
      'tracking_enabled',
      'max_daily_emails',
      'created_at',
      'updated_at'
    ],
    values: [
      '$2',
      '$3',
      '$4::json',
      '$5',
      '$6::json',
      '$7',
      '$8',
      '$9',
      'now()',
      'now()'
    ],
    params: [
      'example.com',
      null,
      JSON.stringify([]),
      'smtp',
      JSON.stringify(fixtureProviderConfigs),
      true,
      false,
      null
    ],
    returning: 'id'
  });

  const insertedId = inserted[0]?.id;
  ctx.onCleanup(async () => {
    if (insertedId) {
      await deleteTenantRows(ctx, {
        table: 'tenant_email_settings',
        tenantId,
        where: 'id = $2',
        params: [insertedId]
      });
    }
  });
}

module.exports = { ensureTenantEmailSettings };
