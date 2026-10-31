/** @vitest-environment jsdom */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  product: 'co_managed', gate: vi.fn(async () => undefined), screen: vi.fn(),
}));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { tenant: 't', id: 'u' } }, update: vi.fn() }) }));
vi.mock('@alga-psa/auth', () => ({ getSession: vi.fn(async () => ({ user: { tenant: 'tenant-1' } })) }));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForPage: mocks.gate }));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerTranslation: async () => ({ t: (_k: string, o: any) => o?.defaultValue ?? _k }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/context/ProductContext', () => ({ useProduct: () => ({ productCode: mocks.product }) }));
vi.mock('@/components/co-managed/CoManagedFeatureBoundary', () => ({ CoManagedFeatureBoundary: ({ children }: any) => <>{children}</> }));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, asChild, ...rest }: any) => asChild ? <>{children}</> : <button {...rest}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Card', () => ({ Card: (p: any) => <div>{p.children}</div>, CardHeader: (p: any) => <div>{p.children}</div>,
  CardTitle: (p: any) => <h1>{p.children}</h1>, CardDescription: (p: any) => <p>{p.children}</p>, CardContent: (p: any) => <div>{p.children}</div> }));
vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('@ee/lib/actions/coManagedUpgradeActions', () => ({
  getCoManagedUpgradeScreenAction: mocks.screen, startCoManagedUpgradeAction: vi.fn(),
  purchaseCoManagedUpgradeAction: vi.fn(), retryCoManagedUpgradePaymentAction: vi.fn(), manageCoManagedUpgradeBillingAction: vi.fn(),
}));
vi.mock('../../../components/co-managed/CoManagedUpgradePurchase', () => ({ default: () => <div data-testid="purchase" /> }));
vi.mock('../../../components/co-managed/CoManagedUpgradeBilling', () => ({ default: () => <div data-testid="billing" /> }));

import CoManagedUpgrade, { CoManagedUpgradeEntry } from '../../../components/co-managed/CoManagedUpgrade';
import CoManagedUpgradePage from '../../../app/msp/co-management/upgrade/page';

const eligible = (over: Record<string, unknown> = {}) => ({ state: 'eligible', relationshipId: 'r', revision: 2, departed: false, selfHosted: false,
  purchaseConfigured: true, seatsRequired: 3, entitlementReady: false, pendingPurchase: null, hasOwnBilling: false, paidSeats: null, progress: 'idle', ...over });

beforeEach(() => { mocks.product = 'co_managed'; mocks.gate.mockReset(); mocks.gate.mockResolvedValue(undefined); mocks.screen.mockReset(); });

describe('co-managed independent upgrade UI', () => {
  it('the entry point exists for a co_managed workspace only', () => {
    const { container, rerender } = render(<CoManagedUpgradeEntry />);
    expect(container.querySelector('a[href="/msp/co-management/upgrade"]')).not.toBeNull();
    mocks.product = 'psa';
    rerender(<CoManagedUpgradeEntry />);
    expect(container.querySelector('a')).toBeNull();
  });

  it('the route is gated by the capability gate: a closed gate makes the page unreachable', async () => {
    await expect(CoManagedUpgradePage()).resolves.toBeTruthy();
    expect(mocks.gate).toHaveBeenCalledWith('co-managed', 'tenant-1', 'serves');
    mocks.gate.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    await expect(CoManagedUpgradePage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders the purchase only when a price is configured', async () => {
    mocks.screen.mockResolvedValue(eligible({ purchaseConfigured: true }));
    const first = render(<CoManagedUpgrade />);
    await waitFor(() => expect(screen.getByTestId('purchase')).toBeTruthy());
    first.unmount();
    mocks.screen.mockResolvedValue(eligible({ purchaseConfigured: false }));
    render(<CoManagedUpgrade />);
    await waitFor(() => expect(screen.getByText('coManaged.upgrade.purchaseUnconfigured')).toBeTruthy());
    expect(screen.queryByTestId('purchase')).toBeNull();
  });

  it('self-hosted workspaces get licence activation, not a hosted purchase', async () => {
    mocks.screen.mockResolvedValue(eligible({ selfHosted: true }));
    render(<CoManagedUpgrade />);
    await waitFor(() => expect(screen.getByText('coManaged.upgrade.licenseRequired')).toBeTruthy());
    expect(screen.queryByTestId('purchase')).toBeNull();
  });

  it('shows no raw ids and hardcodes no currency in the upgrade screens', () => {
    for (const file of ['CoManagedUpgrade', 'CoManagedUpgradeBilling', 'CoManagedUpgradePurchase']) {
      const source = readFileSync(resolve(process.cwd(), `src/components/co-managed/${file}.tsx`), 'utf8');
      expect(source).not.toMatch(/['"`]USD['"`]/);
      expect(source).not.toMatch(/\{\s*(screen\.)?(relationshipId|operationId)\s*\}/);
    }
  });
});
