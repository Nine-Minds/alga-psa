/**
 * Refactor inbound ticket defaults to be standalone tenant-level settings
 * Remove the link from email_providers and add is_default flag
 */

exports.up = async function(knex) {
  console.log('Refactoring inbound ticket defaults to be standalone...');

  // Step 1: Add is_default column to inbound_ticket_defaults table
  console.log('Adding is_default column to inbound_ticket_defaults...');
  await knex.schema.table('inbound_ticket_defaults', function(table) {
    table.boolean('is_default').defaultTo(false).notNullable();
    
    // Add unique constraint to ensure only one default per tenant
    // This is CitusDB compatible since tenant is part of the distribution key
    table.unique(['tenant', 'is_default'], {
      predicate: knex.whereRaw('is_default = true')
    });
  });

  // Step 2: Set existing records as default (one per tenant)
  console.log('Setting existing inbound ticket defaults as default...');
  
  // Get all tenants that have inbound ticket defaults
  const tenants = await knex('inbound_ticket_defaults')
    .distinct('tenant')
    .pluck('tenant');

  for (const tenant of tenants) {
    // Set the first record for each tenant as default
    const firstRecord = await knex('inbound_ticket_defaults')
      .where({ tenant })
      .orderBy('created_at', 'asc')
      .first();
    
    if (firstRecord) {
      await knex('inbound_ticket_defaults')
        .where({ id: firstRecord.id, tenant })
        .update({ is_default: true });
      
      console.log(`Set default inbound ticket defaults for tenant: ${tenant}`);
    }
  }

  // Step 3: Remove inbound_ticket_defaults_id from email_providers table
  console.log('Removing inbound_ticket_defaults_id from email_providers...');
  await knex.schema.table('email_providers', function(table) {
    table.dropColumn('inbound_ticket_defaults_id');
  });

  console.log('✅ Inbound ticket defaults refactoring completed');
};

exports.down = async function(knex) {
  console.log('Reverting inbound ticket defaults refactoring...');

  // Step 1: Re-add inbound_ticket_defaults_id to email_providers table
  console.log('Re-adding inbound_ticket_defaults_id to email_providers...');
  await knex.schema.table('email_providers', function(table) {
    table.uuid('inbound_ticket_defaults_id').nullable();
    table.foreign('inbound_ticket_defaults_id').references('id').inTable('inbound_ticket_defaults');
  });

  // Step 2: Link email providers back to default inbound ticket defaults
  console.log('Linking email providers to default inbound ticket defaults...');
  
  const tenants = await knex('email_providers')
    .distinct('tenant')
    .pluck('tenant');

  for (const tenant of tenants) {
    const defaultSettings = await knex('inbound_ticket_defaults')
      .where({ tenant, is_default: true })
      .first();

    if (defaultSettings) {
      await knex('email_providers')
        .where({ tenant })
        .update({ inbound_ticket_defaults_id: defaultSettings.id });
      
      console.log(`Linked email providers to default settings for tenant: ${tenant}`);
    }
  }

  // Step 3: Remove is_default column and constraint from inbound_ticket_defaults
  console.log('Removing is_default column from inbound_ticket_defaults...');
  await knex.schema.table('inbound_ticket_defaults', function(table) {
    table.dropUnique(['tenant', 'is_default']);
    table.dropColumn('is_default');
  });

  console.log('🔄 Inbound ticket defaults refactoring reverted');
};