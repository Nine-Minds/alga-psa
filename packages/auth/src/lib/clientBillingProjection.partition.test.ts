import { describe, expect, it } from 'vitest';
import { partitionClientBillingWrite } from './clientBillingProjection';

const existing = { client_name: 'A', credit_limit: '500.00', billing_email: null, auto_invoice: false, payment_terms: 'net_30' };
const changed = (update: Record<string, unknown>) => partitionClientBillingWrite(update, existing).changedBillingFields;

describe('partitionClientBillingWrite', () => {
  it('treats a decimal string and an equal number as unchanged, and a different value as changed', () => {
    expect(changed({ credit_limit: 500 })).toEqual([]);
    expect(changed({ credit_limit: '500' })).toEqual([]);
    expect(changed({ credit_limit: 501 })).toEqual(['credit_limit']);
  });
  it("normalises '' and undefined to null before comparing", () => {
    expect(changed({ billing_email: '' })).toEqual([]);
    expect(changed({ billing_email: null })).toEqual([]);
    expect(partitionClientBillingWrite({ billing_email: '' }, { billing_email: 'a@b.c' }).changedBillingFields).toEqual(['billing_email']);
    expect(partitionClientBillingWrite({ billing_email: null }, { billing_email: 'a@b.c' }).changedBillingFields).toEqual(['billing_email']);
    expect(changed({ billing_email: 'x@y.z' })).toEqual(['billing_email']);
  });
  it('ignores absent keys, credit_balance and non-billing keys, and returns the remainder', () => {
    const result = partitionClientBillingWrite({ client_name: 'B', credit_balance: 9 }, existing);
    expect(result.changedBillingFields).toEqual([]);
    expect(result.nonBillingUpdate).toEqual({ client_name: 'B' });
  });
  it('compares booleans and dates by value', () => {
    expect(changed({ auto_invoice: false })).toEqual([]);
    expect(changed({ auto_invoice: true })).toEqual(['auto_invoice']);
    const e = { billing_cycle: 'monthly', invoice_template_id: null, client_since: new Date('2026-01-01T00:00:00Z') };
    expect(partitionClientBillingWrite({ billing_cycle: 'monthly' }, e).changedBillingFields).toEqual([]);
    expect(partitionClientBillingWrite({ billing_cycle: 'weekly' }, e).changedBillingFields).toEqual(['billing_cycle']);
  });
});
