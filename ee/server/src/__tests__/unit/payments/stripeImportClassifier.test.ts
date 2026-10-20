import { describe, expect, it } from 'vitest';
import {
  classifyImport, proposeCustomerMatches,
  type AlgaState, type StripeCustomerSnapshot, type StripePaymentMethodSnapshot,
} from '../../../lib/payments/stripeImportClassifier';
import { parseImportCsv, resolveImportRows } from '../../../lib/payments/stripeImportRows';
import { offSessionEvidence } from '../../../lib/payments/stripeImportSnapshot';
import { shouldParkPaymentMethod } from '../../../lib/payments/autopayPolicy';

const T = 'tenant-1';
const NOW = new Date('2026-10-20T00:00:00Z');

const pm = (id: string, extra: Partial<StripePaymentMethodSnapshot> = {}): StripePaymentMethodSnapshot => ({
  id, type: 'card', created: 100, metadata: {}, offSessionEvidence: true,
  card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, fingerprint: `fp_${id}` }, ...extra,
});
const customer = (id: string, extra: Partial<StripeCustomerSnapshot> = {}): StripeCustomerSnapshot => ({
  id, email: 'ap@acme.test', name: 'Acme', currency: null, defaultPaymentMethodId: null, metadata: {}, paymentMethods: [pm('pm_1')], ...extra,
});
const alga = (extra: Partial<AlgaState> = {}): AlgaState => ({
  tenantId: T, now: NOW, supportedCurrencies: ['USD', 'EUR', 'GBP'], enrolledProfileIds: [], mappings: [], paymentMethods: [],
  profiles: [
    { clientId: 'c1', billingProfileId: 'p1', clientName: 'Acme', profileName: 'Default', isActive: true, currency: 'usd' },
    { clientId: 'c2', billingProfileId: 'p2', clientName: 'Globex', profileName: 'Default', isActive: true, currency: 'eur' },
    { clientId: 'c3', billingProfileId: 'p3', clientName: 'Initech', profileName: 'Default', isActive: true, currency: 'usd' },
  ],
  ...extra,
});
const row = (rowId: string, clientId: string, billingProfileId: string, customerId: string) => ({ rowId, clientId, billingProfileId, customerId });

