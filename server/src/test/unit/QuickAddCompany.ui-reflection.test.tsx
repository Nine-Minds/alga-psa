/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import QuickAddCompany from '../../components/companies/QuickAddCompany';
import { UIStateProvider } from '../../types/ui-reflection/UIStateContext';

// Mock the external dependencies
vi.mock('../../lib/actions/user-actions/userActions', () => ({
  getAllUsers: vi.fn().mockResolvedValue([])
}));

vi.mock('../../lib/actions/companyActions', () => ({
  createCompany: vi.fn().mockResolvedValue({ company_id: 'test-id', company_name: 'Test Company' })
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

// Create a test wrapper with UI reflection context
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <UIStateProvider
      initialPageState={{
        id: 'test-page',
        title: 'Test Page',
        components: []
      }}
    >
      {children}
    </UIStateProvider>
  );
};

describe('QuickAddCompany UI Reflection', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onCompanyAdded: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with automation ID attributes', () => {
    render(
      <TestWrapper>
        <QuickAddCompany {...defaultProps} />
      </TestWrapper>
    );

    // Check for dialog automation ID
    const dialogElement = document.querySelector('[data-automation-id="quick-add-company-dialog"]');
    expect(dialogElement).toBeTruthy();
  });

  it('should have form elements with proper IDs', () => {
    render(
      <TestWrapper>
        <QuickAddCompany {...defaultProps} />
      </TestWrapper>
    );

    // Check for key form elements
    expect(document.getElementById('company_name')).toBeTruthy();
    expect(document.getElementById('client_type_select')).toBeTruthy();
    expect(document.getElementById('email')).toBeTruthy();
    expect(document.getElementById('phone_no')).toBeTruthy();
    expect(document.getElementById('create-company-btn')).toBeTruthy();
    expect(document.getElementById('cancel-quick-add-company-btn')).toBeTruthy();
  });

  it('should render ReflectionContainer', () => {
    render(
      <TestWrapper>
        <QuickAddCompany {...defaultProps} />
      </TestWrapper>
    );

    // The ReflectionContainer should register components in the UI state
    // We can test this by looking for the container structure
    const formContainer = document.querySelector('[data-testid="reflection-container"]') ||
                         document.getElementById('quick-add-company-form');
    expect(formContainer).toBeTruthy();
  });

  it('should not render when closed', () => {
    render(
      <TestWrapper>
        <QuickAddCompany {...defaultProps} open={false} />
      </TestWrapper>
    );

    // Dialog should not be visible when closed
    const dialogElement = document.querySelector('[data-automation-id="quick-add-company-dialog"]');
    expect(dialogElement).toBeFalsy();
  });
});