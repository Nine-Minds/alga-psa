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
    
    // Unique constraint on token across all tenants for security
    table.unique('token', 'unique_portal_invitation_token');
  });

  // Create automatic cleanup function for expired tokens
  await knex.raw(`
    CREATE OR REPLACE FUNCTION cleanup_expired_portal_invitations()
    RETURNS INTEGER AS $$
    DECLARE
      deleted_count INTEGER;
    BEGIN
      DELETE FROM portal_invitations 
      WHERE expires_at < NOW() AT TIME ZONE 'UTC';
      
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      
      -- Log cleanup operation
      INSERT INTO audit_logs (
        audit_id,
        tenant,
        table_name,
        operation,
        record_id,
        changed_data,
        details,
        user_id,
        timestamp
      )
      SELECT 
        gen_random_uuid(),
        '00000000-0000-0000-0000-000000000000'::uuid,
        'portal_invitations',
        'CLEANUP',
        '00000000-0000-0000-0000-000000000000'::text,
        jsonb_build_object('deleted_count', deleted_count),
        jsonb_build_object('operation', 'automated_cleanup', 'deleted_count', deleted_count),
        '00000000-0000-0000-0000-000000000000'::text,
        NOW() AT TIME ZONE 'UTC'
      WHERE deleted_count > 0;
      
      RETURN deleted_count;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create index on audit_logs if it doesn't exist (for the cleanup logging)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_table_operation 
    ON audit_logs(tenant, table_name, operation, timestamp);
  `);
};

exports.down = async function(knex) {
  // Drop the cleanup function
  await knex.raw('DROP FUNCTION IF EXISTS cleanup_expired_portal_invitations()');
  
  // Drop the table (will cascade and remove indexes and foreign keys)
  await knex.schema.dropTableIfExists('portal_invitations');
};