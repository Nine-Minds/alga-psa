import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({ getServerTranslation: async () => ({ t: (_k: string, o?: any) => o?.defaultValue }) }));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/auth')>(),
  getSession: vi.fn(async () => ({ user: { tenant: 'msp-tenant' } })),
}));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForPage: vi.fn(async () => undefined) }));
vi.mock('@/components/co-managed/CoManagedFeatureBoundary', () => ({ CoManagedFeatureBoundary: () => null }));
vi.mock('@/components/co-managed/SharedTicketScreen', () => ({ default: () => null }));
vi.mock('@/components/co-managed/CustomerTicketsUnavailable', () => ({ default: () => null }));
vi.mock('@/lib/actions/coManagedSharedWorkActions', () => ({ getSharedTicketDetailsAction: vi.fn().mockResolvedValue(null) }));

import Page from '@/app/msp/co-management/tickets/[customerTenant]/[relationshipId]/[ticketId]/page';
import { CoManagedFeatureBoundary } from '@/components/co-managed/CoManagedFeatureBoundary';
import CustomerTicketsUnavailable from '@/components/co-managed/CustomerTicketsUnavailable';
import { requireCapabilityForPage } from '@alga-psa/core/capability/server';
import { getSharedTicketDetailsAction } from '@/lib/actions/coManagedSharedWorkActions';

describe('shared-ticket route kill switch', () => {
  it('closed capability shows the same unavailable fallback and mode as the queue route, not an empty body', async () => {
    const element: any = await Page({ params: Promise.resolve({ customerTenant: 't', relationshipId: 'r', ticketId: 'k' }), searchParams: Promise.resolve({}) });
    expect(element.type).toBe(CoManagedFeatureBoundary);
    expect(element.props.mode).toBe('serves');
    expect(element.props.fallback.type).toBe(CustomerTicketsUnavailable);
    expect(requireCapabilityForPage).toHaveBeenCalledWith('co-managed', 'msp-tenant', 'serves');
  });

  it('does not read shared ticket data when the server capability gate denies access', async () => {
    vi.clearAllMocks();
    vi.mocked(requireCapabilityForPage).mockRejectedValueOnce(new Error('capability denied'));
    await expect(Page({
      params: Promise.resolve({ customerTenant: 'customer', relationshipId: 'relationship', ticketId: 'ticket' }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow('capability denied');
    expect(getSharedTicketDetailsAction).not.toHaveBeenCalled();
  });
});
