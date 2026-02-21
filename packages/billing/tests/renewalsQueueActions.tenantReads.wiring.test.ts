import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions tenant read scoping', () => {
  it('applies tenant filters to renewal work-item reads by default', () => {
    expect(source).toContain(".where({ 'cc.tenant': tenant, 'cc.is_active': true })");
    expect(source).toContain("tenant,");
    expect(source).toContain("client_contract_id: clientContractId,");
    expect(source).toContain("'cc.tenant': tenant,");
    expect(source).toContain('.where({ tenant })');
    expect(source).toContain(".where({ tenant, client_contract_id: clientContractId })");
    expect(source).toContain(".where({\n        tenant,\n        client_contract_id: clientContractId,\n        is_active: true,");
  });
});
