/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('../../../lib/actions/coManagedTimeActions', () => ({ getSharedTimeBillingProfileAction: mocks.get, setSharedTimeBillingProfileAction: mocks.set }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: (props: any) => <select aria-label={props.label} id={props.id}
  value={props.value} disabled={props.disabled} onChange={event => props.onValueChange(event.target.value)}>
  {props.options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
</select> }));
import Profile from '../../../components/co-managed/CoManagedTimeBillingProfile';
const resource = { kind: 'ticket' as const, tenant: 'customer', relationshipId: 'relationship', id: 'ticket' };
const initial = { clientId: 'msp-client', profileId: null, profiles: ['default', 'project'].map((billing_profile_id, index) => ({
  billing_profile_id, client_id: 'msp-client', name: billing_profile_id, is_default: index === 0, is_active: true, is_system_managed_default: false })) };
const busy = vi.fn();
const mount = () => render(<Profile resource={resource} disabled={false} onBusyChange={busy} />);
beforeEach(() => { vi.resetAllMocks(); mocks.get.mockResolvedValue(initial); mocks.set.mockResolvedValue({ profileId: 'project' }); });
afterEach(cleanup);
it('uses the native segmented-client picker and qualified soft-default command', async () => {
  mount(); const picker = await screen.findByRole('combobox');
  expect(mocks.get).toHaveBeenCalledWith(resource);
  fireEvent.change(picker, { target: { value: 'project' } });
  await waitFor(() => expect(mocks.set).toHaveBeenCalledWith(resource, { expectedProfileId: null, profileId: 'project' }));
  await waitFor(() => expect(picker).toHaveValue('project'));
  fireEvent.change(picker, { target: { value: '__unassigned__' } });
  await waitFor(() => expect(mocks.set).toHaveBeenLastCalledWith(resource, { expectedProfileId: 'project', profileId: null }));
  expect(busy).toHaveBeenCalledWith(true); await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
});
it.each([null, { ...initial, profiles: initial.profiles.slice(0, 1) }])('does not show a picker without authorized segmented profiles: %j', async state => {
  mocks.get.mockResolvedValue(state); await act(async () => { mount(); }); expect(screen.queryByRole('combobox')).toBeNull();
  expect(mocks.get).toHaveBeenCalledWith(resource);
});
it('disables profile edits while the native time dialog or preparation is active', async () => {
  render(<Profile resource={resource} disabled onBusyChange={busy} />);
  expect(await screen.findByRole('combobox')).toBeDisabled(); expect(mocks.set).not.toHaveBeenCalled();
});
it('reloads authority after a conflict and keeps denied profile data off the screen', async () => {
  mount(); const picker = await screen.findByRole('combobox');
  mocks.set.mockRejectedValue(new Error('Conflict')); mocks.get.mockResolvedValue(null);
  fireEvent.change(picker, { target: { value: 'project' } });
  await screen.findByRole('alert'); await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('combobox')).toBeNull(); await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
});
it('does not show a previous workspace profile when a delayed request completes after navigation', async () => {
  let finish!: (value: any) => void;
  mocks.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = mount(); mocks.get.mockResolvedValue(null);
  view.rerender(<Profile resource={{ ...resource, tenant: 'other-customer' }} disabled={false} onBusyChange={busy} />);
  await act(async () => finish(initial)); expect(screen.queryByRole('combobox')).toBeNull();
});
