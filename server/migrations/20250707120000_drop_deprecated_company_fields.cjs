/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Check if columns exist
  const hasAddress = await knex.schema.hasColumn('companies', 'address');
  const hasPhoneNo = await knex.schema.hasColumn('companies', 'phone_no');
  const hasEmail = await knex.schema.hasColumn('companies', 'email');
  
  // Only proceed if at least one column exists
  if (hasAddress || hasPhoneNo || hasEmail) {
    // First, migrate any remaining data to company_locations
    await knex.raw(`
      INSERT INTO company_locations (
        location_id,
        company_id,
        tenant,
        location_name,
        address_line1,
        city,
        state_province,
        postal_code,
        country_code,
        country_name,
        phone,
        email,
        is_default,
        is_billing_address,
        is_shipping_address,
        is_active,
        created_at,
        updated_at
      )
      SELECT 
        gen_random_uuid() as location_id,
        c.company_id,
        c.tenant,
        'Main Location' as location_name,
        COALESCE(c.address, 'N/A') as address_line1,
        'N/A' as city,
        NULL as state_province,
        NULL as postal_code,
        'XX' as country_code,
        'Unknown' as country_name,
        c.phone_no as phone,
        c.email as email,
        true as is_default,
        true as is_billing_address,
        true as is_shipping_address,
        true as is_active,
        NOW() as created_at,
        NOW() as updated_at
      FROM companies c
      LEFT JOIN company_locations cl ON c.company_id = cl.company_id AND cl.is_default = true
      WHERE cl.location_id IS NULL
        AND ((c.address IS NOT NULL AND c.address != '') 
          OR (c.phone_no IS NOT NULL AND c.phone_no != '')
          OR (c.email IS NOT NULL AND c.email != ''))
      ON CONFLICT DO NOTHING;
    `);
    
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