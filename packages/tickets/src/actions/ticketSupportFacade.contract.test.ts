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
  resourceCore: readRepoFile('packages/tickets/src/lib/ticketResourceCore.ts'),
  reassignTicketResources: readRepoFile('packages/db/src/lib/reassignTicketResources.ts'),
  teamAssignmentCore: readRepoFile('packages/tickets/src/lib/teamAssignmentCore.ts'),
  ticketBundleUtils: readRepoFile('packages/tickets/src/actions/ticketBundleUtils.ts'),
  ticketActivityActions: readRepoFile('packages/tickets/src/actions/ticketActivityActions.ts'),
  ticketNumberActions: readRepoFile('packages/tickets/src/actions/ticket-number-actions/ticketNumberActions.ts'),
  // packages/tickets/src/lib/responseStateSettings.ts is now a re-export
  // barrel; the tenant_settings read this contract guards lives in shared/.
  responseStateSettings: readRepoFile('shared/lib/tickets/responseStateSettings.ts'),
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
    expect(sources.teamAssignmentCore).toContain("tenantScopedTable(trx, 'team_members', tenant)");
    expect(sources.teamAssignmentCore).toContain("tenantJoin(");
    expect(sources.teamAssignmentCore).toContain("'users'");

    // ticketBundleUtils no longer joins: the master ticket and its status are
    // now read as separate row-locked statements (50148971cc) so concurrent
    // child replies cannot both infer a closed->open transition from one join
    // snapshot. Nothing is left to route through tenantJoin, so the guard is
    // stated the way it was always meant: every tickets/statuses root goes
    // through the facade, and no raw join may smuggle an unscoped one back in.
    expect(sources.ticketBundleUtils).toContain("tenantScopedTable(trx, 'tickets', tenant)");
    expect(sources.ticketBundleUtils).toContain("tenantScopedTable(trx, 'statuses', tenant)");
    expect(sources.ticketBundleUtils).toContain('return tenantDb(conn, tenant).table(table)');
    for (const table of coveredTenantTables) {
      expect(sources.ticketBundleUtils).not.toMatch(
        new RegExp(
          `\\.(?:join|leftJoin|rightJoin|innerJoin|outerJoin|leftOuterJoin|rightOuterJoin|fullOuterJoin|crossJoin)\\(\\s*['"]${table}(?:\\s+as\\s+\\w+)?['"]`
        )
      );
    }
  });

  it('keeps response-state DB settings off the client-safe tickets lib barrel', () => {
    expect(sources.responseStateSettings).toContain('tenantDb');
    expect(ticketsLibIndexSource).not.toContain('responseStateSettings');
    expect(ticketsLibIndexSource).not.toContain('isResponseStateTrackingEnabled');
  });
});
