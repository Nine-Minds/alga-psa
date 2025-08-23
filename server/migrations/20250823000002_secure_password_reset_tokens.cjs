/**
 * Secure password reset tokens with hashing and add automatic cleanup
 */

exports.up = async function(knex) {
  // 1. Rename the existing token column to token_hash
  // Since we're hashing tokens, we need to store the hash instead
  await knex.schema.alterTable('password_reset_tokens', (table) => {
    table.renameColumn('token', 'token_hash');
  });

  // 2. Add index on token_hash WITH tenant for faster lookups (Citus requirement)
  await knex.schema.alterTable('password_reset_tokens', (table) => {
    table.index(['tenant', 'token_hash'], 'idx_password_reset_tenant_token_hash');
  });

  // 3. Create a function for batch deletion of expired tokens
  // This will be called by pg-boss scheduled job
  await knex.raw(`
    CREATE OR REPLACE FUNCTION cleanup_expired_password_reset_tokens()
    RETURNS TABLE(
      deleted_count INTEGER,
      execution_time INTERVAL
    ) AS $$
    DECLARE
      start_time TIMESTAMP;
      end_time TIMESTAMP;
      rows_deleted INTEGER;
    BEGIN
      start_time := clock_timestamp();
      
      -- Delete expired tokens across all tenants
      DELETE FROM password_reset_tokens 
      WHERE expires_at < NOW();
      
      GET DIAGNOSTICS rows_deleted = ROW_COUNT;
      
      end_time := clock_timestamp();
      
      RETURN QUERY SELECT 
        rows_deleted,
        (end_time - start_time)::INTERVAL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // 4. Add index on tenant and expires_at for efficient cleanup queries
  await knex.schema.alterTable('password_reset_tokens', (table) => {
    table.index(['tenant', 'expires_at'], 'idx_password_reset_tenant_expires_at');
  });

  // 5. Add a comment to document the security changes
  await knex.raw(`
    COMMENT ON COLUMN password_reset_tokens.token_hash IS 
    'SHA256 hash of the actual reset token. The plaintext token is never stored for security.';
  `);

  // 6. Note about cleanup strategy
  // Instead of relying on pg-boss (which has issues), we implement automatic cleanup:
  // - Expired tokens are cleaned up automatically when new tokens are created
  // - The cleanup_expired_password_reset_tokens() function can be called manually or via external scheduler
  // - For production, consider using system cron or cloud scheduler to call the cleanup function periodically
  
  await knex.raw(`
    COMMENT ON FUNCTION cleanup_expired_password_reset_tokens() IS 
    'Cleanup function for expired password reset tokens. 
     Can be called manually or via external scheduler (cron, systemd timer, etc).
     The application also performs automatic cleanup during token operations.';
  `);
};

exports.down = async function(knex) {

  // Drop the cleanup function
  await knex.raw('DROP FUNCTION IF EXISTS cleanup_expired_password_reset_tokens()');

  // Remove indexes
  await knex.schema.alterTable('password_reset_tokens', (table) => {
    table.dropIndex(['tenant', 'expires_at'], 'idx_password_reset_tenant_expires_at');
    table.dropIndex(['tenant', 'token_hash'], 'idx_password_reset_tenant_token_hash');
  });

  // Rename column back to original
  await knex.schema.alterTable('password_reset_tokens', (table) => {
    table.renameColumn('token_hash', 'token');
  });
};