describe('classifyImport', () => {
  it('adopts a customer with cards and no subscriptions, stamping and defaulting', () => {
    const { rows } = classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [customer('cus_1')], alga: alga() });
    expect(rows[0]).toMatchObject({ action: 'adopt', needsCustomerStamp: true, needsMapping: true, enrollable: true, enrollmentExternalPaymentMethodId: 'pm_1' });
    expect(rows[0].cards[0]).toMatchObject({ action: 'import', setAsDefault: true, expMonth: '12', expYear: '2030', scaRisk: false });
  });

  it('prefers the Stripe invoice default, otherwise the newest card, and never displaces an existing default', () => {
    const cust = customer('cus_1', { defaultPaymentMethodId: 'pm_old', paymentMethods: [pm('pm_new', { created: 300 }), pm('pm_old', { created: 100 })] });
    expect(classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [cust], alga: alga() }).rows[0].cards.find((c) => c.setAsDefault)?.externalPaymentMethodId).toBe('pm_old');
    const noPref = { ...cust, defaultPaymentMethodId: null };
    expect(classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [noPref], alga: alga() }).rows[0].cards.find((c) => c.setAsDefault)?.externalPaymentMethodId).toBe('pm_new');
    const withDefault = alga({ paymentMethods: [{ paymentMethodId: 'x', externalPaymentMethodId: 'pm_existing', clientId: 'c1', billingProfileId: 'p1', isDefault: true, isDeleted: false, status: 'active' }] });
    const plan = classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [cust], alga: withDefault }).rows[0];
    expect(plan.cards.some((c) => c.setAsDefault)).toBe(false);
    expect(plan.enrollmentExternalPaymentMethodId).toBe('pm_existing');
  });

  it('classifies a fully imported row as already-imported on re-run', () => {
    const stamped = { tenant_id: T, client_id: 'c1', billing_profile_id: 'p1', source: 'alga_import' };
    const cust = customer('cus_1', { metadata: stamped, paymentMethods: [pm('pm_1', { metadata: stamped })] });
    const state = alga({
      mappings: [{ clientId: 'c1', billingProfileId: 'p1', customerId: 'cus_1' }],
      paymentMethods: [{ paymentMethodId: 'x', externalPaymentMethodId: 'pm_1', clientId: 'c1', billingProfileId: 'p1', isDefault: true, isDeleted: false, status: 'active' }],
    });
    const plan = classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [cust], alga: state }).rows[0];
    expect(plan.action).toBe('already-imported');
    expect(plan.cards[0].action).toBe('already-imported');
    expect(plan.needsCustomerStamp || plan.needsMapping).toBe(false);
  });

  it('does not re-activate a card parked in requires_update', () => {
    const stamped = { tenant_id: T, client_id: 'c1', billing_profile_id: 'p1' };
    const state = alga({
      mappings: [{ clientId: 'c1', billingProfileId: 'p1', customerId: 'cus_1' }],
      paymentMethods: [{ paymentMethodId: 'x', externalPaymentMethodId: 'pm_1', clientId: 'c1', billingProfileId: 'p1', isDefault: true, isDeleted: false, status: 'requires_update' }],
    });
    const plan = classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [customer('cus_1', { metadata: stamped, paymentMethods: [pm('pm_1', { metadata: stamped })] })], alga: state }).rows[0];
    expect(plan.cards[0].action).toBe('already-imported');
    expect(plan.action).toBe('already-imported');
    expect(plan.enrollable).toBe(false); // a parked card is not a chargeable enrollment target
  });

  it('conflicts when the cus_ is already claimed by another client/profile', () => {
    const state = alga({ mappings: [{ clientId: 'c2', billingProfileId: 'p2', customerId: 'cus_1' }] });
    expect(classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [customer('cus_1')], alga: state }).rows[0])
      .toMatchObject({ action: 'conflict', reason: 'customer-claimed-by-other' });
  });

  it('conflicts when Stripe metadata already names another client', () => {
    const cust = customer('cus_1', { metadata: { tenant_id: T, client_id: 'c2', billing_profile_id: 'p2' } });
    expect(classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [cust], alga: alga() }).rows[0])
      .toMatchObject({ action: 'conflict', reason: 'customer-metadata-owned-by-other' });
  });

  it('conflicts when the profile is already mapped to a different customer (never orphans it)', () => {
    const state = alga({ mappings: [{ clientId: 'c1', billingProfileId: 'p1', customerId: 'cus_other' }] });
    expect(classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [customer('cus_1')], alga: state }).rows[0].reason).toBe('profile-mapped-to-other-customer');
  });

  it('conflicts on every row when the same cus_ appears twice in the input', () => {
    const { rows } = classifyImport({ rows: [row('a', 'c1', 'p1', 'cus_1'), row('b', 'c2', 'p2', 'cus_1')], customers: [customer('cus_1')], alga: alga() });
    expect(rows.map((r) => [r.action, r.reason])).toEqual([['conflict', 'duplicate-customer-in-input'], ['conflict', 'duplicate-customer-in-input']]);
  });

  it('conflicts when one profile is given two different customers', () => {
    const { rows } = classifyImport({ rows: [row('a', 'c1', 'p1', 'cus_1'), row('b', 'c1', 'p1', 'cus_2')], customers: [customer('cus_1'), customer('cus_2')], alga: alga() });
    expect(rows.every((r) => r.reason === 'duplicate-profile-in-input')).toBe(true);
  });

  it('skips non-card payment methods visibly with unsupported-method, never dropping them', () => {
    const cust = customer('cus_1', { paymentMethods: [pm('pm_1'), { id: 'pm_bank', type: 'us_bank_account', created: 1, metadata: {}, offSessionEvidence: false }] });
    const plan = classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [cust], alga: alga() }).rows[0];
    expect(plan.cards).toHaveLength(2);
    expect(plan.cards.find((c) => c.externalPaymentMethodId === 'pm_bank')).toMatchObject({ action: 'skip', reason: 'unsupported-method' });
  });

  it('skips expired cards visibly', () => {
    const cust = customer('cus_1', { paymentMethods: [pm('pm_1', { card: { brand: 'visa', last4: '1111', expMonth: 9, expYear: 2026, fingerprint: null } })] });
    const plan = classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [cust], alga: alga() }).rows[0];
    expect(plan.cards[0]).toMatchObject({ action: 'skip', reason: 'expired-card' });
    expect(plan.enrollable).toBe(false);
    expect(plan.warnings).toContain('no-importable-card');
  });

  it('flags SCA risk on imported cards without off-session evidence but still imports them', () => {
    const cust = customer('cus_1', { paymentMethods: [pm('pm_1', { offSessionEvidence: false })] });
    const card = classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [cust], alga: alga() }).rows[0].cards[0];
    expect(card).toMatchObject({ action: 'import', scaRisk: true });
  });

  it('respects non-USD billing currency and never assumes USD', () => {
    const eur = classifyImport({ rows: [row('r', 'c2', 'p2', 'cus_1')], customers: [customer('cus_1', { currency: 'eur' })], alga: alga() }).rows[0];
    expect(eur).toMatchObject({ action: 'adopt', currency: 'eur' });
    expect(eur.warnings).not.toContain('customer-currency-mismatch');
    const mismatch = classifyImport({ rows: [row('r', 'c2', 'p2', 'cus_1')], customers: [customer('cus_1', { currency: 'usd' })], alga: alga() }).rows[0];
    expect(mismatch.warnings).toContain('customer-currency-mismatch');
    const unsupported = alga({ profiles: [{ clientId: 'c2', billingProfileId: 'p2', clientName: 'G', profileName: 'D', isActive: true, currency: 'xof' }] });
    expect(classifyImport({ rows: [row('r', 'c2', 'p2', 'cus_1')], customers: [customer('cus_1')], alga: unsupported }).rows[0].reason).toBe('currency-unsupported');
    const none = alga({ profiles: [{ clientId: 'c2', billingProfileId: 'p2', clientName: 'G', profileName: 'D', isActive: true, currency: null }] });
    expect(classifyImport({ rows: [row('r', 'c2', 'p2', 'cus_1')], customers: [customer('cus_1')], alga: none }).rows[0].reason).toBe('currency-not-configured');
  });

  it('skips unknown, deleted, malformed customers and unknown profiles', () => {
    const { rows } = classifyImport({
      rows: [row('a', 'c1', 'p1', 'cus_missing'), row('b', 'c2', 'p2', 'cus_del'), row('c', 'c3', 'p3', 'nope'), row('d', 'cX', 'pX', 'cus_1')],
      customers: [customer('cus_del', { deleted: true })], alga: alga(),
    });
    expect(rows.map((r) => r.reason)).toEqual(['customer-not-found', 'customer-deleted', 'invalid-customer-id', 'profile-not-found']);
  });

  it('adopts a customer with no cards (mapping only)', () => {
    const plan = classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [customer('cus_1', { paymentMethods: [] })], alga: alga() }).rows[0];
    expect(plan).toMatchObject({ action: 'adopt', enrollable: false });
    expect(plan.warnings).toContain('no-cards');
  });

  it('does not offer enrollment when already enrolled', () => {
    const plan = classifyImport({ rows: [row('r', 'c1', 'p1', 'cus_1')], customers: [customer('cus_1')], alga: alga({ enrolledProfileIds: ['p1'] }) }).rows[0];
    expect(plan).toMatchObject({ alreadyEnrolled: true, enrollable: false });
  });
});

