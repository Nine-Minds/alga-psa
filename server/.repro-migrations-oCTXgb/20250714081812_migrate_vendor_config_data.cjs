/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Migrate existing vendor_config data to new tables
  const providers = await knex('email_providers')
    .select('id', 'tenant', 'provider_type', 'vendor_config');

  for (const provider of providers) {
    if (!provider.vendor_config || Object.keys(provider.vendor_config).length === 0) {
      continue;
    }

    if (provider.provider_type === 'microsoft') {
      // Migrate Microsoft provider config
      await knex('microsoft_email_provider_config').insert({
        email_provider_id: provider.id,
        tenant: provider.tenant,
        client_id: provider.vendor_config.clientId || '',
        client_secret: provider.vendor_config.clientSecret || '',
        tenant_id: provider.vendor_config.tenantId || '',
        redirect_uri: provider.vendor_config.redirectUri || '',
        auto_process_emails: provider.vendor_config.autoProcessEmails ?? true,
        max_emails_per_sync: provider.vendor_config.maxEmailsPerSync ?? 50,
        folder_filters: JSON.stringify(provider.vendor_config.folderFilters || []),
        access_token: provider.vendor_config.accessToken || null,
        refresh_token: provider.vendor_config.refreshToken || null,
        token_expires_at: provider.vendor_config.tokenExpiresAt || null,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    } else if (provider.provider_type === 'google') {
      // Migrate Google provider config
      await knex('google_email_provider_config').insert({
        email_provider_id: provider.id,
        tenant: provider.tenant,
        client_id: provider.vendor_config.clientId || '',
        client_secret: provider.vendor_config.clientSecret || '',
        project_id: provider.vendor_config.projectId || '',
        redirect_uri: provider.vendor_config.redirectUri || '',
        pubsub_topic_name: provider.vendor_config.pubsubTopicName || null,
        pubsub_subscription_name: provider.vendor_config.pubsubSubscriptionName || null,
        auto_process_emails: provider.vendor_config.autoProcessEmails ?? true,
        max_emails_per_sync: provider.vendor_config.maxEmailsPerSync ?? 50,
        label_filters: JSON.stringify(provider.vendor_config.labelFilters || []),
        access_token: provider.vendor_config.accessToken || null,
        refresh_token: provider.vendor_config.refreshToken || null,
        token_expires_at: provider.vendor_config.tokenExpiresAt || null,
        history_id: provider.vendor_config.historyId || null,
        watch_expiration: provider.vendor_config.watchExpiration || null,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    }
  }

  // Remove vendor_config column from email_providers
  await knex.schema.alterTable('email_providers', function(table) {
    table.dropColumn('vendor_config');
  });

  console.log('✅ Migrated vendor_config data to separate tables and removed vendor_config column');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Re-add vendor_config column
  await knex.schema.alterTable('email_providers', function(table) {
    table.jsonb('vendor_config').notNullable().defaultTo('{}');
  });

  // Migrate data back from vendor-specific tables
  const providers = await knex('email_providers')
    .select('id', 'tenant', 'provider_type');

  for (const provider of providers) {
    let vendorConfig = {};

    if (provider.provider_type === 'microsoft') {
      const msConfig = await knex('microsoft_email_provider_config')
        .where({ email_provider_id: provider.id, tenant: provider.tenant })
        .first();

      if (msConfig) {
        vendorConfig = {
          clientId: msConfig.client_id,
          clientSecret: msConfig.client_secret,
          tenantId: msConfig.tenant_id,
          redirectUri: msConfig.redirect_uri,
          autoProcessEmails: msConfig.auto_process_emails,
          maxEmailsPerSync: msConfig.max_emails_per_sync,
          folderFilters: JSON.parse(msConfig.folder_filters || '[]'),
          accessToken: msConfig.access_token,
          refreshToken: msConfig.refresh_token,
          tokenExpiresAt: msConfig.token_expires_at
        };
      }
    } else if (provider.provider_type === 'google') {
      const googleConfig = await knex('google_email_provider_config')
        .where({ email_provider_id: provider.id, tenant: provider.tenant })
        .first();

      if (googleConfig) {
        vendorConfig = {
          clientId: googleConfig.client_id,
          clientSecret: googleConfig.client_secret,
          projectId: googleConfig.project_id,
          redirectUri: googleConfig.redirect_uri,
          pubsubTopicName: googleConfig.pubsub_topic_name,
          pubsubSubscriptionName: googleConfig.pubsub_subscription_name,
          autoProcessEmails: googleConfig.auto_process_emails,
          maxEmailsPerSync: googleConfig.max_emails_per_sync,
          labelFilters: JSON.parse(googleConfig.label_filters || '[]'),
          accessToken: googleConfig.access_token,
          refreshToken: googleConfig.refresh_token,
          tokenExpiresAt: googleConfig.token_expires_at,
          historyId: googleConfig.history_id,
          watchExpiration: googleConfig.watch_expiration
        };
      }
    }

    await knex('email_providers')
      .where({ id: provider.id, tenant: provider.tenant })
      .update({ vendor_config: JSON.stringify(vendorConfig) });
  }

  console.log('✅ Restored vendor_config column with migrated data');
};