const MIGRATION_TENANT = 'migration:20250707120000_drop_deprecated_company_fields';
const COMPANY_FIELD_BACKFILL_REASON = 'discover tenants with deprecated company fields to migrate';
const COMPANY_LOCATIONS_BACKFILL_REASON = 'historical company location backfill; company_locations is not registered in tenantDb metadata';

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);

  // Check if columns exist
  const hasAddress = await knex.schema.hasColumn('companies', 'address');
  const hasPhoneNo = await knex.schema.hasColumn('companies', 'phone_no');
  const hasEmail = await knex.schema.hasColumn('companies', 'email');
  
  // Only proceed if at least one column exists
  if (hasAddress || hasPhoneNo || hasEmail) {
    // First, migrate any remaining data to company_locations
    // Loop through tenants to maintain CitusDB compatibility
    const tenants = await migrationDb.unscoped('companies', COMPANY_FIELD_BACKFILL_REASON)
      .distinct('tenant')
      .pluck('tenant');
    
    for (const tenant of tenants) {
      const db = tenantDb(knex, tenant);
      // First, get companies that need migration for this tenant
      const companiesNeedingMigration = await db.table('companies')
        .select('company_id', 'address', 'phone_no', 'email')
        .andWhere(function() {
          this.whereNotNull('address').andWhere('address', '!=', '')
              .orWhereNotNull('phone_no').andWhere('phone_no', '!=', '')
              .orWhereNotNull('email').andWhere('email', '!=', '');
        });
      
      // Then check which ones already have default locations
      const existingDefaultLocations = await db.unscoped('company_locations', COMPANY_LOCATIONS_BACKFILL_REASON)
        .select('company_id')
        .where('tenant', tenant)
        .andWhere('is_default', true);
      
      const existingCompanyIds = new Set(existingDefaultLocations.map(loc => loc.company_id));
      
      // Filter out companies that already have default locations
      const companiesToMigrate = companiesNeedingMigration.filter(
        company => !existingCompanyIds.has(company.company_id)
      );
      
      // Now insert locations for companies that don't have them
      for (const company of companiesToMigrate) {
        await db.unscoped('company_locations', COMPANY_LOCATIONS_BACKFILL_REASON).insert({
          location_id: knex.raw('gen_random_uuid()'),
          company_id: company.company_id,
          tenant: tenant,
          location_name: 'Main Location',
          address_line1: company.address || 'N/A',
          city: 'N/A',
          state_province: null,
          postal_code: null,
          country_code: 'XX',
          country_name: 'Unknown',
          phone: company.phone_no,
          email: company.email,
          is_default: true,
          is_billing_address: true,
          is_shipping_address: true,
          is_active: true,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now()
        });
      }
    }
    
    // Now drop the deprecated columns
    await knex.schema.alterTable('companies', function(table) {
      if (hasAddress) table.dropColumn('address');
      if (hasPhoneNo) table.dropColumn('phone_no');
      if (hasEmail) table.dropColumn('email');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Re-add the columns if rolling back
  await knex.schema.alterTable('companies', function(table) {
    table.string('address');
    table.string('phone_no');
    table.string('email');
  });
};
