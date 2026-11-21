// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, renderHook } from '@testing-library/react';

// Un-mocked: in the server test host '@enterprise' resolves to the community stubs (packages/ee/src).
import { resolveCoManagedPurchaseDiscovery } from '@enterprise/lib/co-managed/purchaseDiscovery';
import { getCoManagedPurchaseDiscoveryAction } from '@enterprise/lib/actions/coManagedPurchaseDiscoveryActions';
import { useCoManagedPurchaseNavigation } from '@enterprise/components/co-managed/useCoManagedPurchaseNavigation';
import CoManagedPurchaseOverview from '@enterprise/components/co-managed/CoManagedPurchaseOverview';
import CoManagedPurchasePool from '@enterprise/components/co-managed/CoManagedPurchasePool';

const saved = { force: process.env.FORCE_CAPABILITIES, price: process.env.STRIPE_CO_MANAGED_USER_PRICE_ID };
beforeEach(() => {
  process.env.FORCE_CAPABILITIES = 'co-managed:on';
  process.env.STRIPE_CO_MANAGED_USER_PRICE_ID = 'price_configured';
});
afterEach(() => {
  cleanup();
  if (saved.force === undefined) delete process.env.FORCE_CAPABILITIES; else process.env.FORCE_CAPABILITIES = saved.force;
  if (saved.price === undefined) delete process.env.STRIPE_CO_MANAGED_USER_PRICE_ID; else process.env.STRIPE_CO_MANAGED_USER_PRICE_ID = saved.price;
});

describe('community edition: first-purchase discovery is inert even with a forced flag and a configured price', () => {
  it('the commercial decision is closed for a fully privileged internal administrator', async () => {
    expect(await resolveCoManagedPurchaseDiscovery({ user_type: 'internal', tenant: 't1' }, 't1')).toEqual({ eligible: false, reason: 'edition' });
    expect(await getCoManagedPurchaseDiscoveryAction()).toBe(false);
  });

  it('contributes no navigation and renders no purchase view', () => {
    expect(renderHook(() => useCoManagedPurchaseNavigation()).result.current).toBeNull();
    expect(render(<CoManagedPurchaseOverview />).container).toBeEmptyDOMElement();
    expect(render(<CoManagedPurchasePool />).container).toBeEmptyDOMElement();
  });
});
