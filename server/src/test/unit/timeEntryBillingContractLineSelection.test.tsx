/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { WorkItemType } from '../../interfaces/workItem.interfaces';
import { TimeSheetStatus } from '../../interfaces/timeEntry.interfaces';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import TimeEntryEditForm from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeEntryEditForm';
// TimeEntryEditForm moved into @alga-psa/scheduling and now imports the contract
// line disambiguation helpers from the package's own lib, so the mock must target
// that module (the old server/src/lib/utils path no longer feeds the component).
import * as planDisambiguation from '@alga-psa/scheduling/lib/contractLineDisambiguation';

// Mock the planDisambiguation module
vi.mock('@alga-psa/scheduling/lib/contractLineDisambiguation', () => ({
  getClientIdForWorkItem: vi.fn(),
  getEligibleContractLinesForUI: vi.fn()
}));

// The component fetches client details via this server action once it has a
// client id; stub it so the effect doesn't hit a real DB.
vi.mock('@alga-psa/scheduling/actions/clientInteractionLookupActions', () => ({
  getSchedulingClientById: vi.fn().mockResolvedValue({ client_id: 'test-client-id' })
}));

// NOTE: The interactive "Contract Line" dropdown (label, disabled state and
// explanatory copy) has been removed from TimeEntryEditForm. The component still
// resolves the client, loads eligible contract lines and auto-selects a default
// contract_line_id (pushed back via onUpdateEntry); these tests assert that
// retained data + default-selection behavior rather than the removed UI.

