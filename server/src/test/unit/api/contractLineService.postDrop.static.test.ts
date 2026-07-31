import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('ContractLineService post-drop runtime wiring', () => {
  it('uses the client-owned contract structure for live mutation and analytics paths', () => {
    const source = readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../../lib/api/services/ContractLineService.ts',
      ),
      'utf8',
    );

    expect(source).not.toContain("trx('client_contract_lines')");
    expect(source).not.toContain("knex('client_contract_lines')");
    expect(source).not.toContain(".table('client_contract_lines')");
    // tenant scoping now lives in the tenantDb facade
    expect(source).toContain("await tenantDb(trx, context.tenant).table('contract_lines')");
    expect(source).toContain("await tenantDb(trx, context.tenant).table('contract_lines as cl')");
    expect(source).toContain(".tenantJoin(q, 'client_contracts as cc'");
    expect(source).toContain("whereRaw('c.owner_client_id = cc.client_id')");
  });
});