describe('proposeCustomerMatches', () => {
  const candidates = [
    { clientId: 'c1', billingProfileId: 'p1', clientName: 'Acme Corp', profileName: 'Default', email: 'AP@acme.test', mapped: false, clientActiveProfileCount: 1 },
    { clientId: 'c2', billingProfileId: 'p2', clientName: 'Globex Inc.', profileName: 'Default', email: null, mapped: false, clientActiveProfileCount: 1 },
    { clientId: 'c3', billingProfileId: 'p3', clientName: 'Multi', profileName: 'A', email: 'm@multi.test', mapped: false, clientActiveProfileCount: 2 },
  ];
  it('matches by email first (case-insensitive), then by normalised name', () => {
    const { proposals } = proposeCustomerMatches({
      customers: [customer('cus_1', { email: 'ap@ACME.test', name: 'Other' }), customer('cus_2', { email: null, name: 'globex inc' })],
      candidates,
    });
    expect(proposals).toEqual([
      expect.objectContaining({ customerId: 'cus_1', clientId: 'c1', matchedBy: 'email' }),
      expect.objectContaining({ customerId: 'cus_2', clientId: 'c2', matchedBy: 'name' }),
    ]);
  });
  it('reports ambiguity instead of guessing and skips already-mapped / excluded customers', () => {
    const { proposals, ambiguous } = proposeCustomerMatches({
      customers: [customer('cus_3', { email: 'm@multi.test' }), customer('cus_4', { email: 'ap@acme.test' }), customer('cus_5', { email: 'ap@acme.test' })],
      candidates, excludedCustomerIds: ['cus_4'],
    });
    expect(ambiguous).toEqual([expect.objectContaining({ customerId: 'cus_3', reason: 'multiple-profiles' })]);
    expect(proposals).toEqual([expect.objectContaining({ customerId: 'cus_5' })]);
    expect(proposeCustomerMatches({ customers: [customer('cus_1')], candidates: candidates.map((c) => ({ ...c, mapped: true })) }).proposals).toEqual([]);
  });
  it('treats two customers matching one profile as ambiguous for both', () => {
    const { proposals, ambiguous } = proposeCustomerMatches({ customers: [customer('cus_a', { email: 'ap@acme.test' }), customer('cus_b', { email: 'x', name: 'Acme Corp' })], candidates });
    expect(proposals).toEqual([]);
    expect(ambiguous.map((a) => a.reason)).toEqual(['multiple-customers', 'multiple-customers']);
  });
});

