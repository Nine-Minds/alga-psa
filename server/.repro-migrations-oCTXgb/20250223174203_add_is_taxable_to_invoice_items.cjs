exports.up = async function(knex) {
  // Add is_taxable column
  await knex.schema.table('invoice_items', function(table) {
    table.boolean('is_taxable').defaultTo(true);
  });

  // Copy is_taxable from service_catalog for existing items
  const records = await knex('invoice_items as ii')
    .join('service_catalog as sc', function() {
      this.on('ii.service_id', '=', 'sc.service_id')
          .andOn('ii.tenant', '=', 'sc.tenant');
    })
    .select('ii.item_id', 'ii.tenant', 'sc.is_taxable');

  // Update records in batches, ensuring tenant is included in WHERE clause
  for (const record of records) {
    await knex('invoice_items')
      .where({
        item_id: record.item_id,
        tenant: record.tenant
      })
      .update({
        is_taxable: record.is_taxable
      });
  }
};

exports.down = function(knex) {
  return knex.schema.table('invoice_items', function(table) {
    table.dropColumn('is_taxable');
  });
};
