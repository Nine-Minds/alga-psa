/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientPortalSettingsPage from './ClientPortalSettingsPage';

const permsMock = vi.hoisted(() => vi.fn());
const searchMock = vi.hoisted(() => ({ tab: null as string | null }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'tab' ? searchMock.tab : null) }),
}));
vi.mock('../../actions/client-portal-actions/clientUserActions', () => ({
  checkClientPortalPermissions: (...a: unknown[]) => permsMock(...a),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({ default: () => <div>loading</div> }));
vi.mock('@alga-psa/ui', () => ({ DrawerProvider: ({ children }: any) => <>{children}</>, DrawerOutlet: () => null }));
vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  CustomTabs: ({ tabs, defaultTab }: any) => (
    <div data-testid="tabs" data-active={defaultTab}>
      {tabs.map((t: any) => <span key={t.id} data-testid={`tab-${t.id}`}>{t.label}</span>)}
      {tabs.find((t: any) => t.id === defaultTab)?.content}
    </div>
  ),
}));
vi.mock('./ClientDetailsSettings', () => ({ ClientDetailsSettings: () => <div>details-body</div> }));
vi.mock('./UserManagementSettings', () => ({ UserManagementSettings: () => <div>users-body</div> }));
vi.mock('./VisibilityGroupsSettings', () => ({ VisibilityGroupsSettings: () => <div>vis-body</div> }));
vi.mock('../account/ClientAccount', () => ({
  default: (props: any) => <div data-testid="account" data-plan={String(props.showPlanCard)} data-inv={String(props.showInvoicesCard)} />,
}));

const base = { hasBillingAccess: false, hasClientReadAccess: false, hasUserManagementAccess: false, hasVisibilityGroupAccess: false };
const tabIds = () => screen.getAllByTestId(/^tab-/).map((e) => e.getAttribute('data-testid')!.slice(4));

describe('ClientPortalSettingsPage', () => {
  beforeEach(() => { searchMock.tab = null; permsMock.mockReset(); });
  afterEach(cleanup);

  it('shows no tabs before permissions load', () => {
    permsMock.mockReturnValue(new Promise(() => {}));
    render(<ClientPortalSettingsPage />);
    expect(screen.queryByTestId('tabs')).toBeNull();
  });

  it('tab list matches the resolver (Admin)', async () => {
    permsMock.mockResolvedValue({ ...base, hasBillingAccess: true, hasClientReadAccess: true, hasUserManagementAccess: true, hasVisibilityGroupAccess: true });
    render(<ClientPortalSettingsPage />);
    await waitFor(() => screen.getByTestId('tabs'));
    expect(tabIds()).toEqual(['account', 'client-details', 'user-management', 'visibility-groups']);
    expect(screen.getByTestId('tabs').getAttribute('data-active')).toBe('account');
    expect(screen.getByTestId('account').getAttribute('data-plan')).toBe('true');
  });

  it('User with ?tab=account lands on client-details', async () => {
    searchMock.tab = 'account';
    permsMock.mockResolvedValue({ ...base, hasClientReadAccess: true });
    render(<ClientPortalSettingsPage />);
    await waitFor(() => screen.getByTestId('tabs'));
    expect(tabIds()).toEqual(['client-details']);
    expect(screen.getByTestId('tabs').getAttribute('data-active')).toBe('client-details');
    expect(screen.queryByTestId('account')).toBeNull();
  });

  it('non-admin with ?tab=user-management is coerced', async () => {
    searchMock.tab = 'user-management';
    permsMock.mockResolvedValue({ ...base, hasClientReadAccess: true, hasBillingAccess: true });
    render(<ClientPortalSettingsPage />);
    await waitFor(() => screen.getByTestId('tabs'));
    expect(screen.getByTestId('tabs').getAttribute('data-active')).toBe('account');
    expect(screen.queryByText('users-body')).toBeNull();
  });
});
