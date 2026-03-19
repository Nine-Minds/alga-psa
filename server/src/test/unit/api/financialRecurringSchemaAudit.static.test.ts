import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { calculateBillingSchema } from '../../../lib/api/schemas/financialSchemas';

describe('financial API recurring schema audit', () => {
  it('T070: only legitimate client billing schedule API schemas still expose billing-cycle-specific request contracts', () => {
    const canonicalRequest = calculateBillingSchema.safeParse({
      client_id: '11111111-1111-4111-8111-111111111111',
      period_start: '2025-02-08T00:00:00.000Z',
      period_end: '2025-03-08T00:00:00.000Z',
    });
    const legacyRecurringRequest = calculateBillingSchema.safeParse({
      client_id: '11111111-1111-4111-8111-111111111111',
      period_start: '2025-02-08T00:00:00.000Z',
      period_end: '2025-03-08T00:00:00.000Z',
      billing_cycle_id: '22222222-2222-4222-8222-222222222222',
    });
    const schemasSource = readFileSync(
      resolve(__dirname, '../../../lib/api/schemas/financialSchemas.ts'),
      'utf8',
    );

    expect(canonicalRequest.success).toBe(true);
    expect(legacyRecurringRequest.success).toBe(false);
    expect(schemasSource).toContain('export const clientContractLineCycleBaseSchema = z.object({');
    expect(schemasSource).toContain('billing_cycle_id: uuidSchema.optional()');
    expect(schemasSource).toContain(
      "Billing calculation requests require canonical execution-window dates and do not accept billing_cycle_id.",
    );
    expect(schemasSource).toContain('const invoiceWriteSchema = z.object({');
    expect(schemasSource).not.toContain('export const billingCycleInvoiceRequestSchema');
  });
});
