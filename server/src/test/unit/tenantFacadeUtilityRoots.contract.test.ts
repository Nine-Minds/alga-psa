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
});
