// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const sources = {
  resourceActions: readRepoFile('packages/tickets/src/actions/ticketResourceActions.ts'),
  teamAssignmentActions: readRepoFile('packages/tickets/src/actions/teamAssignmentActions.ts'),
  ticketBundleUtils: readRepoFile('packages/tickets/src/actions/ticketBundleUtils.ts'),
  ticketActivityActions: readRepoFile('packages/tickets/src/actions/ticketActivityActions.ts'),
  ticketNumberActions: readRepoFile('packages/tickets/src/actions/ticket-number-actions/ticketNumberActions.ts'),
  responseStateSettings: readRepoFile('packages/tickets/src/lib/responseStateSettings.ts'),
  ticketAuthorizationSql: readRepoFile('packages/tickets/src/lib/ticketAuthorizationSql.ts'),
  readTicketActivity: readRepoFile('shared/lib/ticketActivity/readTicketActivity.ts'),
  writeTicketActivity: readRepoFile('shared/lib/ticketActivity/writeTicketActivity.ts'),
};

const ticketsLibIndexSource = readRepoFile('packages/tickets/src/lib/index.ts');

const metadataSource = readRepoFile('packages/db/src/lib/tenantTableMetadata.ts');

const coveredTenantTables = [
  'comments',
  'contacts',
  'next_number',
  'statuses',
  'team_members',
  'teams',
  'tenant_settings',
  'ticket_audit_logs',
  'ticket_bundle_settings',
  'ticket_resources',
  'tickets',
  'users',
];

function directRootPattern(table: string): RegExp {
  return new RegExp(`\\b(?:db|trx|knex|conn)\\s*(?:<[^>]+>)?\\(\\s*['"]${table}(?:\\s+as\\s+\\w+)?['"]`);
}

describe('ticket support facade contract', () => {
  it('registers every tenant table used by the migrated support roots', () => {
    for (const table of coveredTenantTables) {
      expect(metadataSource).toContain(`${table}: { scope: 'tenant' }`);
    }
  });

  it('keeps migrated ticket support roots behind tenantDb', () => {
    for (const source of Object.values(sources)) {
      expect(source).toContain('tenantDb');
      expect(source).not.toContain('createTenantScopedQuery');
      expect(source).not.toMatch(/\.where\(\{[^}\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);
      expect(source).not.toMatch(/\.andWhere\([^)\n]*(?:\btenant\b|['"][^'"]*\.tenant['"])/);
      expect(source).not.toMatch(/\.(?:where|andWhere)\(\s*['"](?:tenant|[^'"]+\.tenant)['"]/);
      expect(source).not.toMatch(/\.andOn\([^)\n]*tenant/);

      for (const table of coveredTenantTables) {
        expect(source).not.toMatch(directRootPattern(table));
      }
    }
  });

  it('uses facade joins for migrated support joins', () => {
    expect(sources.teamAssignmentActions).toContain("tenantScopedTable(trx, 'team_members', tenant)");
    expect(sources.teamAssignmentActions).toContain("tenantJoin(");
    expect(sources.teamAssignmentActions).toContain("'users'");

    expect(sources.ticketBundleUtils).toContain("tenantScopedTable(trx, 'tickets as t', tenant)");
    expect(sources.ticketBundleUtils).toContain("tenantJoin(");
    expect(sources.ticketBundleUtils).toContain("'statuses as s'");
  });

  it('keeps response-state DB settings off the client-safe tickets lib barrel', () => {
    expect(sources.responseStateSettings).toContain('tenantDb');
    expect(ticketsLibIndexSource).not.toContain('responseStateSettings');
    expect(ticketsLibIndexSource).not.toContain('isResponseStateTrackingEnabled');
  });
});
