exports.up = async function(knex) {
  // Create portal_invitations table
  await knex.schema.createTable('portal_invitations', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('invitation_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('contact_id').notNullable();
    table.text('token').notNullable();
    table.text('email').notNullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('used_at', { useTz: true });
    table.jsonb('metadata').defaultTo('{}');
    
    // Primary key
    table.primary(['tenant', 'invitation_id']);
    
    // Foreign key constraints
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'contact_id']).references(['tenant', 'contact_name_id']).inTable('contacts');
    
    // Indexes for performance
    table.index(['tenant', 'token'], 'idx_portal_invitations_token');
    table.index(['tenant', 'contact_id'], 'idx_portal_invitations_contact');
    table.index(['tenant', 'expires_at'], 'idx_portal_invitations_expires');
    table.index(['tenant', 'email'], 'idx_portal_invitations_email');
    
    // Unique constraint on token per tenant for CitusDB compatibility
    table.unique(['tenant', 'token'], 'unique_portal_invitation_tenant_token');
  });
};

exports.down = async function(knex) {
  // Drop the table (will cascade and remove indexes and foreign keys)
  await knex.schema.dropTableIfExists('portal_invitations');
};