describe('import helpers', () => {
  it('parses CSV with and without header and resolves names', () => {
    expect(parseImportCsv('client,billing_profile,customer_id\n"Acme, Inc",Default,cus_1')).toEqual([{ client: 'Acme, Inc', profile: 'Default', customerId: 'cus_1', source: 'mapping' }]);
    expect(parseImportCsv('Acme,cus_9')).toEqual([{ client: 'Acme', profile: undefined, customerId: 'cus_9', source: 'mapping' }]);
    const resolved = resolveImportRows([{ client: 'acme', customerId: 'cus_1' }, { client: 'nobody', customerId: 'cus_2' }], alga().profiles);
    expect(resolved[0]).toMatchObject({ clientId: 'c1', billingProfileId: 'p1' });
    expect(resolved[1]).toMatchObject({ clientId: '', billingProfileId: '' });
  });
  it('derives off-session evidence from succeeded setup/payment intents only', () => {
    const ev = offSessionEvidence(
      [{ status: 'succeeded', usage: 'off_session', payment_method: 'pm_a' }, { status: 'succeeded', usage: 'on_session', payment_method: 'pm_b' }, { status: 'canceled', usage: 'off_session', payment_method: 'pm_c' }] as any,
      [{ status: 'succeeded', setup_future_usage: 'off_session', payment_method: 'pm_d' }, { status: 'succeeded', setup_future_usage: null, payment_method: 'pm_e' }] as any,
    );
    expect([...ev].sort()).toEqual(['pm_a', 'pm_d']);
  });
  it('parks cards on authentication_required and hard declines only', () => {
    expect(shouldParkPaymentMethod('authentication_required')).toBe(true);
    expect(shouldParkPaymentMethod('card_declined', 'authentication_required')).toBe(true);
    expect(shouldParkPaymentMethod(undefined, undefined, false, true)).toBe(true);
    expect(shouldParkPaymentMethod('card_declined', 'insufficient_funds')).toBe(false);
    expect(shouldParkPaymentMethod('card_declined', 'stolen_card', true)).toBe(true);
  });
});
