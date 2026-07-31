import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/Contracts.tsx', import.meta.url),
  'utf8'
);

describe('contracts hub template separation wiring', () => {
  it('T029: keeps reusable templates distinct from client-owned contract instances', () => {
    expect(source).toContain("{ id: 'templates', label: contractSubtabLabels.templates, content: renderTemplateTab() },");
    expect(source).toContain("{ id: 'client-contracts', label: contractSubtabLabels['client-contracts'], content: renderClientContractsTab() },");
    expect(source).toContain("templates: t('common.tabs.templates', { defaultValue: 'Templates' }),");
    expect(source).toContain("'client-contracts': t('common.tabs.clientContracts', { defaultValue: 'Client Contracts' }),");
    expect(source).toContain('Templates are reusable definitions. Client contracts are client-owned instances.');
  });
});
