/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoManagedPolicyPanel from '../../../components/co-managed/CoManagedPolicyPanel';
import { CoManagedFeatureBoundary } from '../../../components/co-managed/CoManagedFeatureBoundary';
const mocks = vi.hoisted(() => ({ flag: vi.fn(), load: vi.fn(), search: vi.fn(), customer: vi.fn(), sponsor: vi.fn() }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('../../../lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('../../../lib/actions/coManagedPolicyActions', () => ({ getCoManagedPolicyScreen: mocks.load,
  searchCoManagedPolicyOptions: mocks.search, saveCustomerCoManagedScope: mocks.customer, saveSponsorCoManagedAssignments: mocks.sponsor }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, disabled, options, onValueChange }: any) =>
  <label>{label}<select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
    <option value="">Choose</option>{options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label> }));
const translate = (key: string, options?: { name?: string }) => options?.name ? `${key}: ${options.name}` : key;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: translate }), useOptionalI18n: () => null }));
const policy = { revision: 2, visibilityMode: 'board_scope', boards: [{ id: 'board', canCollaborate: true }], projects: [], assignments: [] };
const customerScreen = () => ({ side: 'customer', counterpartName: 'Our MSP', canExpand: true, policy: structuredClone(policy),
  labels: { board: [{ id: 'board', name: 'Service desk' }], project: [], user: [], team: [] } });
const sponsorScreen = (name = 'Customer A') => ({ ...customerScreen(), side: 'sponsor', counterpartName: name });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
beforeEach(() => {
  vi.resetAllMocks(); mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null });
  mocks.load.mockResolvedValue(customerScreen()); mocks.search.mockResolvedValue({ options: [], hasMore: false });
  mocks.customer.mockResolvedValue({ revision: 3 }); mocks.sponsor.mockResolvedValue({ revision: 3 });
});
afterEach(cleanup);
const button = (name: string) => screen.getByRole('button', { name: `coManaged.policy.${name}` });
const mount = (operationId?: string) => render(<CoManagedFeatureBoundary><CoManagedPolicyPanel operationId={operationId} /></CoManagedFeatureBoundary>);

