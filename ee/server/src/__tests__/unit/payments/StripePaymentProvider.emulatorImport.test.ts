import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import stripeEmulator from '../../../../../../packages/emulators/stripe/src/index';
import { StripePaymentProvider } from '../../../lib/payments/StripePaymentProvider';
import { classifyImport, importMetadata } from '../../../lib/payments/stripeImportClassifier';

const { config, secrets } = vi.hoisted(() => ({
  config: { credentials_vault_path: 'tenant/review/stripe_payment_secret_key', configuration: { publishable_key: 'pk_test_algasim', stripe_account_id: 'acct_review_4089' } },
  secrets: { getTenantSecret: vi.fn(async (_tenant: string, name: string) => name === 'stripe_payment_secret_key' ? 'sk_test_algasim' : 'whsec_algasim') },
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({})),
  tenantDb: vi.fn(() => ({ table: () => ({ where: () => ({ first: async () => config }) }) })),
}));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: vi.fn(async () => secrets) }));

let host: EmulatorHost;
let stripeBase: string;
let controlBase: string;
const originalBaseUrl = process.env.STRIPE_API_BASE_URL;

async function control(path: string, body: unknown = {}) {
  const response = await fetch(`${controlBase}/control/stripe/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json() as any;
  if (!response.ok || !result.ok) throw new Error(`${path}: ${JSON.stringify(result)}`);
  return result.result;
}

describe('StripePaymentProvider against repository emulator', () => {
  beforeAll(async () => {
    host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 }, log() {} });
    const addresses = await host.start();
    stripeBase = `http://127.0.0.1:${addresses.ports.stripe}`;
    controlBase = `http://127.0.0.1:${addresses.controlPort}`;
    process.env.STRIPE_API_BASE_URL = stripeBase;
    await control('seed/config', { secretKey: 'sk_test_algasim', accountId: 'acct_review_4089' });
    await control('seed/customer', { id: 'cus_review4089legacy', email: 'legacy@example.invalid', name: 'Legacy Customer' });
    await control('seed/payment-method', { id: 'pm_review4089legacy', customer: 'cus_review4089legacy', isDefault: true, offSession: true });
    await control('seed/customer', {
      id: 'cus_review4089conflict', email: 'conflict@example.invalid', name: 'Other Tenant Customer',
      metadata: { tenant_id: 'tenant_other', stripe_account_id: 'acct_review_4089' },
    });
    await control('seed/payment-method', { id: 'pm_review4089conflict', customer: 'cus_review4089conflict', isDefault: true, offSession: true });
  });

  afterAll(async () => {
    await host?.stop();
    if (originalBaseUrl === undefined) delete process.env.STRIPE_API_BASE_URL;
    else process.env.STRIPE_API_BASE_URL = originalBaseUrl;
  });

  it('loads realistic legacy/conflict card snapshots and stamps through Stripe SDK mutations', async () => {
    const provider = new StripePaymentProvider('review');
    expect(await provider.getVerifiedAccountId()).toBe('acct_review_4089');
    const legacy = await provider.getCustomerImportSnapshot('cus_review4089legacy');
    const conflict = await provider.getCustomerImportSnapshot('cus_review4089conflict');
    expect(legacy).toMatchObject({
      id: 'cus_review4089legacy', defaultPaymentMethodId: 'pm_review4089legacy',
      metadata: {}, paymentMethods: [{ id: 'pm_review4089legacy', type: 'card', offSessionEvidence: true }],
    });
    expect(conflict?.metadata.tenant_id).toBe('tenant_other');

    const now = new Date('2026-11-02T00:00:00Z');
    const alga = {
      tenantId: 'tenant_review', accountId: 'acct_review_4089', now, supportedCurrencies: ['USD'],
      profiles: [{ clientId: 'client_review', billingProfileId: 'profile_review', clientName: 'Review Client', profileName: 'Default', isActive: true, currency: 'usd' }],
      mappings: [], paymentMethods: [], enrolledProfileIds: [],
    };
    expect(classifyImport({ rows: [{ rowId: 'legacy', clientId: 'client_review', billingProfileId: 'profile_review', customerId: legacy!.id }], customers: [legacy!], alga }).rows[0])
      .toMatchObject({ action: 'adopt', needsCustomerStamp: true, cards: [{ action: 'import', setAsDefault: true, scaRisk: false }] });
    expect(classifyImport({ rows: [{ rowId: 'conflict', clientId: 'client_review', billingProfileId: 'profile_review', customerId: conflict!.id }], customers: [conflict!], alga }).rows[0])
      .toMatchObject({ action: 'conflict', reason: 'customer-metadata-owned-by-other' });

    const stamp = importMetadata('tenant_review', 'client_review', 'profile_review', 'acct_review_4089');
    await provider.updateCustomerMetadata(legacy!.id, stamp, 'review-import-attempt-1');
    await provider.updateSavedPaymentMethodMetadata('pm_review4089legacy', stamp);
    const stamped = await provider.getCustomerImportSnapshot(legacy!.id);
    expect(stamped?.metadata).toMatchObject(stamp);
    expect(stamped?.paymentMethods[0].metadata).toMatchObject(stamp);
    expect(classifyImport({ rows: [{ rowId: 'again', clientId: 'client_review', billingProfileId: 'profile_review', customerId: legacy!.id }], customers: [stamped!], alga: {
      ...alga,
      mappings: [{ clientId: 'client_review', billingProfileId: 'profile_review', customerId: legacy!.id, accountId: 'acct_review_4089' }],
      paymentMethods: [{ paymentMethodId: 'local-pm', externalPaymentMethodId: 'pm_review4089legacy', clientId: 'client_review', billingProfileId: 'profile_review', isDefault: true, isDeleted: false, status: 'active' }],
    } }).rows[0].action).toBe('already-imported');
  });
});
