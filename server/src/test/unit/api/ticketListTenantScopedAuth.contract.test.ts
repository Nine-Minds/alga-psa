// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('API ticket list tenant-scoped authorization contract', () => {
  it('uses tenant-scoped query wrappers for SQL read authorization', () => {
    const controllerSource = readSource('server/src/lib/api/controllers/ApiTicketController.ts');
    const serviceSource = readSource('server/src/lib/api/services/TicketService.ts');
    const typesSource = readSource('server/src/lib/api/controllers/types.ts');

    expect(controllerSource).toContain('compileTenantScopedResourceReadAuthorizationSql');
    expect(controllerSource).toContain("tenantDb(knex, subject.tenant).scoped('tickets as t')");
    expect(controllerSource).toContain('TenantScopedQuery');
    expect(controllerSource).not.toContain('createTenantScopedQuery');
    expect(controllerSource).not.toContain('compileResourceReadAuthorizationSql');

    expect(serviceSource).toContain("tenantDb(knex, context.tenant).scoped('tickets as t')");
    expect(serviceSource).toContain('dataScopedQuery.withBuilder(dataQuery)');
    expect(serviceSource).toContain('countScopedQuery.withBuilder(countQuery)');
    expect(serviceSource).not.toContain('withTenantScopedQueryBuilder');
    expect(serviceSource).not.toContain('createTenantScopedQuery');

    expect(typesSource).toContain('applyAuthorization?: (query: TenantScopedQuery) => void');
  });
});
