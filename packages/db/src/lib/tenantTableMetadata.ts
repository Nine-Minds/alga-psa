export type TenantTableScope =
  | { scope: 'tenant'; tenantColumn?: string }
  | { scope: 'global' }
  | { scope: 'admin' };

export interface ParsedTableExpression {
  tableExpression: string;
  tableName: string;
  rootAlias: string;
}

export const tenantTableMetadata: Record<string, TenantTableScope> = {
  assets: { scope: 'tenant' },
  clients: { scope: 'tenant' },
  authorization_bundle_assignments: { scope: 'tenant' },
  bucket_usage: { scope: 'tenant' },
  client_billing_cycles: { scope: 'tenant' },
  client_contract_lines: { scope: 'tenant' },
  client_locations: { scope: 'tenant' },
  client_tax_rates: { scope: 'tenant' },
  client_tax_settings: { scope: 'tenant' },
  contact_additional_email_addresses: { scope: 'tenant' },
  contact_email_type_definitions: { scope: 'tenant' },
  contact_phone_numbers: { scope: 'tenant' },
  contact_phone_type_definitions: { scope: 'tenant' },
  contacts: { scope: 'tenant' },
  contract_line_service_configuration: { scope: 'tenant' },
  holidays: { scope: 'tenant' },
  interactions: { scope: 'tenant' },
  interaction_types: { scope: 'tenant' },
  knex_migrations: { scope: 'global' },
  projects: { scope: 'tenant' },
  project_tasks: { scope: 'tenant' },
  quotes: { scope: 'tenant' },
  quote_items: { scope: 'tenant' },
  rmm_alerts: { scope: 'tenant' },
  rmm_integrations: { scope: 'tenant' },
  rmm_organization_mappings: { scope: 'tenant' },
  schedule_entries: { scope: 'tenant' },
  schedule_entry_assignees: { scope: 'tenant' },
  server_assets: { scope: 'tenant' },
  service_catalog: { scope: 'tenant' },
  statuses: { scope: 'tenant' },
  tax_components: { scope: 'tenant' },
  tax_rates: { scope: 'tenant' },
  task_resources: { scope: 'tenant' },
  team_members: { scope: 'tenant' },
  teams: { scope: 'tenant' },
  tenants: { scope: 'tenant' },
  tickets: { scope: 'tenant' },
  ticket_resources: { scope: 'tenant' },
  time_entries: { scope: 'tenant' },
  time_periods: { scope: 'tenant' },
  time_sheets: { scope: 'tenant' },
  time_sheet_comments: { scope: 'tenant' },
  user_roles: { scope: 'tenant' },
  users: { scope: 'tenant' },
  workstation_assets: { scope: 'tenant' },
};

function unquoteIdentifier(identifier: string): string {
  return identifier.replace(/^["'`\[]/, '').replace(/["'`\]]$/, '');
}

function baseTableName(tableName: string): string {
  const unquoted = unquoteIdentifier(tableName);
  const parts = unquoted.split('.');
  return unquoteIdentifier(parts[parts.length - 1]);
}

export function parseTableExpression(tableExpression: string): ParsedTableExpression {
  const trimmed = tableExpression.trim();
  if (!trimmed) {
    throw new Error('Tenant table expression cannot be empty');
  }

  const explicitAsAlias = trimmed.match(/^(.+?)\s+as\s+([^\s]+)$/i);
  if (explicitAsAlias) {
    const tableName = explicitAsAlias[1].trim();
    return {
      tableExpression: trimmed,
      tableName: baseTableName(tableName),
      rootAlias: unquoteIdentifier(explicitAsAlias[2]),
    };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) {
    const alias = parts[parts.length - 1];
    const tableName = parts.slice(0, -1).join(' ');
    return {
      tableExpression: trimmed,
      tableName: baseTableName(tableName),
      rootAlias: unquoteIdentifier(alias),
    };
  }

  return {
    tableExpression: trimmed,
    tableName: baseTableName(trimmed),
    rootAlias: baseTableName(trimmed),
  };
}

export function getTenantTableScope(tableName: string): TenantTableScope | undefined {
  return tenantTableMetadata[tableName];
}

export function requireTenantTableScope(tableName: string): TenantTableScope {
  const scope = getTenantTableScope(tableName);
  if (!scope) {
    throw new Error(`No tenant table metadata registered for ${tableName}`);
  }
  return scope;
}
