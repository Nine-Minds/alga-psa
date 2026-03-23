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
  it('T022: recurring duplicate detection relies only on canonical client and contract execution windows', () => {
    const duplicateSourceStart = invoiceGenerationSource.indexOf(
      'function buildDuplicateRecurringInvoiceError',
    );
    const duplicateSourceEnd = invoiceGenerationSource.indexOf(
      '// TODO: Move to billingAndTax.ts',
      duplicateSourceStart,
    );
    const duplicateSource = invoiceGenerationSource.slice(
      duplicateSourceStart,
      duplicateSourceEnd,
    );
    const clientCadenceIndex = invoiceGenerationSource.indexOf(
      "executionWindow.kind === 'client_cadence_window'",
    );
    const contractCadenceIndex = invoiceGenerationSource.indexOf(
      "executionWindow.kind === 'contract_cadence_window'",
    );

    expect(clientCadenceIndex).toBeGreaterThan(-1);
    expect(contractCadenceIndex).toBeGreaterThan(-1);
    expect(duplicateSource).not.toContain(
      "executionWindow.kind === 'billing_cycle_window'",
    );
    expect(duplicateSource).not.toContain(
      'Invoice already exists for this billing cycle',
    );
  });
});
