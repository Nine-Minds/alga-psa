import { describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ whereRaw: [] as string[], subscriptions: [] as any[] }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      const chain: any = {
        where: () => chain, orderBy: () => chain, forShare: () => chain,
        whereRaw: (sql: string) => { captured.whereRaw.push(sql); return chain; },
        select: async () => name === 'stripe_subscriptions' ? captured.subscriptions : [],
        first: async () => ({ stripe_customer_id: 'c', stripe_customer_external_id: 'cus_1' }),
      };
      return chain;
    },
    unscoped: () => ({ where: () => ({ forShare: () => ({ first: async () => ({ stripe_price_id: 'p', stripe_price_external_id: 'price_psa' }) }) }) }),
  }),
}));

import { retainHostedPsaUpgradeCandidate, HostedPsaUpgradeAdmissionError } from '../hosted-psa-upgrade';

const TENANT = '00000000-0000-4000-8000-0000000000c1';
const subscription = (id: string) => ({ stripe_subscription_id: id, stripe_subscription_external_id: `sub_${id}`, stripe_customer_id: 'c',
  stripe_price_id: 'p', stripe_subscription_item_id: 'si_1', quantity: 3, status: 'active',
  current_period_end: new Date(Date.now() + 86_400_000), metadata: { tenant_id: TENANT } });
function trx(licenseState: unknown = undefined) {
  const t: any = (table: string) => ({ first: async () => table === 'license_state' ? licenseState : undefined });
  t.isTransaction = true;
  t.raw = () => 'clock';
  t.select = () => ({ first: async () => ({ at: new Date().toISOString() }) });
  return t;
}

describe('retainHostedPsaUpgradeCandidate (A3: entitlement isolation)', () => {
  it('excludes add-ons and co-managed subscriptions in the query itself', async () => {
    captured.whereRaw.length = 0; captured.subscriptions = [subscription('1')];
    await retainHostedPsaUpgradeCandidate(trx(), TENANT, ['price_psa']);
    expect(captured.whereRaw.join(' ')).toContain("subscription_kind");
    expect(captured.whereRaw.join(' ')).toContain("<> 'co_managed'");
    expect(captured.whereRaw.join(' ')).toContain('addon_key');
  });

  it('accepts exactly one active candidate', async () => {
    captured.subscriptions = [subscription('1')];
    await expect(retainHostedPsaUpgradeCandidate(trx(), TENANT, ['price_psa'])).resolves.toMatchObject({ subscriptionId: 'sub_1', seats: 3 });
  });

  it('refuses two candidates', async () => {
    captured.subscriptions = [subscription('1'), subscription('2')];
    await expect(retainHostedPsaUpgradeCandidate(trx(), TENANT, ['price_psa'])).rejects.toBeInstanceOf(HostedPsaUpgradeAdmissionError);
  });

  it('refuses when only a co-managed subscription exists (the query returns no candidate)', async () => {
    captured.subscriptions = [];
    await expect(retainHostedPsaUpgradeCandidate(trx(), TENANT, ['price_psa'])).rejects.toThrow(/Exactly one/);
  });

  it('refuses a self-host installation', async () => {
    captured.subscriptions = [subscription('1')];
    await expect(retainHostedPsaUpgradeCandidate(trx({ id: 1 }), TENANT, ['price_psa'])).rejects.toThrow(/self-host/);
  });
});
