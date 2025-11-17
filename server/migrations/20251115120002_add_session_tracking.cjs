/**
 * Migration: Add session tracking columns to sessions table
 *
 * Adds comprehensive session tracking fields including:
 * - IP address and location tracking
 * - Device information and fingerprinting
 * - Activity and expiration tracking
 * - Revocation tracking
 * - Login method tracking
 *
 * CRITICAL: Makes the 'token' column nullable to avoid NOT NULL constraint violations
 * The session_id (stored in JWT) is used as the correlation key instead of token
 */

exports.up = async function(knex) {
  await knex.schema.alterTable('sessions', (table) => {
    // IP and location tracking
    table.string('ip_address', 45); // Support IPv4 and IPv6
    table.jsonb('location_data'); // {city, country, timezone}

    // Device information
    table.text('user_agent');
    table.text('device_fingerprint'); // SHA-256 hash
    table.text('device_name'); // "Chrome on macOS"
    table.text('device_type'); // desktop, mobile, tablet

    // Activity tracking
    table.timestamp('last_activity_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true });

    // Revocation tracking
    table.timestamp('revoked_at', { useTz: true });
    table.text('revoked_reason'); // user_logout, admin_revoke, max_sessions, security, inactivity

    // Session metadata
    table.text('login_method'); // 'credentials', 'google', 'microsoft', 'keycloak'

    // NOTE: No token_hash column - we use session_id (stored in JWT) as correlation key
    // NOTE: No is_current column - UI determines current session dynamically
  });

  // CRITICAL: Make the old 'token' column nullable
  // The existing sessions table has token TEXT NOT NULL which will cause inserts to fail
  // We don't use this column anymore (session_id is the correlation key), but keep it nullable for compatibility
  await knex.schema.raw('ALTER TABLE sessions ALTER COLUMN token DROP NOT NULL');

  // Add indexes for performance
  // IMPORTANT: Include tenant column for CitusDB distributed table compatibility
  await knex.schema.raw(
    'CREATE INDEX idx_sessions_user_active ON sessions(tenant, user_id) WHERE revoked_at IS NULL'
  );
  await knex.schema.raw(
    'CREATE INDEX idx_sessions_expires_at ON sessions(tenant, expires_at) WHERE revoked_at IS NULL'
  );
  // NOTE: No token_hash index - we use session_id (PK) as lookup key
};

exports.down = async function(knex) {
  // Restore NOT NULL constraint on token
  await knex.schema.raw('ALTER TABLE sessions ALTER COLUMN token SET NOT NULL');

  await knex.schema.alterTable('sessions', (table) => {
    table.dropColumn('ip_address');
    table.dropColumn('location_data');
    table.dropColumn('user_agent');
    table.dropColumn('device_fingerprint');
    table.dropColumn('device_name');
    table.dropColumn('device_type');
    table.dropColumn('last_activity_at');
    table.dropColumn('expires_at');
    table.dropColumn('revoked_at');
    table.dropColumn('revoked_reason');
    table.dropColumn('login_method');
  });

  await knex.schema.raw('DROP INDEX IF EXISTS idx_sessions_user_active');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_sessions_expires_at');
};
