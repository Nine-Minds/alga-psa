import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const invoiceServiceSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/api/services/InvoiceService.ts'),
  'utf8',
);

describe('InvoiceService billing-cycle metadata audit', () => {
  it('T043/T088: historical billing-cycle metadata reads use current client_billing_cycles columns', () => {
    expect(invoiceServiceSource).toContain(
      "db.tenantJoin(\n          query,\n          'client_billing_cycles',\n          'invoices.billing_cycle_id',\n          'client_billing_cycles.billing_cycle_id',\n          { type: 'left' }\n        )",
    );
    expect(invoiceServiceSource).toContain(
      "'client_billing_cycles.period_start_date as period_start'",
    );
    expect(invoiceServiceSource).toContain(
      "'client_billing_cycles.period_end_date as period_end'",
    );
    expect(invoiceServiceSource).toContain(
      "tenantDb(trx, context.tenant).table('client_billing_cycles')\n      .where({ billing_cycle_id: cycleId })",
    );
    expect(invoiceServiceSource).not.toContain('client_billing_cycles.cycle_id');
    expect(invoiceServiceSource).not.toContain('.where({ cycle_id: cycleId');
  });
});
