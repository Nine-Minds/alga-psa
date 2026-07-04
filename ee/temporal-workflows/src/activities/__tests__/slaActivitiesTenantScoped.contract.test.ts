import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, '../sla-activities.ts'), 'utf8');

describe('SLA Temporal activities tenant-scoped query contract', () => {
  it('uses tenantDb for ticket and SLA audit roots inside tenant activities', () => {
    expect(source).toContain("import { tenantDb, withTenantTransactionRetryReadOnly } from '@alga-psa/db';");
    expect(source).toContain("db.table('tickets')");
    expect(source).toContain("db.table('sla_audit_log')");
    expect(source).not.toContain("trx('tickets')");
    expect(source).not.toContain("trx('sla_audit_log')");
    expect(source).not.toContain('.where({ tenant: input.tenantId');
  });
});
