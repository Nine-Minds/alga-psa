/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CoManagedEffortSummary } from '../../../components/co-managed/CoManagedEffortSummary';

const mocks = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn(), session: vi.fn(), profile: vi.fn() }));
vi.mock('next-auth/react', () => ({ useSession: mocks.session, signOut: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useCapability: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedTimeActions', () => ({ getSharedEffortTotalsAction: mocks.load }));
vi.mock('../../../components/co-managed/CoManagedTimeBillingProfile', () => ({ default: (props: any) => { mocks.profile(props); return <div data-testid="billing-profile" />; } }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, values?: any) => values ? `${values.value} hours` : key }),
  useOptionalI18n: () => null, useFormatters: () => ({ formatNumber: (value: number) => String(value) }) }));
const resource = { tenant: 'customer-a', relationshipId: 'relationship-a', kind: 'ticket' as const, id: 'ticket-a' };
const shared = { kind: 'shared' as const, resource };
const totals = { resource, customerMinutes: 30, mspMinutes: 60, combinedMinutes: 90 };
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockReturnValue({ status: 'authenticated', data: { user: { id: 'user-a', tenant: 'home-a' } } }); mocks.flag.mockReturnValue({ enabled: true, admitted: true, resolved: true }); mocks.load.mockResolvedValue(totals); });
afterEach(cleanup);

it('shows the customer, MSP and combined split inline and reloads when the save key bumps', async () => {
  const view = render(<CoManagedEffortSummary target={shared} refreshKey={0} />);
  await screen.findByText('1.5 hours'); expect(screen.getByText('0.5 hours')).toBeInTheDocument(); expect(screen.getByText('1 hours')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
  mocks.load.mockResolvedValue({ ...totals, mspMinutes: 120, combinedMinutes: 150 });
  view.rerender(<CoManagedEffortSummary target={shared} refreshKey={1} />);
  await screen.findByText('2.5 hours'); expect(mocks.load).toHaveBeenCalledTimes(2); expect(mocks.load).toHaveBeenLastCalledWith(shared);
});
it('reads a customer-side ticket from its local target and never offers the MSP billing profile', async () => {
  const local = { kind: 'local_task' as const, taskId: 'task-a' };
  render(<CoManagedEffortSummary target={local} billingProfile />);
  await screen.findByText('1.5 hours'); expect(mocks.load).toHaveBeenCalledWith(local); expect(screen.queryByTestId('billing-profile')).toBeNull();
});
it('offers the billing profile for shared work only when asked, and passes the disabled state through', async () => {
  const view = render(<CoManagedEffortSummary target={shared} />);
  await screen.findByText('1.5 hours'); expect(screen.queryByTestId('billing-profile')).toBeNull();
  view.rerender(<CoManagedEffortSummary target={shared} billingProfile billingProfileDisabled />);
  expect(screen.getByTestId('billing-profile')).toBeInTheDocument(); expect(mocks.profile.mock.lastCall![0]).toMatchObject({ resource, disabled: true });
});
it('renders nothing and does not fetch while the capability is off', () => {
  mocks.flag.mockReturnValue({ enabled: false, admitted: false, resolved: true }); const view = render(<CoManagedEffortSummary target={shared} billingProfile />);
  expect(view.container.textContent).toBe(''); expect(mocks.load).not.toHaveBeenCalled(); expect(screen.queryByTestId('billing-profile')).toBeNull();
});