describe('TimeEntryEditForm with Contract Line Selection', () => {
  const defaultStartDate = '2023-01-01T00:00:00.000Z';
  const defaultEndDate = null;

  const mockEntry = {
    client_id: 'test-client-id', // Add client ID to the mock entry
    entry_id: 'test-entry-id',
    work_item_id: 'test-work-item-id',
    work_item_type: 'project_task' as WorkItemType,
    start_time: new Date().toISOString(),
    end_time: new Date(Date.now() + 3600000).toISOString(), // 1 hour later
    billable_duration: 60,
    notes: 'Test notes',
    user_id: 'test-user-id',
    time_sheet_id: 'test-timesheet-id',
    approval_status: 'DRAFT' as TimeSheetStatus,
    service_id: 'test-service-id',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    isNew: false,
    isDirty: false
  };

  const mockServices = [
    { id: 'test-service-id', name: 'Test Service', type: 'Time', is_taxable: false, tax_rate_id: null }
  ];

  const mockTaxRegions = [
    { id: 'test-region-id', name: 'Test Region' }
  ];

  const mockTimeInputs = {};
  const mockOnSave = vi.fn();
  const mockOnDelete = vi.fn();
  const mockOnUpdateEntry = vi.fn();
  const mockOnUpdateTimeInputs = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test('auto-selects the only eligible contract line for the entry', async () => {
    // Mock the getClientIdForWorkItem function to return a client ID
    vi.mocked(planDisambiguation.getClientIdForWorkItem).mockResolvedValue('test-client-id');

    // Mock the getEligibleContractLinesForUI function to return a single plan
    vi.mocked(planDisambiguation.getEligibleContractLinesForUI).mockResolvedValue([
      {
        client_contract_line_id: 'test-plan-id',
        contract_line_name: 'Test Plan',
        contract_line_type: 'Fixed',
        start_date: defaultStartDate,
        end_date: defaultEndDate,
        has_bucket_overlay: false
      }
    ]);

    render(
      <TimeEntryEditForm
        id="test-form"
        entry={mockEntry}
        index={0}
        isEditable={true}
        services={mockServices}
        taxRegions={mockTaxRegions}
        timeInputs={mockTimeInputs}
        totalDuration={60}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
        onUpdateEntry={mockOnUpdateEntry}
        onUpdateTimeInputs={mockOnUpdateTimeInputs}
      />
    );

    // Eligible contract lines are loaded for the entry's client + service.
    await waitFor(() => {
      expect(planDisambiguation.getEligibleContractLinesForUI).toHaveBeenCalledWith(
        'test-client-id',
        'test-service-id',
        mockEntry.start_time
      );
    });

    // With a single eligible line, it is auto-selected onto the entry.
    await waitFor(() => {
      expect(mockOnUpdateEntry).toHaveBeenCalledWith(0, {
        ...mockEntry,
        contract_line_id: 'test-plan-id'
      });
    });
  });

  test('does not load contract lines when no client ID can be resolved', async () => {
    // No client_id on the entry and the work-item lookup also yields nothing.
    const entryWithoutClient = { ...mockEntry, client_id: undefined };
    vi.mocked(planDisambiguation.getClientIdForWorkItem).mockResolvedValue(null);

    render(
      <TimeEntryEditForm
        id="test-form"
        entry={entryWithoutClient}
        index={0}
        isEditable={true}
        services={mockServices}
        taxRegions={mockTaxRegions}
        timeInputs={mockTimeInputs}
        totalDuration={60}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
        onUpdateEntry={mockOnUpdateEntry}
        onUpdateTimeInputs={mockOnUpdateTimeInputs}
      />
    );

    // The component attempts to resolve the client from the work item.
    await waitFor(() => {
      expect(planDisambiguation.getClientIdForWorkItem).toHaveBeenCalledWith(
        'test-work-item-id',
        'project_task'
      );
    });

    // With no resolvable client, eligible contract lines are never fetched and
    // no contract line is auto-selected onto the entry.
    expect(planDisambiguation.getEligibleContractLinesForUI).not.toHaveBeenCalled();
    expect(mockOnUpdateEntry).not.toHaveBeenCalled();
  });

  test('defaults to the single bucket-overlay line when multiple plans are available', async () => {
    // Mock the getClientIdForWorkItem function to return a client ID
    vi.mocked(planDisambiguation.getClientIdForWorkItem).mockResolvedValue('test-client-id');

    // Mock the getEligibleContractLinesForUI function to return multiple plans
    vi.mocked(planDisambiguation.getEligibleContractLinesForUI).mockResolvedValue([
      {
        client_contract_line_id: 'plan-id-1',
        contract_line_name: 'Fixed Plan',
        contract_line_type: 'Fixed',
        start_date: defaultStartDate,
        end_date: defaultEndDate,
        has_bucket_overlay: false
      },
      {
        client_contract_line_id: 'plan-id-2',
        contract_line_name: 'Fixed Plan with Bucket Overlay',
        contract_line_type: 'Fixed',
        start_date: defaultStartDate,
        end_date: defaultEndDate,
        has_bucket_overlay: true
      }
    ]);

    render(
      <TimeEntryEditForm
        id="test-form"
        entry={mockEntry}
        index={0}
        isEditable={true}
        services={mockServices}
        taxRegions={mockTaxRegions}
        timeInputs={mockTimeInputs}
        totalDuration={60}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
        onUpdateEntry={mockOnUpdateEntry}
        onUpdateTimeInputs={mockOnUpdateTimeInputs}
      />
    );

    await waitFor(() => {
      expect(planDisambiguation.getEligibleContractLinesForUI).toHaveBeenCalledWith(
        'test-client-id',
        'test-service-id',
        mockEntry.start_time
      );
    });

    // With multiple eligible lines but a single bucket-overlay line, that line
    // is auto-selected as the default.
    await waitFor(() => {
      expect(mockOnUpdateEntry).toHaveBeenCalledWith(0, {
        ...mockEntry,
        contract_line_id: 'plan-id-2'
      });
    });
  });

  test('should allow saving without contract line selection', async () => {
    // Mock the getClientIdForWorkItem function to return a client ID
    vi.mocked(planDisambiguation.getClientIdForWorkItem).mockResolvedValue('test-client-id');
    
    // Mock the getEligibleContractLinesForUI function to return multiple plans
    vi.mocked(planDisambiguation.getEligibleContractLinesForUI).mockResolvedValue([
      {
        client_contract_line_id: 'plan-id-1',
        contract_line_name: 'Fixed Plan',
        contract_line_type: 'Fixed',
        start_date: defaultStartDate,
        end_date: defaultEndDate,
        has_bucket_overlay: false
      },
      {
        client_contract_line_id: 'plan-id-2',
        contract_line_name: 'Fixed Plan with Bucket Overlay',
        contract_line_type: 'Fixed',
        start_date: defaultStartDate,
        end_date: defaultEndDate,
        has_bucket_overlay: true
      }
    ]);

    // Create a mock entry without a contract line ID
    const entryWithoutContractLine = {
      ...mockEntry,
      contract_line_id: undefined
    };

    render(
      <TimeEntryEditForm
        id="test-form"
        entry={entryWithoutContractLine}
        index={0}
        isEditable={true}
        services={mockServices}
        taxRegions={mockTaxRegions}
        timeInputs={mockTimeInputs}
        totalDuration={60}
        onSave={mockOnSave}
        onDelete={mockOnDelete}
        onUpdateEntry={mockOnUpdateEntry}
        onUpdateTimeInputs={mockOnUpdateTimeInputs}
      />
    );

    // Wait for the component to load and fetch data
    await waitFor(() => {
      expect(planDisambiguation.getEligibleContractLinesForUI).toHaveBeenCalled();
    });

    // Click the save button
    fireEvent.click(screen.getByText('Save'));

    // The form should NOT show a validation error for missing contract line
    expect(screen.queryByText('Contract line is required when multiple plans are available')).not.toBeInTheDocument();

    // The onSave function should be called since contract line is no longer required
    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(0);
    });
  });
});
