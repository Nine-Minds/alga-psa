/**
 * Creates a pivot table to support multiple assignees for schedule entries.
 * This enables assigning multiple agents to a single schedule entry while
 * maintaining the existing user_id column for backward compatibility.
 */
exports.up = function(knex) {
  return knex.schema.createTable('schedule_entry_assignees', table => {
    // Core columns
    table.uuid('tenant').notNullable()
      .references('tenant').inTable('tenants')
      .onDelete('CASCADE');
    table.uuid('entry_id').notNullable();
    table.uuid('user_id').notNullable();
    
    // Primary key across all three columns
    table.primary(['tenant', 'entry_id', 'user_id']);

    // Foreign key to schedule_entries
    table.foreign(['tenant', 'entry_id'])
      .references(['tenant', 'entry_id'])
      .inTable('schedule_entries')
      .onDelete('CASCADE');

    // Foreign key to users
    table.foreign(['tenant', 'user_id'])
      .references(['tenant', 'user_id'])
      .inTable('users')
      .onDelete('CASCADE');

    // Timestamps using postgres timestamp type as per standards
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  })
  .then(() => knex.raw(`
    -- Set table owner
    ALTER TABLE public.schedule_entry_assignees OWNER TO postgres;

    -- Enable row level security
    ALTER TABLE public.schedule_entry_assignees ENABLE ROW LEVEL SECURITY;

    -- Create RLS policy for tenant isolation
    CREATE POLICY tenant_isolation_policy ON public.schedule_entry_assignees
      AS PERMISSIVE
      FOR ALL
      USING ((tenant)::text = current_setting('app.current_tenant'::text));

  `));
};

exports.down = function(knex) {
  return knex.schema.dropTable('schedule_entry_assignees');
};
