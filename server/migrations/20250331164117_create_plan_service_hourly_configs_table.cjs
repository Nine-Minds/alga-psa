const { Knex } = require('knex');

/**
 * @param {Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('plan_service_hourly_configs', (table) => {
    table.uuid('tenant').notNullable(); // Corrected type to UUID
    table
      .uuid('config_id') // Corrected type to UUID
      // .unsigned() // Not applicable for UUID
      .notNullable()
      .comment('Foreign key referencing plan_service_configuration.id');

    table
      .decimal('hourly_rate', 10, 2)
      .notNullable()
      .comment('The hourly rate for the service');
    table
      .integer('minimum_billable_time')
      .unsigned()
      .notNullable()
      .comment('Minimum billable time in minutes');
    table
      .integer('round_up_to_nearest')
      .unsigned()
      .notNullable()
      .comment('Round up time entries to the nearest specified minutes');

    // Composite primary key including tenant
    table.primary(['tenant', 'config_id']);

    // Composite foreign key including tenant (NO CASCADE)
    table
      .foreign(['tenant', 'config_id'])
      .references(['tenant', 'config_id']) // Corrected to reference config_id
      .inTable('plan_service_configuration');
      // Removed .onDelete('CASCADE') and .onUpdate('CASCADE')

    // Index tenant for performance
    table.index('tenant');
    
    // Timestamps
    table.timestamps(true, true); // Add created_at and updated_at
  });
};

/**
 * @param {Knex} knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('plan_service_hourly_configs');
};
