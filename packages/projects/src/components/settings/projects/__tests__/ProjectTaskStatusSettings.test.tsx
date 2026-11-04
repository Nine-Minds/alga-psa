/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ProjectTaskStatusSettings,
  type ProjectTaskStatusSettingsHandle,
} from '../ProjectTaskStatusSettings';

const getProjectStatusMappings = vi.fn();
const getStatusMappingTaskCount = vi.fn();
const deleteProjectStatusMapping = vi.fn();
const reorderProjectStatuses = vi.fn();
const copyProjectStatusesToPhase = vi.fn();
const removePhaseStatuses = vi.fn();
const addStatusToProject = vi.fn();
const getTenantProjectStatuses = vi.fn();
const getProjectMetadata = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@alga-psa/projects/actions/projectTaskStatusActions', () => ({
  getProjectStatusMappings: (...args: unknown[]) => getProjectStatusMappings(...args),
  getStatusMappingTaskCount: (...args: unknown[]) => getStatusMappingTaskCount(...args),
  deleteProjectStatusMapping: (...args: unknown[]) => deleteProjectStatusMapping(...args),
  reorderProjectStatuses: (...args: unknown[]) => reorderProjectStatuses(...args),
  copyProjectStatusesToPhase: (...args: unknown[]) => copyProjectStatusesToPhase(...args),
  removePhaseStatuses: (...args: unknown[]) => removePhaseStatuses(...args),
  addStatusToProject: (...args: unknown[]) => addStatusToProject(...args),
  getTenantProjectStatuses: (...args: unknown[]) => getTenantProjectStatuses(...args),
  createTenantProjectStatus: vi.fn(),
}));

vi.mock('@alga-psa/projects/actions/projectActions', () => ({
  getProjectMetadata: (...args: unknown[]) => getProjectMetadata(...args),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: (error: unknown) => String(error),
  isActionMessageError: (value: unknown) => Boolean(value && typeof value === 'object' && 'actionError' in value),
  isActionPermissionError: (value: unknown) => Boolean(value && typeof value === 'object' && 'permissionError' in value),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, title, id }: any) =>
    isOpen ? (
      <div id={id} data-testid="dialog">
        <div>{title}</div>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, type = 'button', ...props }: any) => (
    <button type={type} {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ value, onValueChange, options, id }: any) => (
    <select id={id} data-testid="custom-select" value={value ?? ''} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, title, message, onConfirm, onClose, confirmLabel, id }: any) =>
    isOpen ? (
      <div data-testid="confirmation-dialog">
        <div>{title}</div>
        <div>{message}</div>
        <button type="button" id={`${id}-confirm`} onClick={() => onConfirm()}>{confirmLabel}</button>
        <button type="button" id={`${id}-close`} onClick={onClose}>cancel</button>
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/QuickAddStatus', () => ({
  QuickAddStatus: () => null,
}));

function translate(key: string, arg2?: unknown): string {
  if (typeof arg2 === 'string') return arg2;
  const opts = arg2 && typeof arg2 === 'object' ? (arg2 as Record<string, unknown>) : {};
  const template = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
  return template.replace(/{{\s*(\w+)\s*}}/g, (_m, name: string) => String(opts[name] ?? ''));
}

const DEFAULT_MAPPINGS = [
  { project_status_mapping_id: 'm1', status_id: 's1', status_name: 'To Do', is_closed: false, display_order: 1 },
  { project_status_mapping_id: 'm2', status_id: 's2', status_name: 'Waiting on Client', is_closed: false, display_order: 2 },
  { project_status_mapping_id: 'm3', status_id: 's3', status_name: 'Done', is_closed: true, display_order: 3 },
];

beforeEach(() => {
  vi.clearAllMocks();
  getProjectStatusMappings.mockResolvedValue(DEFAULT_MAPPINGS);
  getTenantProjectStatuses.mockResolvedValue([
    { status_id: 's1', name: 'To Do', is_closed: false },
    { status_id: 's2', name: 'Waiting on Client', is_closed: false },
    { status_id: 's3', name: 'Done', is_closed: true },
    { status_id: 's4', name: 'QA Review', is_closed: false },
  ]);
  getProjectMetadata.mockResolvedValue({ phases: [{ phase_id: 'p1', phase_name: 'Phase 1' }] });
  getStatusMappingTaskCount.mockResolvedValue(0);
  deleteProjectStatusMapping.mockResolvedValue(undefined);
  reorderProjectStatuses.mockResolvedValue(undefined);
  copyProjectStatusesToPhase.mockResolvedValue(DEFAULT_MAPPINGS);
  addStatusToProject.mockResolvedValue({ project_status_mapping_id: 'm4' });
});

afterEach(() => {
  cleanup();
});

async function renderInForm(onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())) {
  const handle = React.createRef<ProjectTaskStatusSettingsHandle>();
  const view = render(
    <form onSubmit={onSubmit}>
      <ProjectTaskStatusSettings ref={handle} projectId="proj-1" />
    </form>
  );
  await screen.findByText('Waiting on Client');
  return { ...view, onSubmit, handle };
}

