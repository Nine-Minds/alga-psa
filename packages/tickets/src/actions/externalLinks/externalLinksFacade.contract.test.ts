// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const persistenceSource = readRepoFile('packages/tickets/src/actions/externalLinks/externalLinkPersistence.ts');
const actionsSource = readRepoFile('packages/tickets/src/actions/externalLinks/externalLinkActions.ts');
const metadataSource = readRepoFile('packages/db/src/lib/tenantTableMetadata.ts');
const shimSource = readRepoFile('server/migrations/utils/tenantDb.cjs');

const coveredTenantTables = ['external_entity_links', 'tenant_external_systems', 'comments', 'tickets'];

function directRootPattern(table: string): RegExp {
  return new RegExp(`\\b(?:db|trx|knex|conn)\\s*(?:<[^>]+>)?\\(\\s*['"]${table}(?:\\s+as\\s+\\w+)?['"]`);
}

describe('external links tenant facade contract', () => {
  it('registers every tenant table the feature touches in both registries', () => {
    for (const table of coveredTenantTables) {
      expect(metadataSource).toContain(`${table}: { scope: 'tenant' }`);
    }
    for (const table of ['external_entity_links', 'tenant_external_systems']) {
      expect(shimSource).toContain(`${table}: { scope: 'tenant' }`);
    }
  });

  it('routes every external-link table root through tenantDb', () => {
    for (const source of [persistenceSource, actionsSource]) {
      expect(source).toContain('tenantDb');
      for (const table of coveredTenantTables) {
        expect(source).not.toMatch(directRootPattern(table));
      }
      // No hand-written tenant predicates or raw tenant joins.
      expect(source).not.toMatch(/\.andOn\([^)\n]*tenant/);
      expect(source).not.toMatch(/tenantJoin\([^)]*external_entity_links/);
    }
  });

  it('surfaces structured conflict codes rather than raw unique violations', () => {
    expect(persistenceSource).toContain("'origin_exists'");
    expect(persistenceSource).toContain("'duplicate_external_link'");
    expect(persistenceSource).toContain("isUniqueViolation");
    expect(persistenceSource).toContain('23505');
  });

  it('keeps events after the write transaction and inline audit inside it', () => {
    // Event publishing is invoked outside withTransaction for add/update/remove.
    const addIndex = actionsSource.indexOf('await publishExternalLinkEvent(\'TICKET_EXTERNAL_LINK_ADDED\'');
    const firstTxClose = actionsSource.indexOf('});', actionsSource.indexOf('const result = await withTransaction(knex, async (trx) => {'));
    expect(addIndex).toBeGreaterThan(firstTxClose);
    expect(actionsSource).toContain('TICKET_ACTIVITY_SOURCE.EXTERNAL_LINK');

    // The inline create path writes audit in-transaction and never swallows
    // unique violations (no silent skipConflicts).
    expect(persistenceSource).toContain('writeTicketActivity');
    expect(persistenceSource).toContain('publishExternalLinkEvent');
    expect(persistenceSource).not.toContain('skipConflicts');
  });
});
