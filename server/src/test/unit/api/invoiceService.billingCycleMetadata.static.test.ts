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
      "leftJoin('client_billing_cycles', 'invoices.billing_cycle_id', 'client_billing_cycles.billing_cycle_id')",
    );
    expect(invoiceServiceSource).toContain(
      "'client_billing_cycles.period_start_date as period_start'",
    );
    expect(invoiceServiceSource).toContain(
      "'client_billing_cycles.period_end_date as period_end'",
    );
    expect(invoiceServiceSource).toContain(
      '.where({ billing_cycle_id: cycleId, tenant: context.tenant })',
    );
    expect(invoiceServiceSource).not.toContain('client_billing_cycles.cycle_id');
    expect(invoiceServiceSource).not.toContain('.where({ cycle_id: cycleId');
  });
});
