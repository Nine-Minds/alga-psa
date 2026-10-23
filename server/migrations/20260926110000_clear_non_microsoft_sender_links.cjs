exports.up = async function up(knex) {
  await knex.raw(`
    UPDATE email_sender_addresses esa
    SET microsoft_provider_id = NULL
    FROM tenant_email_settings tes
    WHERE tes.tenant = esa.tenant
      AND lower(coalesce(tes.email_provider, '')) <> 'microsoft'
      AND esa.microsoft_provider_id IS NOT NULL
  `);
};

exports.down = async function down(_knex) {
  // Sender links cleared by this repair cannot be safely reconstructed.
};
