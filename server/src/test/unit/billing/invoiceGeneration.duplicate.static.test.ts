import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const invoiceGenerationSource = fs.readFileSync(
  path.resolve(
    process.cwd(),
    '../packages/billing/src/actions/invoiceGeneration.ts',
  ),
  'utf8',
);

describe('invoice generation duplicate source', () => {
  it('T022: recurring duplicate detection checks canonical client and contract execution windows before any legacy billing-cycle fallback', () => {
    const clientCadenceIndex = invoiceGenerationSource.indexOf(
      "executionWindow.kind === 'client_cadence_window'",
    );
    const contractCadenceIndex = invoiceGenerationSource.indexOf(
      "executionWindow.kind === 'contract_cadence_window'",
    );
    const billingCycleFallbackIndex = invoiceGenerationSource.indexOf(
      "executionWindow.kind === 'billing_cycle_window' && billingCycleId",
    );

    expect(clientCadenceIndex).toBeGreaterThan(-1);
    expect(contractCadenceIndex).toBeGreaterThan(-1);
    expect(billingCycleFallbackIndex).toBeGreaterThan(-1);
    expect(clientCadenceIndex).toBeLessThan(billingCycleFallbackIndex);
    expect(contractCadenceIndex).toBeLessThan(billingCycleFallbackIndex);
    expect(invoiceGenerationSource).not.toContain("if (billingCycleId) {");
  });
});
