exports.up = function(knex) {
    return knex.schema
    .createTable('time_sheet_comments', table => {
        table.uuid('comment_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('time_sheet_id').notNullable();
        table.uuid('user_id').notNullable();
        table.text('comment').notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.boolean('is_approver').notNullable();
        table.uuid('tenant').notNullable();
      
        // Composite foreign key for time_sheet_id and tenant
        table.foreign(['time_sheet_id', 'tenant'])
          .references(['id', 'tenant'])
          .inTable('time_sheets');
      
        // Composite foreign key for user_id and tenant
        table.foreign(['user_id', 'tenant'])
          .references(['user_id', 'tenant'])
          .inTable('users')
      
        // Add indexes for better query performance
        table.index(['time_sheet_id', 'tenant']);
        table.index(['user_id', 'tenant']);
        table.index('tenant');
      });
  };
  
  exports.down = function(knex) {
    return knex.schema.dropTable('time_sheet_comments');
  };