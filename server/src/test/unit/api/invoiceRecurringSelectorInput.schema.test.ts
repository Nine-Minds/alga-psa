import { describe, expect, it } from 'vitest';

import {
  generateInvoiceSchema,
  invoicePreviewRequestSchema,
} from '../../../lib/api/schemas/invoiceSchemas';

const selectorInputRequest = {
  selector_input: {
    clientId: '11111111-1111-4111-8111-111111111111',
    windowStart: '2025-02-08',
    windowEnd: '2025-03-08',
    executionWindow: {
      kind: 'contract_cadence_window',
      identityKey: 'contract:11111111-1111-4111-8111-111111111111:2025-02-08:2025-03-08',
      cadenceOwner: 'contract',
      clientId: '11111111-1111-4111-8111-111111111111',
      contractId: '22222222-2222-4222-8222-222222222222',
      contractLineId: '33333333-3333-4333-8333-333333333333',
      windowStart: '2025-02-08',
      windowEnd: '2025-03-08',
    },
  },
};

describe('invoice recurring selector-input API schemas', () => {
  it('T059: invoice preview request schema accepts selector-input execution windows', () => {
    const selectorResult = invoicePreviewRequestSchema.safeParse(selectorInputRequest);
    const compatibilityResult = invoicePreviewRequestSchema.safeParse({
      billing_cycle_id: '44444444-4444-4444-8444-444444444444',
    });
    const invalidResult = invoicePreviewRequestSchema.safeParse({});

    expect(selectorResult.success).toBe(true);
    expect(compatibilityResult.success).toBe(true);
    expect(invalidResult.success).toBe(false);
  });

  it('T060: recurring invoice generation request schema accepts selector-input execution windows', () => {
    const selectorResult = generateInvoiceSchema.safeParse(selectorInputRequest);
    const compatibilityResult = generateInvoiceSchema.safeParse({
      billing_cycle_id: '55555555-5555-4555-8555-555555555555',
    });
    const invalidResult = generateInvoiceSchema.safeParse({
      billing_cycle_id: '55555555-5555-4555-8555-555555555555',
      selector_input: selectorInputRequest.selector_input,
    });

    expect(selectorResult.success).toBe(true);
    expect(compatibilityResult.success).toBe(true);
    expect(invalidResult.success).toBe(false);
  });
});