describe('co-managed access editor', () => {
  it('keeps all policy controls and reads behind the UI release flag', () => {
    mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null }); mount();
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.search).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull();
    expect(mocks.flag).toHaveBeenCalledWith('release-v1-6-feature', { defaultValue: false });
  });

  it('lets customers edit local scope and retries an immutable submission after response loss', async () => {
    const result = deferred<{ revision: number }>(); mocks.customer.mockReturnValueOnce(result.promise);
    mount(); await screen.findByText('Our MSP');
    expect(screen.queryByText('coManaged.policy.kinds.user')).toBeNull();
    fireEvent.change(screen.getByLabelText('coManaged.provisioning.visibility'), { target: { value: 'escalation_only' } });
    fireEvent.click(button('save'));
    expect(mocks.customer).toHaveBeenCalledWith({ revision: 2, scope: { visibilityMode: 'escalation_only', boards: [], projects: [] } });
    expect(mocks.sponsor).not.toHaveBeenCalled();
    await act(async () => result.reject(new Error('Lost acknowledgement')));
    expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.policy.saveError');
    expect(screen.getByLabelText('coManaged.provisioning.visibility')).toBeDisabled();
    const updated = customerScreen(); updated.policy.revision = 3; mocks.load.mockResolvedValue(updated);
    fireEvent.click(button('retry'));
    await screen.findByText('coManaged.policy.saved');
    expect(mocks.customer.mock.calls[1]).toEqual(mocks.customer.mock.calls[0]);
    expect(screen.getByLabelText('coManaged.provisioning.visibility')).toBeEnabled();
  });

  it('lets MSPs search home staff while displaying approved customer scope without an editor', async () => {
    mocks.load.mockResolvedValue(sponsorScreen());
    mocks.search.mockImplementation(async ({ kind }: { kind: string }) => ({ options: kind === 'user' ? [{ id: 'staff', name: 'MSP technician' }] : [], hasMore: false }));
    mount('operation-a'); await screen.findByText('Customer A');
    expect(screen.queryByLabelText('coManaged.provisioning.visibility')).toBeNull();
    expect(document.getElementById('co-policy-board-search')).toBeNull();
    await screen.findByRole('option', { name: 'MSP technician' });
    fireEvent.change(document.getElementById('co-policy-user-select')!, { target: { value: 'staff' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'coManaged.policy.add' })[0]);
    fireEvent.change(screen.getByLabelText('coManaged.policy.accessFor: MSP technician'), { target: { value: 'collaborate' } });
    fireEvent.click(button('save')); await screen.findByText('coManaged.policy.saved');
    expect(mocks.sponsor).toHaveBeenCalledWith({ operationId: 'operation-a', revision: 2, assignments: [{ kind: 'user', principalId: 'staff', role: 'technician' }] });
    expect(mocks.customer).not.toHaveBeenCalled();
    expect(mocks.search.mock.calls.every(([input]) => input.operationId === 'operation-a' && ['user', 'team'].includes(input.kind))).toBe(true);
  });

  it('permits revocation during read-only mode and reloads the persisted scope to discard an unsaved reduction', async () => {
    mocks.load.mockResolvedValue({ ...customerScreen(), canExpand: false });
    mount(); await screen.findByText('coManaged.policy.readOnly');
    expect(mocks.search).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'coManaged.policy.add' })).toBeNull();
    fireEvent.click(button('remove'));
    expect(screen.queryByText('Service desk')).toBeNull();
    fireEvent.click(button('reload')); await screen.findByText('Service desk');
    fireEvent.change(screen.getByLabelText('coManaged.policy.accessFor: Service desk'), { target: { value: 'view' } });
    fireEvent.click(button('save')); await screen.findByText('coManaged.policy.saved');
    expect(mocks.customer).toHaveBeenCalledWith({ revision: 2, scope: { visibilityMode: 'board_scope', boards: [{ id: 'board', canCollaborate: false }], projects: [] } });
  });

  it('requires reload after a competing revision before editing and submitting the new revision', async () => {
    mocks.customer.mockRejectedValueOnce(new Error('POLICY_CHANGED'));
    mount(); await screen.findByText('Our MSP'); fireEvent.click(button('save'));
    await screen.findByRole('alert'); expect(screen.getByLabelText('coManaged.provisioning.visibility')).toBeDisabled();
    const latest = customerScreen(); latest.policy.revision = 8; latest.policy.boards = []; mocks.load.mockResolvedValue(latest);
    fireEvent.click(button('reload')); await waitFor(() => expect(screen.getByLabelText('coManaged.provisioning.visibility')).toBeEnabled());
    fireEvent.click(button('save')); await screen.findByText('coManaged.policy.saved');
    expect(mocks.customer.mock.calls[1][0]).toEqual({ revision: 8, scope: { visibilityMode: 'board_scope', boards: [], projects: [] } });
  });

  it.each(['save', 'reload'] as const)('ignores a late %s response after changing the selected customer', async (action) => {
    const pending = deferred<any>();
    mocks.load.mockImplementation(async (id: string) => sponsorScreen(id === 'operation-a' ? 'Customer A' : 'Customer B'));
    const view = mount('operation-a'); await screen.findByText('Customer A');
    if (action === 'save') mocks.sponsor.mockReturnValueOnce(pending.promise);
    else mocks.load.mockReturnValueOnce(pending.promise);
    fireEvent.click(button(action));
    view.rerender(<CoManagedFeatureBoundary><CoManagedPolicyPanel operationId="operation-b" /></CoManagedFeatureBoundary>);
    await screen.findByText('Customer B');
    await act(async () => pending.resolve(action === 'save' ? { revision: 3 } : sponsorScreen('Customer A')));
    expect(screen.queryByText('Customer A')).toBeNull(); expect(screen.getByText('Customer B')).toBeVisible();
    expect(screen.queryByText('coManaged.policy.saved')).toBeNull(); expect(button('save')).toBeEnabled();
    expect(mocks.load.mock.calls.at(-1)).toEqual(['operation-b']);
  });
});
