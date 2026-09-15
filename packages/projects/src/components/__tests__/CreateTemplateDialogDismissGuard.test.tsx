/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import CreateTemplateDialog from '../project-templates/CreateTemplateDialog';
import { createTemplateFromProject } from '../../actions/projectTemplateActions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

// Functional Dialog stand-in: the real shared Dialog funnels backdrop clicks,
// Escape, and the X button into its single `onClose` prop.
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, onClose, children, title, footer }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button data-testid="dialog-dismiss" onClick={onClose}>
          dismiss
        </button>
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, onClose, onConfirm, title, message, confirmLabel, cancelLabel }: any) =>
    isOpen ? (
      <div role="alertdialog" aria-label={title}>
        <p>{message}</p>
        <button data-testid="confirm-keep-editing" onClick={onClose}>
          {cancelLabel}
        </button>
        <button data-testid="confirm-discard" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ label, ...props }: any) => (
    <label>
      <input type="checkbox" {...props} />
      {label}
    </label>
  ),
}));

// Portaled select stand-in: exercising it must author a change without ever
// being treated as an outside click / close request.
vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: any) => (
    <select
      data-testid={id}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" />
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  handleError: vi.fn(),
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

vi.mock('../../actions/projectTemplateActions', () => ({
  createTemplateFromProject: vi.fn(),
  getTemplateCategories: vi.fn().mockResolvedValue(['Networking']),
}));

vi.mock('../../actions/projectActions', () => ({
  getProjects: vi
    .fn()
    .mockResolvedValue([{ project_id: 'proj-1', project_name: 'Migration', wbs_code: 'WBS-1' }]),
}));

function translate(key: string, arg2?: unknown): string {
  if (typeof arg2 === 'string') return arg2;
  const opts = arg2 && typeof arg2 === 'object' ? (arg2 as Record<string, unknown>) : {};
  return typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
}

const mockedCreate = vi.mocked(createTemplateFromProject);

async function renderDialog(props: Partial<React.ComponentProps<typeof CreateTemplateDialog>> = {}) {
  const onClose = vi.fn();
  const onTemplateCreated = vi.fn();
  render(<CreateTemplateDialog onClose={onClose} onTemplateCreated={onTemplateCreated} {...props} />);
  // Wait for the reference data (projects/categories) to load so the tests
  // prove background loading alone never arms the guard.
  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'Migration (WBS-1)' })).toBeInTheDocument()
  );
  return { onClose, onTemplateCreated };
}

describe('CreateTemplateDialog dismissal guard', () => {
  beforeEach(() => {
    mockedCreate.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('closes a pristine dialog without a confirmation, even after reference data loads', async () => {
    const { onClose } = await renderDialog();

    fireEvent.click(screen.getByTestId('dialog-dismiss'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('intercepts dismissal once a field was authored and keeps data on Keep editing', async () => {
    const { onClose } = await renderDialog();

    fireEvent.change(screen.getByPlaceholderText('Enter template name'), {
      target: { value: 'From Project' },
    });
    fireEvent.click(screen.getByTestId('dialog-dismiss'));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved template?' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-keep-editing'));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect((screen.getByPlaceholderText('Enter template name') as HTMLInputElement).value).toBe(
      'From Project'
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('routes the Cancel button through the same guard', async () => {
    const { onClose } = await renderDialog();

    fireEvent.change(screen.getByTestId('source-project'), { target: { value: 'proj-1' } });
    fireEvent.click(screen.getByText('Cancel'));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-discard'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('treats copy-option toggles as authored changes', async () => {
    const { onClose } = await renderDialog();

    fireEvent.click(screen.getByLabelText('Copy task assignments'));
    fireEvent.click(screen.getByTestId('dialog-dismiss'));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('is pristine when opened prefilled with an initial project id', async () => {
    const { onClose } = await renderDialog({ initialProjectId: 'proj-1' });

    fireEvent.click(screen.getByTestId('dialog-dismiss'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('bypasses the guard on successful creation and blocks closes while submitting', async () => {
    let resolveCreate: (value: string) => void = () => {};
    mockedCreate.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve as (value: string) => void; }) as any
    );
    const { onClose, onTemplateCreated } = await renderDialog();

    fireEvent.change(screen.getByTestId('source-project'), { target: { value: 'proj-1' } });
    fireEvent.change(screen.getByPlaceholderText('Enter template name'), {
      target: { value: 'From Project' },
    });
    fireEvent.submit(document.getElementById('create-template-dialog-form') as HTMLFormElement);

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));

    // Close attempts during submission are ignored outright.
    fireEvent.click(screen.getByTestId('dialog-dismiss'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate('tpl-789');
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onTemplateCreated).toHaveBeenCalledWith('tpl-789');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
