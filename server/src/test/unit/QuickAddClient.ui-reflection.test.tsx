/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
// The shared test setup mocks useAutomationIdAndRegister with a stub that
// returns *empty* automationIdProps, which strips the id/data-automation-id from
// every reflection-aware component (Input, Dialog, ...). This test verifies that
// the QuickAddClient wiring assigns those ids, so override the mock locally to
// echo the registered id back (mirroring production behaviour).
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: (params?: { id?: string }) => ({
    automationIdProps: params?.id
      ? { id: params.id, 'data-automation-id': params.id }
      : {},
    updateMetadata: vi.fn(),
  }),
}));

import QuickAddClient from '@alga-psa/clients/components/clients/QuickAddClient';
import { UIStateProvider } from '@alga-psa/ui/ui-reflection/UIStateContext';
import { TagProvider } from '@alga-psa/tags/context/TagContext';

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
  listContactPhoneTypeSuggestions: vi.fn().mockResolvedValue([]),
}));

// errorHandling.ts imports a *named* `toast` from react-hot-toast and uses
// toast.error / toast.custom; the default export is unused there.
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(),
  });
  return { default: toast, toast };
});

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
      <TagProvider>{children}</TagProvider>
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

  afterEach(() => {
    cleanup();
  });

  it('should render with automation ID attributes', () => {
    render(
      <TestWrapper>
        <QuickAddClient {...defaultProps} />
      </TestWrapper>
    );

    // Check for dialog automation ID. The Dialog component registers the
    // provided id with a `-dialog` suffix on the rendered content element.
    const dialogElement = document.querySelector('[data-automation-id="quick-add-client-dialog-dialog"]');
    expect(dialogElement).toBeTruthy();
  });

  it('should have form elements with proper IDs', () => {
    render(
      <TestWrapper>
        <QuickAddClient {...defaultProps} />
      </TestWrapper>
    );

    // Check for key form elements. The email/phone fields now live inside the
    // collapsible Location/Contact sections, so the stable always-rendered
    // controls are the name, type, and the primary action buttons.
    expect(document.getElementById('client-name')).toBeTruthy();
    expect(document.getElementById('client-type-select')).toBeTruthy();
    expect(document.getElementById('create-client-btn')).toBeTruthy();
    expect(document.getElementById('cancel-dialog-btn')).toBeTruthy();
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
