/**
 * Security allowlist for platform reports (cross-tenant reporting).
 *
 * Only tables and columns in this allowlist can be queried.
 * This ensures we only expose metadata (counts, dates, IDs) and never content.
 */

/**
 * Allowlist: table name -> array of allowed column names.
 * Only metadata columns are allowed - NO content/private data.
 */
export const PLATFORM_REPORT_ALLOWLIST: Record<string, string[]> = {
  // Tenant metadata
  tenants: [
    'tenant',
    'company_name',
    'created_at',
    'updated_at',
    'is_active',
  ],

  // User metadata (no passwords, personal data)
  users: [
    'user_id',
    'tenant',
    'username',
    'email',
    'created_at',
    'last_login',
    'is_inactive',
  ],

  // Ticket metadata (no title, description, comments)
  tickets: [
    'ticket_id',
    'tenant',
    'created_at',
    'updated_at',
    'status_id',
    'priority_id',
    'channel_id',
    'closed_at',
  ],

  // Invoice metadata
  invoices: [
    'invoice_id',
    'tenant',
    'created_at',
    'due_date',
    'total',
    'status',
    'is_paid',
  ],

  // Time entry metadata (no work descriptions)
  time_entries: [
    'entry_id',
    'tenant',
    'user_id',
    'created_at',
    'billable_duration',
    'work_item_type',
  ],

  // Company metadata
  companies: [
    'company_id',
    'tenant',
    'company_name',
    'created_at',
    'is_inactive',
  ],

  // Project metadata (no descriptions)
  projects: [
    'project_id',
    'tenant',
    'created_at',
    'start_date',
    'end_date',
    'status_id',
    'is_inactive',
  ],

  // Contract metadata (no terms/details)
  service_catalog: [
    'service_id',
    'tenant',
    'service_type',
    'created_at',
    'is_taxable',
  ],

  // Billing plan metadata
  billing_plans: [
    'plan_id',
    'tenant',
    'plan_name',
    'billing_frequency',
    'is_active',
    'created_at',
  ],
};

/**
 * Tables that should NEVER be queried in platform reports.
 * Blocked for security/privacy reasons.
 */
export const BLOCKED_TABLES: string[] = [
  // Security sensitive
  'user_passwords',
  'secrets',
  'api_keys',
  'sessions',
  'user_auth_accounts',

  // Content/privacy sensitive
  'documents',
  'comments',
  'notes',
  'email_messages',
  'notifications',

  // Extension data (tenant-specific)
  'ext_storage_records',

  // Audit logs (potentially sensitive)
  'audit_logs',
];

/**
 * Validates that a table is allowed for platform reports.
 */
export function isTableAllowed(table: string): boolean {
  return (
    !BLOCKED_TABLES.includes(table) &&
    Object.prototype.hasOwnProperty.call(PLATFORM_REPORT_ALLOWLIST, table)
  );
}

/**
 * Validates that a column is allowed for a given table.
 */
export function isColumnAllowed(table: string, column: string): boolean {
  const allowedColumns = PLATFORM_REPORT_ALLOWLIST[table];
  if (!allowedColumns) return false;
  return allowedColumns.includes(column);
}

/**
 * Gets the list of allowed columns for a table.
 */
export function getAllowedColumns(table: string): string[] {
  return PLATFORM_REPORT_ALLOWLIST[table] ?? [];
}
