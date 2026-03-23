import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(process.cwd(), '..');
const runbookPath = path.join(
  repoRoot,
  'ee/docs/plans/2026-03-18-service-driven-invoicing-cutover/RUNBOOK.md',
);
const contractTemplateWizardCurrencyIntegrationPath = path.join(
  repoRoot,
  'server/src/test/integration/contractTemplateWizardCurrency.integration.test.ts',
);
const multiCurrencyGapsIntegrationPath = path.join(
  repoRoot,
  'server/src/test/integration/multiCurrencyGaps.integration.test.ts',
);

describe('client-contract-line post-drop hygiene', () => {
  it('documents recurring repair against the surviving client-owned contract structure', () => {
    const runbook = fs.readFileSync(runbookPath, 'utf8');

    expect(runbook).toContain('from client_contracts cc');
    expect(runbook).toContain('join contracts ct');
    expect(runbook).not.toContain('from client_contract_lines ccl');
    expect(runbook).not.toContain('compatibility client-cadence invoice');
  });

  it('removes tracked backup billing tests that still pointed engineers at dropped client-line fixtures', () => {
    expect(
      fs.existsSync(
        path.join(
          repoRoot,
          'server/src/test/infrastructure/billing/invoices/billingInvoiceGeneration_tax.test.ts.bak',
        ),
      ),
    ).toBe(false);

    expect(
      fs.existsSync(
        path.join(
          repoRoot,
          'server/src/test/infrastructure/billing/invoices/billingInvoiceGeneration_tax.test.ts.bak2',
        ),
      ),
    ).toBe(false);
  });

  it('keeps cleanup-only integration fixtures on the surviving client-owned contract structure', () => {
    const contractTemplateWizardCurrencyIntegration = fs.readFileSync(
      contractTemplateWizardCurrencyIntegrationPath,
      'utf8',
    );
    const multiCurrencyGapsIntegration = fs.readFileSync(
      multiCurrencyGapsIntegrationPath,
      'utf8',
    );

    expect(contractTemplateWizardCurrencyIntegration).not.toContain("safeDelete('client_contract_lines'");
    expect(contractTemplateWizardCurrencyIntegration).toContain("safeDelete('client_contracts'");
    expect(multiCurrencyGapsIntegration).not.toContain("client_contract_lines as ccl");
    expect(multiCurrencyGapsIntegration).not.toContain("safeDeleteIn('client_contract_lines'");
    expect(multiCurrencyGapsIntegration).toContain("await db('client_contracts as cc')");
  });
});
