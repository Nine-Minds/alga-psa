const { Knex } = require('knex');

/**
 * Add default billing settings for all tenants
 * @param {Knex} knex
 */
exports.up = async function(knex) {
  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  
  // Create default settings for each tenant if they don't exist
  for (const { tenant } of tenants) {
    const existingSettings = await knex('default_billing_settings')
      .where({ tenant })
      .first();
      
    if (!existingSettings) {
      await knex('default_billing_settings').insert({
        tenant,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: true,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    }
  }
};

exports.down = async function(knex) {
  // No need to remove default settings during rollback
  // as they are meant to be permanent
};