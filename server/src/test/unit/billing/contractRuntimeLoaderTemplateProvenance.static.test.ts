import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('contract runtime loader template provenance boundaries', () => {
  it('T012: contract runtime loaders keep template joins provenance-only and do not widen live identity lookups', () => {
    const contractModelSource = readFileSync(
      resolve(process.cwd(), '../packages/billing/src/models/contract.ts'),
      'utf8',
    );
    const contractActionsSource = readFileSync(
      resolve(process.cwd(), '../packages/billing/src/actions/contractActions.ts'),
      'utf8',
    );

    // Tenant scoping on the contracts join now lives in the facade: tenantJoin
    // adds the andOn tenant predicate automatically.
    expect(contractModelSource).toContain("db.tenantJoin(query, 'contracts as co', 'co.contract_id', 'cc.contract_id');");
    expect(contractModelSource).toContain("db.tenantJoin(query, 'contract_templates as template', 'cc.template_contract_id', 'template.template_id', { type: 'left' });");
    expect(contractModelSource).not.toMatch(/cc\.template_contract_id'\s*,\s*'='\s*,\s*'co\.contract_id'/);
    expect(contractModelSource).not.toMatch(/where\([^)]*template_contract_id[^)]*contract_id[^)]*\)/i);

    expect(contractActionsSource).toContain("facade.tenantJoin(query, 'client_contracts as cc', 'co.contract_id', 'cc.contract_id', { type: 'left' });");
    expect(contractActionsSource).toContain("facade.tenantJoin(query, 'contract_templates as template', 'cc.template_contract_id', 'template.template_id', { type: 'left' });");
    expect(contractActionsSource).not.toMatch(/coalesce\s*\(\s*cc\.template_contract_id\s*,\s*cc\.contract_id\s*\)/i);
  });
});
