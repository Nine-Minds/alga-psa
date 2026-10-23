/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/components/SearchableSelect', () => ({
  __esModule: true,
  default: ({ id, options, value }: { id?: string; options: Array<{ value: string; label: string; secondaryLabel?: string }>; value?: string }) => (
    <select data-testid={id} value={value ?? ''} onChange={() => undefined}>
      <option value="">--</option>
      {options.map((option) => (
        <option key={option.value} value={option.value} data-secondary={option.secondaryLabel}>{option.label}</option>
      ))}
    </select>
  ),
}));
vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({ __esModule: true, default: () => null }));
vi.mock('@alga-psa/ui/components/MultiUserAndTeamPicker', () => ({ __esModule: true, default: () => null }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ __esModule: true, default: () => null }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => null }));
vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({ BoardPicker: () => null }));
vi.mock('@alga-psa/ui/components/AsyncSearchableSelect', () => ({ AsyncSearchableSelect: () => null }));
vi.mock('@alga-psa/clients/actions', () => ({ getAllContacts: vi.fn(), getContactsByClient: vi.fn() }));
vi.mock('@alga-psa/integrations/actions', () => ({ getAvailableStatuses: vi.fn(), getTicketFieldOptions: vi.fn() }));
vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({ getTicketById: vi.fn() }));
vi.mock('@alga-psa/auth/actions', () => ({ getRoles: vi.fn() }));
vi.mock('@alga-psa/projects/actions/projectActions', () => ({ getProjectsWithPhases: vi.fn() }));
vi.mock('@alga-psa/projects/actions/projectTaskActions', () => ({ getProjectTaskData: vi.fn() }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getAllUsersBasic: vi.fn(), getUserAvatarUrlsBatchAction: vi.fn() }));
vi.mock('@alga-psa/teams/actions', () => ({ getTeamsBasic: vi.fn(), getTeamAvatarUrlsBatchAction: vi.fn(), isTeamActionError: () => false }));
vi.mock('../workflowTicketPickerSearch', () => ({ formatWorkflowTicketLabel: vi.fn(), searchWorkflowTickets: vi.fn() }));
vi.mock('../workflowPickerServerActions', () => ({
  listWorkflowAssetOptionsAction: vi.fn().mockResolvedValue([]),
  listWorkflowContractOptionsAction: vi.fn().mockResolvedValue([
    { contract_id: 'contract-acme', contract_name: 'Managed Services', client_id: 'client-acme', client_name: 'Acme', start_date: null, end_date: '2026-12-31' },
    { contract_id: 'contract-globex', contract_name: 'Backup Plan', client_id: 'client-globex', client_name: 'Globex', start_date: null, end_date: null },
  ]),
}));

import { WorkflowActionInputFixedPicker } from '../WorkflowActionInputFixedPicker';

const contractField = {
  name: 'contractId',
  editor: { kind: 'picker' as const, picker: { resource: 'contract' }, dependencies: ['clientId'], fixedValueHint: 'Search contracts' },
};

const optionLabels = () =>
  Array.from((screen.getByTestId('run-form-contractId-literal-picker') as HTMLSelectElement).options).map((option) => option.textContent);

describe('contract picker', () => {
  afterEach(() => cleanup());

  it('lists client contracts with their client', async () => {
    render(
      <WorkflowActionInputFixedPicker field={contractField} value={null} onChange={vi.fn()} idPrefix="run-form-contractId" rootInputMapping={{}} />
    );
    await waitFor(() => expect(optionLabels()).toEqual(['--', 'Managed Services · Acme', 'Backup Plan · Globex']));
  });

  it('narrows to the client already chosen in the payload, says so, and can show every client', async () => {
    render(
      <WorkflowActionInputFixedPicker
        field={contractField}
        value={null}
        onChange={vi.fn()}
        idPrefix="run-form-contractId"
        rootInputMapping={{ clientId: 'client-globex' }}
      />
    );
    await waitFor(() => expect(optionLabels()).toEqual(['--', 'Backup Plan · Globex']));
    expect(document.getElementById('run-form-contractId-client-scope')?.textContent).toContain('Filtered to Globex');
    await act(async () => {
      fireEvent.click(document.getElementById('run-form-contractId-client-scope-toggle')!);
    });
    expect(optionLabels()).toEqual(['--', 'Managed Services · Acme', 'Backup Plan · Globex']);
    expect(document.getElementById('run-form-contractId-client-scope')?.textContent).toContain('Showing every client');
  });

  it("shows each contract's end date, or that it has none", async () => {
    render(
      <WorkflowActionInputFixedPicker field={contractField} value={null} onChange={vi.fn()} idPrefix="run-form-contractId" rootInputMapping={{}} />
    );
    await waitFor(() => expect(optionLabels()).toHaveLength(3));
    const details = Array.from((screen.getByTestId('run-form-contractId-literal-picker') as HTMLSelectElement).options)
      .map((option) => option.getAttribute('data-secondary'));
    expect(details).toEqual([null, 'Ends 2026-12-31', 'No end date']);
    // No client chosen: nothing to say about filtering.
    expect(document.getElementById('run-form-contractId-client-scope')).toBeNull();
  });
});
