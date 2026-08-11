/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TemplateStatusManager } from '../project-templates/TemplateStatusManager';
import type { IProjectTemplateStatusMapping } from '@alga-psa/types';

const replaceTemplateStatusMappingMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../actions/projectTemplateActions', () => ({
  addTemplateStatusMapping: vi.fn(),
  copyTemplateStatusesToPhase: vi.fn(),
  removeTemplateStatusMapping: vi.fn(),
  removeTemplatePhaseStatuses: vi.fn(),
  reorderTemplateStatusMappings: vi.fn(),
  replaceTemplateStatusMapping: (...args: unknown[]) => replaceTemplateStatusMappingMock(...args),
}));

vi.mock('../../actions/projectTaskStatusActions', () => ({
  createTenantProjectStatus: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  handleError: vi.fn(),
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title, footer }: any) =>
    isOpen ? (
      <div data-testid="dialog">
        <div>{title}</div>
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ value, onValueChange, options }: any) => (
    <select data-testid="custom-select" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/QuickAddStatus', () => ({
  QuickAddStatus: () => null,
}));

const DICT: Record<string, string> = {
  'templates.statuses.status_no_longer_exists': 'Status no longer exists',
  'templates.statuses.missing_status': 'Missing status',
  'templates.statuses.ambiguous_status': 'Ambiguous historical status',
  'templates.statuses.replace_status': 'Replace status',
  'templates.statuses.replacing': 'Replacing...',
  'templates.statuses.replaced': 'Status column replaced',
  'templates.statuses.replace_failed': 'Failed to replace status column',
  'templates.statuses.replace_placeholder': 'Select replacement status...',
  'templates.statuses.repair_status_columns': 'Repair status columns',
  'templates.statuses.manage_title': 'Manage Status Columns',
  'templates.statuses.manage_description': 'Define the status columns for tasks in this template.',
  'templates.statuses.template_defaults': 'Template Defaults',
  'templates.statuses.empty': 'No status columns yet',
  'templates.statuses.add_title': 'Add Status Column',
  'templates.statuses.select_placeholder': 'Select a status...',
  'templates.statuses.all_in_use': 'All available statuses are in use',
  'templates.statuses.create_new': 'Create New',
  'settings.statuses.closed': 'Closed',
  'settings.statuses.scope_label': 'Scope',
  'templates.statuses.revert_message': 'Remove this phase custom status columns?',
};

function translate(key: string, arg2?: unknown): string {
  if (typeof arg2 === 'string') return arg2;
  const opts = arg2 && typeof arg2 === 'object' ? (arg2 as Record<string, unknown>) : {};
  const template = DICT[key] ?? (typeof opts.defaultValue === 'string' ? opts.defaultValue : key);
  return template.replace(/{{\s*(\w+)\s*}}/g, (_m: string, name: string) => String(opts[name] ?? ''));
}

function unresolvedMapping(overrides: Partial<IProjectTemplateStatusMapping> = {}): IProjectTemplateStatusMapping {
  return {
    tenant: 'tpl-1',
    template_status_mapping_id: 'mapping-1',
    template_id: 'tpl-1',
    status_id: undefined,
    standard_status_id: undefined,
    unresolved_status_id: 'orphan-uuid',
    unresolved_reason: 'missing',
    status_source: 'unresolved',
    statusSource: 'unresolved',
    custom_status_name: undefined,
    custom_status_color: undefined,
    display_order: 0,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('TemplateStatusManager unresolved mapping repair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Status no longer exists with the reason helper and a Replace control for an unresolved DTO', () => {
    const onStatusReplaced = vi.fn();
    const { container } = render(
      <TemplateStatusManager
        open
        onClose={vi.fn()}
        templateId="tpl-1"
        phases={[]}
        statusMappings={[unresolvedMapping()]}
        availableStatuses={[{ status_id: 'status-2', name: 'Replacement', color: '#000000', is_closed: false }]}
        taskCountByMapping={{}}
        onStatusAdded={vi.fn()}
        onStatusRemoved={vi.fn()}
        onStatusReordered={vi.fn()}
        onStatusReplaced={onStatusReplaced}
      />
    );

    expect(screen.getByText('Status no longer exists')).toBeInTheDocument();
    expect(screen.getByText('Missing status')).toBeInTheDocument();
    expect(container.querySelector('#replace-status-mapping-1')).not.toBeNull();
    expect(screen.getByText('Replace status')).toBeInTheDocument();
  });

  it('renders the ambiguous reason helper for an ambiguous unresolved DTO', () => {
    render(
      <TemplateStatusManager
        open
        onClose={vi.fn()}
        templateId="tpl-1"
        phases={[]}
        statusMappings={[unresolvedMapping({ unresolved_reason: 'ambiguous' })]}
        availableStatuses={[]}
        taskCountByMapping={{}}
        onStatusAdded={vi.fn()}
        onStatusRemoved={vi.fn()}
        onStatusReordered={vi.fn()}
      />
    );

    expect(screen.getByText('Ambiguous historical status')).toBeInTheDocument();
  });

  it('calls replaceTemplateStatusMapping with the same mapping id and fires onStatusReplaced on confirm', async () => {
    const onStatusReplaced = vi.fn();
    replaceTemplateStatusMappingMock.mockResolvedValue({
      mapping: { ...unresolvedMapping(), statusSource: 'tenant', status_id: 'status-2' },
      unresolvedStatusMappingCount: 0,
    });

    const { container } = render(
      <TemplateStatusManager
        open
        onClose={vi.fn()}
        templateId="tpl-1"
        phases={[]}
        statusMappings={[unresolvedMapping()]}
        availableStatuses={[{ status_id: 'status-2', name: 'Replacement', color: '#000000', is_closed: false }]}
        taskCountByMapping={{}}
        onStatusAdded={vi.fn()}
        onStatusRemoved={vi.fn()}
        onStatusReordered={vi.fn()}
        onStatusReplaced={onStatusReplaced}
      />
    );

    fireEvent.change(screen.getAllByTestId('custom-select')[0], { target: { value: 'status-2' } });
    const replaceButton = container.querySelector('#replace-status-mapping-1');
    expect(replaceButton).not.toBeNull();
    fireEvent.click(replaceButton as HTMLElement);

    await waitFor(() =>
      expect(replaceTemplateStatusMappingMock).toHaveBeenCalledWith('tpl-1', 'mapping-1', {
        type: 'tenant',
        statusId: 'status-2',
      })
    );
    expect(onStatusReplaced).toHaveBeenCalledWith(
      expect.objectContaining({
        mapping: expect.objectContaining({ template_status_mapping_id: 'mapping-1' }),
        unresolvedStatusMappingCount: 0,
      })
    );
  });
});
