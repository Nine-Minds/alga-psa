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

    expect(contractModelSource).toContain("this.on('co.contract_id', '=', 'cc.contract_id').andOn('co.tenant', '=', 'cc.tenant');");
    expect(contractModelSource).toContain("this.on('cc.template_contract_id', '=', 'template.template_id')");
    expect(contractModelSource).not.toMatch(/cc\.template_contract_id'\s*,\s*'='\s*,\s*'co\.contract_id'/);
    expect(contractModelSource).not.toMatch(/where\([^)]*template_contract_id[^)]*contract_id[^)]*\)/i);

    expect(contractActionsSource).toContain("this.on('co.contract_id', '=', 'cc.contract_id').andOn('co.tenant', '=', 'cc.tenant');");
    expect(contractActionsSource).toContain("this.on('cc.template_contract_id', '=', 'template.template_id')");
    expect(contractActionsSource).not.toMatch(/coalesce\s*\(\s*cc\.template_contract_id\s*,\s*cc\.contract_id\s*\)/i);
  });
});
