exports.up = async function(knex) {
  // Create discounts table
  await knex.schema.createTable('discounts', (table) => {
    table.uuid('discount_id');
    table.uuid('tenant').notNullable();
    table.string('discount_name').notNullable();
    table.enu('discount_type', ['percentage', 'fixed']).notNullable();
    table.decimal('value', 10, 2).notNullable();
    table.timestamp('start_date').notNullable();
    table.timestamp('end_date');
    table.boolean('is_active').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.foreign(['tenant']).references(['tenant']).inTable('tenants').onDelete('CASCADE')
    table.primary(['tenant', 'discount_id']);;
  });

  // Create plan_discounts table
  await knex.schema.createTable('plan_discounts', (table) => {
    table.uuid('plan_id').notNullable();
    table.uuid('discount_id').notNullable();
    table.uuid('company_id');
    table.uuid('tenant').notNullable();
    table.primary(['plan_id', 'discount_id', 'company_id', 'tenant']);
    table.foreign(['plan_id', 'tenant']).references(['plan_id', 'tenant']).inTable('billing_plans').onDelete('CASCADE');
    table.foreign(['discount_id', 'tenant']).references(['discount_id', 'tenant']).inTable('discounts').onDelete('CASCADE');
    table.foreign(['company_id', 'tenant']).references(['company_id', 'tenant']).inTable('companies').onDelete('CASCADE');
    table.foreign(['tenant']).references(['tenant']).inTable('tenants').onDelete('CASCADE');
  });
}

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('plan_discounts');
  await knex.schema.dropTableIfExists('discounts');
}
