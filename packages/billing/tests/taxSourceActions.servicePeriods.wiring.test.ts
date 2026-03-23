import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/actions/taxSourceActions.ts', import.meta.url), 'utf8');

describe('taxSourceActions recurring timing wiring', () => {
  it('keeps tax finalization gating tied to tax import state rather than recurring service-period fields', () => {
    expect(source).toContain('Finalization gating is import-state driven; canonical recurring service periods do not');
    expect(source).toContain("if (getTaxImportState(invoice.tax_source as TaxSource) === 'pending') {");
    expect(source).not.toContain('service_period_start');
    expect(source).not.toContain('service_period_end');
  });
});
