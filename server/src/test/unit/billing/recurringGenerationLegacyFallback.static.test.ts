import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
const invoiceGenerationSource = fs.readFileSync(
  path.join(repoRoot, 'packages/billing/src/actions/invoiceGeneration.ts'),
  'utf8',
);

describe('recurring generation legacy fallback cleanup', () => {
  it('T107: legacy billing-window recurring generation helpers are removed from runtime source', () => {
    expect(invoiceGenerationSource).not.toContain('buildLegacyBillingWindowSelectionInput');
    expect(invoiceGenerationSource).not.toContain('calculateBillingForInvoiceWindow(');
    expect(invoiceGenerationSource).not.toContain('legacy_client_cadence_window');
  });
});
