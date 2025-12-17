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
    'client_name',
    'email',
    'phone_number',
    'industry',
    'plan',
    'licensed_user_count',
    'created_at',
    'updated_at',
  ],

  // User metadata (no passwords, personal data)
  users: [
    'user_id',
    'tenant',
    'username',
    'email',
    'first_name',
    'last_name',
    'user_type',
    'is_inactive',
    'created_at',
    'last_login_at',
  ],

  // Ticket metadata (no description, comments)
  tickets: [
    'ticket_id',
    'tenant',
    'ticket_number',
    'title',
    'status_id',
    'priority_id',
    'category_id',
    'assigned_to',
    'is_closed',
    'entered_at',
    'updated_at',
    'closed_at',
  ],

  // Invoice metadata
  invoices: [
    'invoice_id',
    'tenant',
    'invoice_number',
    'invoice_date',
    'due_date',
    'total_amount',
    'subtotal',
    'tax',
    'status',
    'created_at',
  ],

  // Time entry metadata (no work descriptions)
  time_entries: [
    'entry_id',
    'tenant',
    'user_id',
    'work_item_id',
    'work_item_type',
    'billable_duration',
    'start_time',
    'end_time',
    'approval_status',
    'created_at',
  ],

  // Client metadata
  clients: [
    'client_id',
    'tenant',
    'client_name',
    'email',
    'phone',
    'is_inactive',
    'created_at',
    'updated_at',
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

  // Service catalog metadata (no terms/details)
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