describe('ProjectTaskStatusSettings delete flow', () => {
  it('confirms and deletes an empty status column without submitting the host form', async () => {
    const { container, onSubmit } = await renderInForm();

    fireEvent.click(container.querySelector('#project-status-delete-m2') as HTMLElement);

    await screen.findByText('Remove "Waiting on Client"?');
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector('#project-status-confirm-delete') as HTMLElement);

    await waitFor(() => expect(deleteProjectStatusMapping).toHaveBeenCalledWith('m2', undefined));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('requires a destination when the column still holds tasks', async () => {
    getStatusMappingTaskCount.mockResolvedValue(11);
    const { container, onSubmit } = await renderInForm();

    fireEvent.click(container.querySelector('#project-status-delete-m2') as HTMLElement);

    await screen.findByText('"Waiting on Client" has 11 task(s). Move them to:');
    const moveTarget = container.querySelector('#project-status-move-target-select') as HTMLSelectElement;
    fireEvent.change(moveTarget, { target: { value: 'm3' } });
    // Confirm only once the dialog actually shows the destination, the way an
    // operator would; clicking through an unflushed pick is what made this
    // assertion flake under load.
    await waitFor(() => expect(moveTarget.value).toBe('m3'));
    fireEvent.click(container.querySelector('#project-status-confirm-delete') as HTMLElement);

    await waitFor(() => expect(deleteProjectStatusMapping).toHaveBeenCalledWith('m2', 'm3'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('stages an arrow reorder and writes it only when the host saves', async () => {
    const { container, onSubmit, handle } = await renderInForm();

    fireEvent.click(container.querySelector('#project-status-move-down-m1') as HTMLElement);

    await waitFor(() => expect(container.querySelector('#project-status-pending-banner')).not.toBeNull());
    expect(reorderProjectStatuses).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => {
      await handle.current?.commitPendingChanges();
    });

    expect(reorderProjectStatuses).toHaveBeenCalledWith(
      'proj-1',
      [
        { mapping_id: 'm2', display_order: 1 },
        { mapping_id: 'm1', display_order: 2 },
        { mapping_id: 'm3', display_order: 3 },
      ],
      null
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('writes a staged order before an immediate delete so it is not lost', async () => {
    const { container, handle } = await renderInForm();

    fireEvent.click(container.querySelector('#project-status-move-down-m1') as HTMLElement);
    await waitFor(() => expect(container.querySelector('#project-status-pending-banner')).not.toBeNull());

    fireEvent.click(container.querySelector('#project-status-delete-m2') as HTMLElement);
    await screen.findByText('Remove "Waiting on Client"?');
    fireEvent.click(container.querySelector('#project-status-confirm-delete') as HTMLElement);

    await waitFor(() => expect(deleteProjectStatusMapping).toHaveBeenCalledWith('m2', undefined));
    expect(reorderProjectStatuses).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(handle.current?.hasPendingChanges()).toBe(false));
  });
});

describe('ProjectTaskStatusSettings phase fork', () => {
  async function stageFork() {
    const view = await renderInForm();

    // Switch scope to the phase; it currently inherits the project defaults.
    getProjectStatusMappings.mockImplementation(async (_projectId: string, phaseId?: string | null) =>
      (phaseId ? [] : DEFAULT_MAPPINGS));
    fireEvent.change(view.container.querySelector('#phase-status-scope-select') as HTMLElement, {
      target: { value: 'p1' },
    });

    const forkButton = await waitFor(() => {
      const button = view.container.querySelector('#use-custom-statuses-button') as HTMLButtonElement | null;
      expect(button?.disabled).toBe(false);
      return button as HTMLButtonElement;
    });

    fireEvent.click(forkButton);

    await screen.findByText(/Use custom status columns for this phase\?/);
    expect(copyProjectStatusesToPhase).not.toHaveBeenCalled();

    fireEvent.click(view.container.querySelector('#confirm-phase-status-fork-confirm') as HTMLElement);

    // Confirming only stages the fork — the phase still inherits until a save.
    await screen.findByText('Phase 1 will switch to its own status columns.');
    expect(copyProjectStatusesToPhase).not.toHaveBeenCalled();
    return view;
  }

  it('stages the fork on confirm and forks only when the host saves', async () => {
    const { handle } = await stageFork();

    expect(handle.current?.hasPendingChanges()).toBe(true);

    await act(async () => {
      await handle.current?.commitPendingChanges();
    });

    expect(copyProjectStatusesToPhase).toHaveBeenCalledWith('proj-1', 'p1');
  });

  it('never forks when the staged change is abandoned instead of saved', async () => {
    const { container, unmount } = await stageFork();

    // Flipping back to project defaults drops the staged fork without a write.
    fireEvent.click(container.querySelector('#use-project-defaults-button') as HTMLElement);
    await waitFor(() => expect(container.querySelector('#project-status-pending-banner')).toBeNull());

    unmount();

    expect(copyProjectStatusesToPhase).not.toHaveBeenCalled();
    expect(removePhaseStatuses).not.toHaveBeenCalled();
  });
});

describe('ProjectTaskStatusSettings add flow', () => {
  it('adds a library status inline and re-reads the library when the picker opens', async () => {
    const { container } = await renderInForm();

    expect(getTenantProjectStatuses).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector('#project-status-add-existing-button') as HTMLElement);

    await waitFor(() => expect(getTenantProjectStatuses).toHaveBeenCalledTimes(2));

    fireEvent.change(container.querySelector('#project-status-library-select') as HTMLElement, {
      target: { value: 's4' },
    });
    fireEvent.click(container.querySelector('#project-status-confirm-add-existing') as HTMLElement);

    await waitFor(() => expect(addStatusToProject).toHaveBeenCalledWith('proj-1', { status_id: 's4' }, null));
  });
});
