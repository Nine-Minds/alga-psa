import React from 'react';
import { WorkItemType } from '../../interfaces/workItem.interfaces';
import { TimeSheetStatus } from '../../interfaces/timeEntry.interfaces';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import TimeEntryEditForm from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeEntryEditForm';
import * as planDisambiguation from '../../lib/utils/contractLineDisambiguation';

// Mock the planDisambiguation module
vi.mock('../../lib/utils/contractLineDisambiguation', () => ({
  getClientIdForWorkItem: vi.fn(),
  getEligibleContractLinesForUI: vi.fn()
}));

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

  test('should display contract line selector with disabled dropdown when only one plan is available', async () => {
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

    // Wait for the component to load and fetch data
    await waitFor(() => {
      expect(planDisambiguation.getClientIdForWorkItem).toHaveBeenCalledWith(
        'test-work-item-id',
        'project_task'
      );
    });

    await waitFor(() => {
      expect(planDisambiguation.getEligibleContractLinesForUI).toHaveBeenCalledWith(
        'test-client-id',
        'test-service-id'
      );
    });

    // The contract line selector should be visible
    expect(screen.getByText('Contract Line')).toBeInTheDocument();
    
    // The dropdown should be disabled
    const selectElement = screen.getByLabelText('Contract Line (Optional)');
    expect(selectElement).toBeDisabled();
    
    // There should be explanatory text
    expect(screen.getByText('This service is only available in one contract line.')).toBeInTheDocument();

    // The entry should be updated with the contract line ID
    expect(mockOnUpdateEntry).toHaveBeenCalledWith(0, {
      ...mockEntry,
      contract_line_id: 'test-plan-id'
    });
  });

  test('should display contract line selector with disabled dropdown when no client ID is available', async () => {
    // Mock the getClientIdForWorkItem function to return null (no client ID)
    vi.mocked(planDisambiguation.getClientIdForWorkItem).mockResolvedValue(null);
    
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

    // Wait for the component to load and fetch data
    await waitFor(() => {
      expect(planDisambiguation.getClientIdForWorkItem).toHaveBeenCalledWith(
        'test-work-item-id',
        'project_task'
      );
    });

    // The contract line selector should be visible
    expect(screen.getByText('Contract Line')).toBeInTheDocument();
    
    // The dropdown should be disabled
    const selectElement = screen.getByLabelText('Contract Line (Optional)');
    expect(selectElement).toBeDisabled();
    
    // There should be explanatory text
    expect(screen.getByText('Client information not available. The system will use the default contract line.')).toBeInTheDocument();
  });

  test('should display contract line selector when multiple plans are available', async () => {
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

    // Wait for the component to load and fetch data
    await waitFor(() => {
      expect(planDisambiguation.getClientIdForWorkItem).toHaveBeenCalledWith(
        'test-work-item-id',
        'project_task'
      );
    });

    await waitFor(() => {
      expect(planDisambiguation.getEligibleContractLinesForUI).toHaveBeenCalledWith(
        'test-client-id',
        'test-service-id'
      );
    });

    // The contract line selector should be visible
    expect(screen.getByText('Contract Line')).toBeInTheDocument();

    // The entry should be updated with the bucket plan ID (default selection)
    expect(mockOnUpdateEntry).toHaveBeenCalledWith(0, {
      ...mockEntry,
      contract_line_id: 'plan-id-2'
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
    expect(mockOnSave).toHaveBeenCalledWith(0);
  });
});
