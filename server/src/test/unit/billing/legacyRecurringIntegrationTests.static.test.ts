import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('legacy recurring integration test cleanup', () => {
  it('T081: billing-cycle-specific recurring timing tests are removed or rewritten to canonical client-cadence expectations', () => {
    const source = readFileSync(
      resolve(__dirname, '../../integration/billingInvoiceTiming.integration.test.ts'),
      'utf8',
    );

    expect(source).not.toContain('client-cadence compatibility recurring invoice');
    expect(source).not.toContain('Mixed Batch Compatibility Client');
    expect(source).not.toContain('Client Reverse Reappear Compatibility');
    expect(source).not.toContain("executionWindowKind: 'billing_cycle_window'");
  });
});
