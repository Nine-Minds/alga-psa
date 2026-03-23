import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepo = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../../../../../', relativePath), 'utf8');

describe('default-contract lazy backfill and reconciliation wiring', () => {
  it('F057: default-contract ensure remains lazy and gated on billing-settings presence', () => {
    const source = readRepo('shared/billingClients/defaultContract.ts');
    expect(source).toContain('ensureDefaultContractForClientIfBillingConfigured');
    expect(source).toContain("knexOrTrx('client_billing_settings')");
    expect(source).toContain('if (!billingSettings?.client_id) {');
    expect(source).toContain('return { ensured: false };');
    expect(source).toContain('const result = await ensureDefaultContractForClient(knexOrTrx, params);');
  });

  it('F058: due-work unresolved reconciliation routes through billing-engine deterministic write-back path', () => {
    const source = readRepo('packages/billing/src/actions/billingAndTax.ts');
    expect(source).toContain('fetchUnresolvedNonContractDueWorkRows');
    expect(source).toContain('new BillingEngine()');
    expect(source).toContain('calculateUnresolvedNonContractChargesForExecutionWindow');
    expect(source).toContain('schedule:${tenant}:unresolved:');
  });
});
