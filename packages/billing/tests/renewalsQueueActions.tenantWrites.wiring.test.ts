import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions tenant write scoping', () => {
  it('applies tenant filters to renewal work-item writes by default', () => {
    expect(source).toContain(".where({\n        tenant,\n        client_contract_id: clientContractId,\n      })\n      .update(");
    expect(source).toContain(".where({ tenant, client_contract_id: clientContractId })");
    expect(source).toContain("await trx('client_contracts').insert(clientContractInsert);");
    expect(source).toContain('tenant,');
    expect(source).toContain("await trx('contracts').insert({");
    expect(source).toContain("await trx('client_contracts')\n        .where({ tenant, client_contract_id: clientContractId })");
    expect(source).toContain(".where({ tenant })\n      .whereRaw(\"(attributes::jsonb ->> 'idempotency_key') = ?\", [idempotencyKey])");
  });
});
