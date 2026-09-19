/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Migrate existing company address, phone, and email data to company_locations table
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
      company_id,
      tenant,
      'Main Location' as location_name,
      COALESCE(address, 'N/A') as address_line1,
      'N/A' as city,
      NULL as state_province,
      NULL as postal_code,
      'XX' as country_code,
      'Unknown' as country_name,
      phone_no as phone,
      email as email,
      true as is_default,
      true as is_billing_address,
      true as is_shipping_address,
      true as is_active,
      NOW() as created_at,
      NOW() as updated_at
    FROM companies 
    WHERE (address IS NOT NULL AND address != '') 
       OR (email IS NOT NULL AND email != '')
    ON CONFLICT DO NOTHING;
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove migrated location records
  await knex.raw(`
    DELETE FROM company_locations 
    WHERE location_name = 'Main Location' 
    AND created_at >= '2025-05-27'::date;
  `);
};