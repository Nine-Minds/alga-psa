import React from 'react';
import { WorkItemType } from '../../interfaces/workItem.interfaces';
import { TimeSheetStatus } from '../../interfaces/timeEntry.interfaces';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import TimeEntryEditForm from '../../components/time-management/time-entry/time-sheet/TimeEntryEditForm';
import * as planDisambiguation from '../../lib/utils/planDisambiguation';

// Mock the planDisambiguation module
vi.mock('../../lib/utils/planDisambiguation', () => ({
  getCompanyIdForWorkItem: vi.fn(),
  getEligibleBillingPlansForUI: vi.fn()
}));

describe('TimeEntryEditForm with Billing Plan Selection', () => {
  const mockEntry = {
    company_id: 'test-company-id', // Add company ID to the mock entry
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
    { id: 'test-service-id', name: 'Test Service', type: 'Time', is_taxable: false }
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

  test('should display billing plan selector with disabled dropdown when only one plan is available', async () => {
    // Mock the getCompanyIdForWorkItem function to return a company ID
    vi.mocked(planDisambiguation.getCompanyIdForWorkItem).mockResolvedValue('test-company-id');
    
    // Mock the getEligibleBillingPlansForUI function to return a single plan
    vi.mocked(planDisambiguation.getEligibleBillingPlansForUI).mockResolvedValue([
      {
        company_billing_plan_id: 'test-plan-id',
        plan_name: 'Test Plan',
        plan_type: 'Fixed'
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
      expect(planDisambiguation.getCompanyIdForWorkItem).toHaveBeenCalledWith(
        'test-work-item-id',
        'project_task'
      );
    });

    await waitFor(() => {
      expect(planDisambiguation.getEligibleBillingPlansForUI).toHaveBeenCalledWith(
        'test-company-id',
        'test-service-id'
      );
    });

    // The billing plan selector should be visible
    expect(screen.getByText('Billing Plan')).toBeInTheDocument();
    
    // The dropdown should be disabled
    const selectElement = screen.getByLabelText('Billing Plan *');
    expect(selectElement).toBeDisabled();
    
    // There should be explanatory text
    expect(screen.getByText('This service is only available in one billing plan.')).toBeInTheDocument();

    // The entry should be updated with the billing plan ID
    expect(mockOnUpdateEntry).toHaveBeenCalledWith(0, {
      ...mockEntry,
      billing_plan_id: 'test-plan-id'
    });
  });

  test('should display billing plan selector with disabled dropdown when no company ID is available', async () => {
    // Mock the getCompanyIdForWorkItem function to return null (no company ID)
    vi.mocked(planDisambiguation.getCompanyIdForWorkItem).mockResolvedValue(null);
    
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
      expect(planDisambiguation.getCompanyIdForWorkItem).toHaveBeenCalledWith(
        'test-work-item-id',
        'project_task'
      );
    });

    // The billing plan selector should be visible
    expect(screen.getByText('Billing Plan')).toBeInTheDocument();
    
    // The dropdown should be disabled
    const selectElement = screen.getByLabelText('Billing Plan *');
    expect(selectElement).toBeDisabled();
    
    // There should be explanatory text
    expect(screen.getByText('Company information not available. The system will use the default billing plan.')).toBeInTheDocument();
  });

  test('should display billing plan selector when multiple plans are available', async () => {
    // Mock the getCompanyIdForWorkItem function to return a company ID
    vi.mocked(planDisambiguation.getCompanyIdForWorkItem).mockResolvedValue('test-company-id');
    
    // Mock the getEligibleBillingPlansForUI function to return multiple plans
    vi.mocked(planDisambiguation.getEligibleBillingPlansForUI).mockResolvedValue([
      {
        company_billing_plan_id: 'plan-id-1',
        plan_name: 'Fixed Plan',
        plan_type: 'Fixed'
      },
      {
        company_billing_plan_id: 'plan-id-2',
        plan_name: 'Bucket Plan',
        plan_type: 'Bucket'
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
      expect(planDisambiguation.getCompanyIdForWorkItem).toHaveBeenCalledWith(
        'test-work-item-id',
        'project_task'
      );
    });

    await waitFor(() => {
      expect(planDisambiguation.getEligibleBillingPlansForUI).toHaveBeenCalledWith(
        'test-company-id',
        'test-service-id'
      );
    });

    // The billing plan selector should be visible
    expect(screen.getByText('Billing Plan')).toBeInTheDocument();

    // The entry should be updated with the bucket plan ID (default selection)
    expect(mockOnUpdateEntry).toHaveBeenCalledWith(0, {
      ...mockEntry,
      billing_plan_id: 'plan-id-2'
    });
  });

  test('should validate billing plan selection when saving', async () => {
    // Mock the getCompanyIdForWorkItem function to return a company ID
    vi.mocked(planDisambiguation.getCompanyIdForWorkItem).mockResolvedValue('test-company-id');
    
    // Mock the getEligibleBillingPlansForUI function to return multiple plans
    vi.mocked(planDisambiguation.getEligibleBillingPlansForUI).mockResolvedValue([
      {
        company_billing_plan_id: 'plan-id-1',
        plan_name: 'Fixed Plan',
        plan_type: 'Fixed'
      },
      {
        company_billing_plan_id: 'plan-id-2',
        plan_name: 'Bucket Plan',
        plan_type: 'Bucket'
      }
    ]);

    // Create a mock entry without a billing plan ID
    const entryWithoutBillingPlan = {
      ...mockEntry,
      billing_plan_id: undefined
    };

    render(
      <TimeEntryEditForm
        id="test-form"
        entry={entryWithoutBillingPlan}
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
      expect(planDisambiguation.getEligibleBillingPlansForUI).toHaveBeenCalled();
    });

    // Click the save button
    fireEvent.click(screen.getByText('Save'));

    // The form should show a validation error
    expect(screen.getByText('Billing plan is required when multiple plans are available')).toBeInTheDocument();

    // The onSave function should not be called
    expect(mockOnSave).not.toHaveBeenCalled();
  });
});