import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), 'utf8');
}

describe('utility and API tenant facade roots', () => {
  it('routes utility/API tenant roots through tenantDb', () => {
    const files = [
      'shared/ticketClients/contacts.ts',
      'shared/ticketClients/clients.ts',
      'server/src/utils/calendar/eventMapping.ts',
      'packages/integrations/src/utils/calendar/eventMapping.ts',
      'server/src/app/api/v1/service-types/route.ts',
      'server/src/app/api/v1/service-types/[id]/route.ts',
      'server/src/app/api/v1/tickets/priorities/route.ts',
    ];

    const directRootPattern = /\b(?:knex|knexOrTrx|trx|db)(?:<[^>]+>)?\(\s*['"`][a-zA-Z_][\w]*(?:\s+as\s+[\w]+)?['"`]\s*\)/;
    const directTenantObjectWherePattern = /\.(?:where|andWhere)\(\s*\{(?:(?!\}\s*\)).)*\btenant\s*:/s;
    const directTenantColumnWherePattern = /\.(?:where|andWhere)\(\s*['"`][^'"`]*tenant['"`]\s*,/;
    const directTenantJoinPattern = /\.andOn\(\s*['"`][^'"`]*tenant['"`][\s\S]{0,200}\)/;

    for (const file of files) {
      const source = read(file);

      expect(source, file).toContain('tenantDb');
      expect(source, file).not.toMatch(directRootPattern);
      expect(source, file).not.toMatch(directTenantObjectWherePattern);
      expect(source, file).not.toMatch(directTenantColumnWherePattern);
      expect(source, file).not.toMatch(directTenantJoinPattern);
    }
  });

  it('registers calendar online meeting roots in tenant metadata', () => {
    const metadataSource = read('packages/db/src/lib/tenantTableMetadata.ts');

    expect(metadataSource).toContain("online_meetings: { scope: 'tenant' }");
  });

  it('routes outbound webhook model roots through tenantDb', () => {
    const source = read('server/src/lib/webhooks/webhookModel.ts');

    expect(source).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(source).toContain('tenantDb(knex, tenant).table(WEBHOOKS_TABLE)');
    expect(source).toContain('tenantDb(knex, input.tenant).table(WEBHOOKS_TABLE)');
    expect(source).toContain('tenantDb(knex, input.tenant).table(WEBHOOK_DELIVERIES_TABLE)');
    expect(source).toContain('const db = tenantDb(knex, tenant);');
    expect(source).not.toContain('knex(WEBHOOKS_TABLE)');
    expect(source).not.toContain('knex(WEBHOOK_DELIVERIES_TABLE)');
  });

  it('routes extension gateway registry roots through tenantDb', () => {
    const source = read('server/src/lib/extensions/gateway/registry.ts');

    expect(source).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(source).toContain('tenantDb(knex, tenantId)');
    expect(source).toContain(".table('tenant_extension_install as ti')");
    expect(source).toContain('tenantDb(knex, install.tenant_id)');
    expect(source).toContain(".table('extension_bundle as eb')");
    expect(source).not.toContain(".from({ ti: 'tenant_extension_install' })");
    expect(source).not.toContain(".from({ eb: 'extension_bundle' })");
  });
});
