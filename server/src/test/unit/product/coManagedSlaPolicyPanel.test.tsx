/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedSlaPolicyPanel from '../../../components/co-managed/CoManagedSlaPolicyPanel';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedPolicyActions', () => ({ getCoManagedSlaPolicyScreen: mocks.load, saveCoManagedSlaPriorityMappings: mocks.save }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, disabled, options, onValueChange }: any) =>
  <label>{label}<select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
    {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, options?: { name?: string }) => options?.name ? `${key}: ${options.name}` : key }), useOptionalI18n: () => null }));
const data = () => ({ revision: 4, canWrite: true, policyName: 'MSP support policy',
  customerPriorities: [{ priority_id: 'customer-high', priority_name: 'Urgent' }],
  mspPriorities: [{ priority_id: 'msp-p1', priority_name: 'MSP P1' }, { priority_id: 'msp-p2', priority_name: 'MSP P2' }],
  mappings: [{ customerPriorityId: 'customer-high', mspPriorityId: 'msp-p1' }] });
const mount = (operationId = 'provisioning-a') => render(<CoManagedFeatureBoundary><CoManagedSlaPolicyPanel operationId={operationId} /></CoManagedFeatureBoundary>);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
beforeEach(() => { vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null }); mocks.load.mockResolvedValue(data()); mocks.save.mockResolvedValue({ revision: 5 }); });
afterEach(cleanup);
it.each([{ enabled: false }, { enabled: undefined }, { enabled: true, loading: true }, { enabled: true, error: new Error('unavailable') }])('keeps SLA setup dormant when the UI flag is unresolved or off: %j', flag => {
  mocks.flag.mockReturnValue(flag); mount(); expect(mocks.load).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull();
});
it('saves explicit mapping with the loaded revision and reloads the current policy', async () => {
  mount(); const select = await screen.findByLabelText('coManaged.sla.mappingFor: Urgent'); expect(select).toHaveValue('msp-p1');
  fireEvent.change(select, { target: { value: 'msp-p2' } }); fireEvent.click(screen.getByRole('button', { name: 'coManaged.policy.save' }));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(mocks.save).toHaveBeenCalledWith({ operationId: 'provisioning-a', revision: 4, mappings: [{ customerPriorityId: 'customer-high', mspPriorityId: 'msp-p2' }] });
});
it('freezes an uncertain save and retries exactly, while reload permits revision recovery', async () => {
  mocks.save.mockRejectedValueOnce(new Error('Lost response')); mount(); const select = await screen.findByLabelText('coManaged.sla.mappingFor: Urgent');
  fireEvent.change(select, { target: { value: 'none' } }); fireEvent.click(screen.getByRole('button', { name: 'coManaged.policy.save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.policy.saveError'); expect(select).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.policy.retry' })); await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1]).toEqual(mocks.save.mock.calls[0]); expect(mocks.save.mock.calls[0][0].mappings).toEqual([]);
});
it('keeps lapsed configuration readable while disabling mutation', async () => {
  mocks.load.mockResolvedValue({ ...data(), canWrite: false }); mount();
  expect(await screen.findByLabelText('coManaged.sla.mappingFor: Urgent')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'coManaged.policy.save' })).toBeDisabled(); expect(mocks.save).not.toHaveBeenCalled();
});
it('shows missing policy setup and discards late data after changing customer', async () => {
  const pending = deferred<any>(); mocks.load.mockReturnValueOnce(pending.promise); const view = mount();
  mocks.load.mockResolvedValue({ ...data(), policyName: null });
  view.rerender(<CoManagedFeatureBoundary><CoManagedSlaPolicyPanel operationId="provisioning-b" /></CoManagedFeatureBoundary>);
  await screen.findByText('coManaged.sla.missingPolicy');
  await act(async () => pending.resolve({ ...data(), policyName: 'Private old customer' })); expect(screen.queryByText('Private old customer')).toBeNull();
  expect(screen.getByRole('link', { name: 'coManaged.sla.settings' })).toHaveAttribute('href', '/msp/settings/sla');
});
