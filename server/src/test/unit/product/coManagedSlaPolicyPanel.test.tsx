/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CoManagedSlaPolicyPanel from '../../../components/co-managed/CoManagedSlaPolicyPanel';

const mocks = vi.hoisted(() => ({ list: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock('../../../lib/actions/coManagedDelegatedActions', () => ({ listCoManagedAdministrationWorkspacesAction: mocks.list }));
vi.mock('../../../lib/actions/coManagedSlaActions', () => ({ getCoManagedSlaPolicyAction: mocks.load, saveCoManagedSlaPriorityMappingsAction: mocks.save }));
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({ default: ({ id, label, value, disabled, options, onValueChange }: any) =>
  <label>{label}<select id={id} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
    {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string, options?: { name?: string }) => options?.name ? `${key}: ${options.name}` : key }) }));

const screenData = () => ({ ok: true, screen: { canWrite: true, policyName: 'MSP support policy',
  customerPriorities: [{ priority_id: 'customer-high', priority_name: 'Urgent' }],
  mspPriorities: [{ priority_id: 'msp-p1', priority_name: 'MSP P1' }, { priority_id: 'msp-p2', priority_name: 'MSP P2' }],
  mappings: [{ customerPriorityId: 'customer-high', mspPriorityId: 'msp-p1' }] } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([{ relationshipId: 'rel-1', name: 'Acme', side: 'sponsor', effective: true, delegated: false }]);
  mocks.load.mockResolvedValue(screenData()); mocks.save.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

it('saves the changed mapping for the chosen relationship and reloads', async () => {
  render(<CoManagedSlaPolicyPanel />);
  const select = await screen.findByLabelText('coManaged.sla.mappingFor: Urgent');
  expect(select).toHaveValue('msp-p1');
  // Only display names are offered; no raw id is rendered as option text.
  expect(screen.queryByText('msp-p1')).toBeNull();
  fireEvent.change(select, { target: { value: 'msp-p2' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.policy.save' }));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  expect(mocks.save).toHaveBeenCalledWith('rel-1', [{ customerPriorityId: 'customer-high', mspPriorityId: 'msp-p2' }]);
});

it('leaves an unmapped priority out of the saved set', async () => {
  render(<CoManagedSlaPolicyPanel />);
  fireEvent.change(await screen.findByLabelText('coManaged.sla.mappingFor: Urgent'), { target: { value: 'none' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.policy.save' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('rel-1', []));
});

it('shows a read-only configuration without allowing mutation', async () => {
  mocks.load.mockResolvedValue({ ok: true, screen: { ...screenData().screen, canWrite: false } });
  render(<CoManagedSlaPolicyPanel />);
  expect(await screen.findByLabelText('coManaged.sla.mappingFor: Urgent')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'coManaged.policy.save' })).toBeDisabled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it('shows a save failure and does not claim success', async () => {
  mocks.save.mockResolvedValue({ ok: false, errorCode: 'POLICY_CHANGED' });
  render(<CoManagedSlaPolicyPanel />);
  await screen.findByLabelText('coManaged.sla.mappingFor: Urgent');
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.policy.save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('coManaged.policy.saveError');
  expect(screen.queryByRole('status')).toBeNull();
});

it('shows the empty state when there is no sponsored workspace', async () => {
  mocks.list.mockResolvedValue([{ relationshipId: 'c', name: 'Sponsor', side: 'customer', effective: true, delegated: true }]);
  render(<CoManagedSlaPolicyPanel />);
  expect(await screen.findByText('coManaged.administration.empty')).toBeInTheDocument();
  expect(mocks.load).not.toHaveBeenCalled();
});
