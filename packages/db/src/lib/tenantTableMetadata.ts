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
  knex_migrations: { scope: 'global' },
  rmm_alerts: { scope: 'tenant' },
  rmm_integrations: { scope: 'tenant' },
  rmm_organization_mappings: { scope: 'tenant' },
  server_assets: { scope: 'tenant' },
  tenants: { scope: 'tenant' },
  tickets: { scope: 'tenant' },
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
