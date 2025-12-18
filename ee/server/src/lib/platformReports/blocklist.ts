/**
 * Security blocklist for platform reports.
 *
 * Uses a blocklist approach: everything is queryable EXCEPT explicitly blocked
 * tables and columns. This provides flexibility while protecting sensitive data.
 */

/**
 * Tables that should NEVER be queried in platform reports.
 * Blocked for security/privacy reasons.
 */
export const BLOCKED_TABLES: string[] = [
  // Authentication & security
  'user_passwords',
  'secrets',
  'api_keys',
  'sessions',
  'user_auth_accounts',
  'verification_tokens',
  'password_reset_tokens',

  // Audit logs (potentially sensitive operation details)
  'audit_logs',

  // Extension storage (tenant-specific, potentially sensitive)
  'ext_storage_records',

  // System/internal tables
  'knex_migrations',
  'knex_migrations_lock',
  'pgboss_archive',
  'pgboss_job',
  'pgboss_schedule',
  'pgboss_subscription',
  'pgboss_version',

  // Citus internal
  'citus_tables',
];

/**
 * Column name patterns that should NEVER be queried.
 * Uses simple pattern matching (contains check).
 * Case-insensitive matching is applied.
 */
export const BLOCKED_COLUMN_PATTERNS: string[] = [
  // Authentication credentials
  'password',
  'password_hash',
  'hashed_password',
  'secret',
  'secret_key',
  'private_key',
  'api_key',
  'access_token',
  'refresh_token',
  'session_token',
  'auth_token',
  'bearer_token',
  'jwt_token',

  // Encryption
  'encryption_key',
  'salt',
  'iv', // initialization vector

  // OAuth/SSO
  'client_secret',
  'oauth_token',
];

/**
 * Validates that a table is not blocked for platform reports.
 */
export function isTableAllowed(table: string): boolean {
  const lowerTable = table.toLowerCase();
  return !BLOCKED_TABLES.some(blocked => blocked.toLowerCase() === lowerTable);
}

/**
 * Validates that a column is not blocked.
 * Checks against blocked patterns (case-insensitive contains match).
 */
export function isColumnAllowed(_table: string, column: string): boolean {
  const lowerColumn = column.toLowerCase();
  return !BLOCKED_COLUMN_PATTERNS.some(pattern =>
    lowerColumn.includes(pattern.toLowerCase())
  );
}

/**
 * Filters a list of columns to remove blocked ones.
 */
export function filterAllowedColumns(table: string, columns: string[]): string[] {
  return columns.filter(col => isColumnAllowed(table, col));
}
