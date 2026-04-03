import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/Contracts.tsx', import.meta.url),
  'utf8'
);

describe('contracts hub template separation wiring', () => {
  it('T029: keeps reusable templates distinct from client-owned contract instances', () => {
    expect(source).toContain("{ id: 'templates', label: 'Templates', content: renderTemplateTab() },");
    expect(source).toContain("{ id: 'client-contracts', label: 'Client Contracts', content: renderClientContractsTab() },");
    expect(source).toContain('Templates are reusable definitions. Client contracts are client-owned instances.');
  });
});
