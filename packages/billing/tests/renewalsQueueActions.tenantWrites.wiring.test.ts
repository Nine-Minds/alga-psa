import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions tenant write scoping', () => {
  it('applies tenant filters to renewal work-item writes by default', () => {
    // Tenant scoping for writes is enforced by the tenantDb facade: db.table() scopes
    // updates to the tenant, and inserts still stamp the tenant column explicitly.
    expect(source).toContain('const db = tenantDb(trx, tenant);');
    // Multi-line update path (mark/snooze/assign/complete): scoped table + id-only where.
    expect(source).toContain("await db.table('client_contracts')\n      .where({\n        client_contract_id: clientContractId,\n      })\n      .update(");
    // Single-line update path (ticket retry): scoped table + id-only where.
    expect(source).toContain(".where({ client_contract_id: clientContractId })\n        .update(");
    // Inserts go through the facade and stamp the tenant column.
    expect(source).toContain("await db.table('client_contracts').insert(clientContractInsert);");
    expect(source).toContain("await db.table('contracts').insert({");
    expect(source).toContain('tenant,');
    // Idempotency lookup is tenant-scoped via the facade before the raw attribute filter.
    expect(source).toContain("await db.table('tickets')\n      .whereRaw(\"(attributes::jsonb ->> 'idempotency_key') = ?\", [idempotencyKey])");
  });
});
