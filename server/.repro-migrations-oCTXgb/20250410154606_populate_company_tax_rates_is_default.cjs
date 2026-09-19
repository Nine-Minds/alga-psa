/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // Get all company tax settings (which contain the 'default' tax rate ID)
  const settings = await knex('company_tax_settings').select(
    'tenant',
    'company_id',
    'tax_rate_id'
  );

  // Update the corresponding company_tax_rates entry to set is_default = true
  // Process in chunks or individually to avoid overly large transactions if necessary,
  // but for typical numbers of companies, this should be fine.
  const updates = settings.map((setting) => {
    if (!setting.tax_rate_id) {
      console.warn(`Skipping company ${setting.company_id} in tenant ${setting.tenant} due to missing tax_rate_id in settings.`);
      return Promise.resolve(); // Skip if tax_rate_id is somehow null
    }
    return knex('company_tax_rates')
      .where({
        tenant: setting.tenant,
        company_id: setting.company_id,
        tax_rate_id: setting.tax_rate_id, // Match the specific rate that was the default
      })
      .update({
        is_default: true,
      });
  });

  await Promise.all(updates);

  console.log(`Updated is_default flag for ${settings.length} company tax rates based on company_tax_settings.`);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  // Reset all is_default flags to false.
  // Reversing the specific logic is complex and not strictly necessary
  // as the column is managed by the schema migrations.
  await knex('company_tax_rates')
    .update({
      is_default: false,
    });
  console.log('Reset all is_default flags in company_tax_rates to false.');
};
