exports.up = function(knex) {
  // Add check constraint for service_type in service_catalog
  return knex.raw(`
    ALTER TABLE service_catalog 
    ADD CONSTRAINT service_type_check 
    CHECK (service_type IN ('Fixed', 'Time', 'Usage', 'Product', 'License'));
  `);
};

exports.down = function(knex) {
  // Remove the check constraint
  return knex.raw(`
    ALTER TABLE service_catalog 
    DROP CONSTRAINT IF EXISTS service_type_check;
  `);
};