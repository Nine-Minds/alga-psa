/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import QuickAddClient from '@alga-psa/clients/components/clients/QuickAddClient';
import { UIStateProvider } from '@alga-psa/ui/ui-reflection/UIStateContext';

// Mock the external dependencies
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('@alga-psa/users/actions', () => ({
  getAllUsersBasic: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  createClient: vi.fn().mockResolvedValue({ client_id: 'test-id', client_name: 'Test Client' }),
  createClientLocation: vi.fn().mockResolvedValue({}),
  createClientContact: vi.fn().mockResolvedValue({}),
  getAllCountries: vi.fn().mockResolvedValue([]),
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

describe('QuickAddClient UI Reflection', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onClientAdded: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with automation ID attributes', () => {
    render(
      <TestWrapper>
        <QuickAddClient {...defaultProps} />
      </TestWrapper>
    );

    // Check for dialog automation ID
    const dialogElement = document.querySelector('[data-automation-id="quick-add-client-dialog"]');
    expect(dialogElement).toBeTruthy();
  });

  it('should have form elements with proper IDs', () => {
    render(
      <TestWrapper>
        <QuickAddClient {...defaultProps} />
      </TestWrapper>
    );

    // Check for key form elements
    expect(document.getElementById('client_name')).toBeTruthy();
    expect(document.getElementById('client_type_select')).toBeTruthy();
    expect(document.getElementById('email')).toBeTruthy();
    expect(document.getElementById('phone_no')).toBeTruthy();
    expect(document.getElementById('create-client-btn')).toBeTruthy();
    expect(document.getElementById('cancel-quick-add-client-btn')).toBeTruthy();
  });

  it('should render ReflectionContainer', () => {
    render(
      <TestWrapper>
        <QuickAddClient {...defaultProps} />
      </TestWrapper>
    );

    // The ReflectionContainer should register components in the UI state
    // We can test this by looking for the container structure
    const formContainer = document.querySelector('[data-testid="reflection-container"]') ||
                         document.getElementById('quick-add-client-form');
    expect(formContainer).toBeTruthy();
  });

  it('should not render when closed', () => {
    render(
      <TestWrapper>
        <QuickAddClient {...defaultProps} open={false} />
      </TestWrapper>
    );

    // Dialog should not be visible when closed
    const dialogElement = document.querySelector('[data-automation-id="quick-add-client-dialog"]');
    expect(dialogElement).toBeFalsy();
  });
});
