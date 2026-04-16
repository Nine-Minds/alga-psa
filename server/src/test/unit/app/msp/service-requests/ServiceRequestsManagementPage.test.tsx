// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

(globalThis as unknown as { React?: typeof React }).React = React;

const {
  pushMock,
  listServiceRequestDefinitionsActionMock,
  listServiceRequestTemplatesActionMock,
  createServiceRequestDefinitionFromTemplateActionMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  listServiceRequestDefinitionsActionMock: vi.fn(),
  listServiceRequestTemplatesActionMock: vi.fn(),
  createServiceRequestDefinitionFromTemplateActionMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('../../../../../app/msp/service-requests/actions', () => ({
  archiveServiceRequestDefinitionAction: vi.fn(),
  createBlankServiceRequestDefinitionAction: vi.fn(),
  createServiceRequestDefinitionFromTemplateAction: (...args: unknown[]) =>
    createServiceRequestDefinitionFromTemplateActionMock(...args),
  duplicateServiceRequestDefinitionAction: vi.fn(),
  listServiceRequestDefinitionsAction: (...args: unknown[]) =>
    listServiceRequestDefinitionsActionMock(...args),
  listServiceRequestTemplatesAction: (...args: unknown[]) =>
    listServiceRequestTemplatesActionMock(...args),
  unarchiveServiceRequestDefinitionAction: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data }: { data: Array<{ definition_id: string; name: string }> }) => (
    <div data-testid="service-requests-table">
      {data.map((row) => (
        <div key={row.definition_id}>{row.name}</div>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
    disabled,
    label,
  }: {
    id?: string;
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    label?: string;
  }) => (
    <label htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
      />
      {label}
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));

const { default: ServiceRequestsManagementPage } = await import(
  '../../../../../app/msp/service-requests/ServiceRequestsManagementPage'
);

describe('ServiceRequestsManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    listServiceRequestDefinitionsActionMock.mockResolvedValue([]);
    listServiceRequestTemplatesActionMock.mockResolvedValue([
      {
        providerKey: 'ce-starter-pack',
        templateId: 'new-hire',
        templateName: 'New Hire Onboarding',
        providerDisplayName: 'CE Starter Pack',
      },
    ]);
    createServiceRequestDefinitionFromTemplateActionMock.mockResolvedValue({
      definition_id: 'definition-123',
    });
  });

  it('creates a draft from an example and opens the editor page immediately', async () => {
    render(<ServiceRequestsManagementPage />);

    await screen.findByText('New Hire Onboarding');

    fireEvent.click(screen.getByText(/New Hire Onboarding/));

    await waitFor(() => {
      expect(createServiceRequestDefinitionFromTemplateActionMock).toHaveBeenCalledWith(
        'ce-starter-pack',
        'new-hire'
      );
    });

    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Draft created from example: New Hire Onboarding'
    );
    expect(pushMock).toHaveBeenCalledWith('/msp/service-requests/definition-123');
    expect(listServiceRequestDefinitionsActionMock).toHaveBeenCalledTimes(1);
    expect(listServiceRequestTemplatesActionMock).toHaveBeenCalledTimes(1);
  });

  it('hides archived service requests by default and reveals them when toggled on', async () => {
    listServiceRequestDefinitionsActionMock.mockResolvedValue([
      {
        definition_id: 'definition-active',
        name: 'Active Request',
        description: null,
        lifecycle_state: 'draft',
        published_at: null,
        updated_at: '2026-04-16T00:00:00.000Z',
      },
      {
        definition_id: 'definition-archived',
        name: 'Archived Request',
        description: null,
        lifecycle_state: 'archived',
        published_at: null,
        updated_at: '2026-04-16T00:00:00.000Z',
      },
    ]);

    render(<ServiceRequestsManagementPage />);

    await screen.findByText('Active Request');

    expect(screen.queryByText('Archived Request')).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: 'Show archived (1)' }));

    expect(await screen.findByText('Archived Request')).toBeTruthy();
    expect(
      (screen.getByRole('switch', { name: 'Show archived (1)' }) as HTMLInputElement).checked
    ).toBe(true);
  });
});
