import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Contract PO docs', () => {
  it('T015: docs updated for PO snapshot + advisory PO limits + batch overage prompt', () => {
    const repoRoot = path.resolve(__dirname, '../../../../..');
    const readme = fs.readFileSync(path.resolve(repoRoot, 'README.md'), 'utf-8');
    const billingDocs = fs.readFileSync(path.resolve(repoRoot, 'docs', 'billing', 'billing.md'), 'utf-8');

    expect(readme).toMatch(/purchase orders?/i);
    expect(billingDocs).toMatch(/##\s+Purchase Orders\s*\(PO\)/);
    expect(billingDocs).toMatch(/snapshots? the PO number onto invoices/i);
    expect(billingDocs).toMatch(/advisory/i);
    expect(billingDocs).toMatch(/batch/i);
  });
});
