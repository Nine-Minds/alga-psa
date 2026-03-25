import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/services/invoiceService.ts', import.meta.url), 'utf8');
const externalBranch = source.split("if (taxSource === 'external') {")[1]?.split("if (taxSource === 'pending_external') {")[0] ?? '';
const pendingExternalBranch = source.split("if (taxSource === 'pending_external') {")[1]?.split('// Internal tax calculation (default)')[0] ?? '';

describe('invoiceService external tax recurring timing wiring', () => {
  it('keeps external and pending-external tax paths driven by imported tax amounts rather than recurring service-period fields', () => {
    expect(source).toContain('External tax remains amount-authoritative');
    expect(source).toContain("if (taxSource === 'external') {");
    expect(source).toContain(".select('item_id', 'net_amount', 'external_tax_amount');");
    expect(source).toContain("if (taxSource === 'pending_external') {");
    expect(externalBranch).not.toContain('service_period_start');
    expect(externalBranch).not.toContain('service_period_end');
    expect(pendingExternalBranch).not.toContain('service_period_start');
    expect(pendingExternalBranch).not.toContain('service_period_end');
  });
});
