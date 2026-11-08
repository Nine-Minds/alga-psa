import { describe, expect, it } from 'vitest';
import {
  selectOwnedCustomer,
  stripeMetadataClaimsOtherTenant,
  stripeMetadataTenant,
} from '../../lib/stripe/stripeCustomerOwnership';

describe('stripeMetadataTenant (single decision point for the tenant metadata key)', () => {
  it('accepts tenant_id and alga_tenant_id, rejects absent, empty and conflicting claims', () => {
    expect(stripeMetadataTenant({ metadata: { tenant_id: 't1' } })).toBe('t1');
    expect(stripeMetadataTenant({ metadata: { alga_tenant_id: 't1' } })).toBe('t1');
    expect(stripeMetadataTenant({ metadata: { tenant_id: 't1', alga_tenant_id: 't1' } })).toBe('t1');
    expect(stripeMetadataTenant({ metadata: { tenant_id: 't1', alga_tenant_id: 't2' } })).toBeNull();
    expect(stripeMetadataTenant({ metadata: { tenant_id: ' ' } })).toBeNull();
    expect(stripeMetadataTenant({ metadata: {} })).toBeNull();
    expect(stripeMetadataTenant({})).toBeNull();
  });

  it('flags any foreign claim, including a conflicting pair that names this tenant too', () => {
    expect(stripeMetadataClaimsOtherTenant({ metadata: { tenant_id: 't2' } }, 't1')).toBe(true);
    expect(stripeMetadataClaimsOtherTenant({ metadata: { tenant_id: 't1', alga_tenant_id: 't2' } }, 't1')).toBe(true);
    expect(stripeMetadataClaimsOtherTenant({ metadata: {} }, 't1')).toBe(false);
    expect(stripeMetadataClaimsOtherTenant({ metadata: { tenant_id: 't1' } }, 't1')).toBe(false);
  });
});

describe('selectOwnedCustomer', () => {
  it('selects exactly one owned candidate, never the first hit', () => {
    const r = selectOwnedCustomer({ tenantId: 't1', accountId: 'acct_1', purpose: 'saas_billing' }, [
      { id: 'cus_foreign', metadata: { tenant_id: 't2', stripe_account_id: 'acct_1', purpose: 'saas_billing' } },
      { id: 'cus_mine', metadata: { alga_tenant_id: 't1', stripe_account_id: 'acct_1', purpose: 'saas_billing' } },
    ]);
    expect(r).toEqual({ customerId: 'cus_mine', error: null });
  });

  it('refuses none / unbound / foreign-only / ambiguous, with a generic user message', () => {
    for (const [cands, code] of [
      [[], 'no_candidates'],
      [[{ id: 'a' }], 'no_owned_candidate'],
      [[{ id: 'a', metadata: { tenant_id: 't2', stripe_account_id: 'acct_1', purpose: 'saas_billing' } }], 'no_owned_candidate'],
      [[{ id: 'a', metadata: { tenant_id: 't1', stripe_account_id: 'acct_1', purpose: 'saas_billing' } }, { id: 'b', metadata: { tenant_id: 't1', stripe_account_id: 'acct_1', purpose: 'saas_billing' } }], 'ambiguous_owned_candidates'],
    ] as const) {
      const r = selectOwnedCustomer({ tenantId: 't1', accountId: 'acct_1', purpose: 'saas_billing' }, cands as any);
      expect(r.customerId).toBeNull();
      expect(r.error!.code).toBe(code);
      expect(r.error!.message).not.toMatch(/cus_|\ba\b.*\bb\b|t2/);
    }
  });

  it('does not treat client-payment import metadata as SaaS billing ownership', () => {
    const r = selectOwnedCustomer({ tenantId: 't1', accountId: 'acct_1', purpose: 'saas_billing' }, [
      { id: 'cus_client_payment', metadata: { tenant_id: 't1', stripe_account_id: 'acct_1', client_id: 'c1' } },
    ]);
    expect(r.customerId).toBeNull();
    expect(r.error?.code).toBe('no_owned_candidate');
  });

  it('rejects a conflicting Stripe account stamp even when tenant and purpose match', () => {
    const r = selectOwnedCustomer({ tenantId: 't1', accountId: 'acct_1', purpose: 'saas_billing' }, [
      { id: 'cus_wrong_account', metadata: { tenant_id: 't1', stripe_account_id: 'acct_2', purpose: 'saas_billing' } },
    ]);
    expect(r.customerId).toBeNull();
  });
});
