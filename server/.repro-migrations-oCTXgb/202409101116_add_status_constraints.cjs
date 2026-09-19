exports.up = async function(knex) {
  await knex.schema.alterTable('statuses', (table) => {
    // Add unique constraint for (tenant, status_name, status_type)
    table.unique(['tenant', 'status_name', 'status_type'], 'unique_tenant_name_type');

    // Add unique constraint for (tenant, status_type, order_number)
    table.unique(['tenant', 'status_type', 'order_number'], 'unique_tenant_type_order');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('statuses', (table) => {
    // Remove the unique constraints
    table.dropUnique(['tenant', 'status_name', 'status_type'], 'unique_tenant_name_type');
    table.dropUnique(['tenant', 'status_type', 'order_number'], 'unique_tenant_type_order');
  });
};
