/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import '@testing-library/jest-dom/vitest';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { TemplateCreationWizard } from '../project-templates/TemplateCreationWizard';
import { createTemplateFromWizard } from '../../actions/projectTemplateWizardActions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

// Functional Dialog stand-in: the real shared Dialog funnels backdrop clicks,
// Escape, and the X button into its single `onClose` prop, so the tests drive
// that same funnel through an explicit dismiss trigger.
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, onClose, children, title, footer }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button data-testid="wizard-dismiss" onClick={onClose}>
          dismiss
        </button>
        {children}
        {footer}
      </div>
    ) : null,
}));

// Functional confirmation stand-in mirroring the real ConfirmationDialog
// contract: onClose = safe dismissal (Escape/X/cancel), onConfirm = discard.
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

vi.mock('@alga-psa/ui/components/onboarding/WizardProgress', () => ({
  WizardProgress: ({ currentStep }: any) => <div data-testid="wizard-progress">step:{currentStep}</div>,
}));

vi.mock('@alga-psa/ui/components/onboarding/WizardNavigation', () => ({
  WizardNavigation: ({ onNext, onBack, onFinish }: any) => (
    <div>
      <button data-testid="wizard-back" onClick={onBack}>
        back
      </button>
      <button data-testid="wizard-next" onClick={onNext}>
        next
      </button>
      <button data-testid="wizard-finish" onClick={onFinish}>
        finish
      </button>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
  AlertTitle: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />,
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isActionMessageError: (value: unknown) =>
    Boolean(value && typeof value === 'object' && 'actionError' in (value as object)),
  isActionPermissionError: (value: unknown) =>
    Boolean(value && typeof value === 'object' && 'permissionError' in (value as object)),
}));

// Steps 1-4 are exercised through the shared updateData funnel; keep them
// light while still letting a step author a nested change for dirty tracking.
vi.mock('../project-templates/wizard-steps/TemplateStatusColumnsStep', () => ({
  TemplateStatusColumnsStep: ({ updateData }: any) => (
    <div data-testid="step-status-columns">
      <button
        data-testid="author-status-mapping"
        onClick={() =>
          updateData({
            status_mappings: [
              { temp_id: 'sm-1', standard_status_id: 's-1', custom_name: 'Doing', display_order: 1, is_visible: true },
            ],
          })
        }
      >
        add mapping
      </button>
    </div>
  ),
}));

vi.mock('../project-templates/wizard-steps/TemplatePhasesStep', () => ({
  TemplatePhasesStep: () => <div data-testid="step-phases" />,
}));

vi.mock('../project-templates/wizard-steps/TemplateTasksStep', () => ({
  TemplateTasksStep: () => <div data-testid="step-tasks" />,
}));

vi.mock('../project-templates/wizard-steps/TemplateClientPortalStep', () => ({
  TemplateClientPortalStep: () => <div data-testid="step-client-portal" />,
}));

vi.mock('../project-templates/wizard-steps/TemplateReviewStep', () => ({
  TemplateReviewStep: () => <div data-testid="step-review" />,
}));

vi.mock('../../actions/projectTemplateWizardActions', () => ({
  createTemplateFromWizard: vi.fn(),
}));

vi.mock('../../actions/projectTaskStatusActions', () => ({
  getTenantProjectStatuses: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../actions/projectTaskActions', () => ({
  getTaskTypes: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getAllPriorities: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsers: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/projects/actions/serviceCatalogActions', () => ({
  getServices: vi.fn().mockResolvedValue({ services: [] }),
}));

function translate(key: string, arg2?: unknown): string {
  if (typeof arg2 === 'string') return arg2;
  const opts = arg2 && typeof arg2 === 'object' ? (arg2 as Record<string, unknown>) : {};
  return typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
}

const mockedCreate = vi.mocked(createTemplateFromWizard);

async function renderWizard(props: Partial<React.ComponentProps<typeof TemplateCreationWizard>> = {}) {
  const onOpenChange = vi.fn();
  const onComplete = vi.fn();
  const utils = render(
    <TemplateCreationWizard open onOpenChange={onOpenChange} onComplete={onComplete} {...props} />
  );
  // Let the reference-data load effect settle so it cannot be mistaken for
  // an authored change in any assertion below.
  await waitFor(() => expect(screen.getByLabelText(/Template Name/)).toBeInTheDocument());
  return { onOpenChange, onComplete, ...utils };
}

const nameInput = () => screen.getByLabelText(/Template Name/) as HTMLInputElement;

describe('TemplateCreationWizard dismissal guard', () => {
  beforeEach(() => {
    mockedCreate.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('closes a pristine wizard without a confirmation', async () => {
    const { onOpenChange } = await renderWizard();

    fireEvent.click(screen.getByTestId('wizard-dismiss'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not treat reference-data loading or step navigation as dirty', async () => {
    const { onOpenChange } = await renderWizard();

    // Navigate forward and back without authoring anything.
    fireEvent.click(screen.getByTestId('wizard-next'));
    // Step 0 requires a name, so forward navigation is blocked; navigation
    // attempts and validation errors alone must not arm the guard.
    fireEvent.click(screen.getByTestId('wizard-dismiss'));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('intercepts dismissal after an authored change and keeps data on Keep editing', async () => {
    const { onOpenChange } = await renderWizard();

    fireEvent.change(nameInput(), { target: { value: 'Onboarding Rollout' } });
    fireEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('step-status-columns')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('wizard-dismiss'));

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved template?' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-keep-editing'));

    // Same step, data intact, wizard never closed.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('step-status-columns')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(nameInput().value).toBe('Onboarding Rollout');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('treats nested authored changes on later steps as dirty', async () => {
    const { onOpenChange } = await renderWizard();

    fireEvent.change(nameInput(), { target: { value: 'T' } });
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('author-status-mapping'));

    fireEvent.click(screen.getByTestId('wizard-dismiss'));

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('shows a single confirmation for repeated close requests', async () => {
    const { onOpenChange } = await renderWizard();

    fireEvent.change(nameInput(), { target: { value: 'Repeat' } });
    fireEvent.click(screen.getByTestId('wizard-dismiss'));
    fireEvent.click(screen.getByTestId('wizard-dismiss'));
    fireEvent.click(screen.getByTestId('wizard-dismiss'));

    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('discards the draft and closes; reopening presents a fresh wizard', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<TemplateCreationWizard open onOpenChange={onOpenChange} />);
    await waitFor(() => expect(screen.getByLabelText(/Template Name/)).toBeInTheDocument());

    fireEvent.change(nameInput(), { target: { value: 'Doomed Draft' } });
    fireEvent.click(screen.getByTestId('wizard-dismiss'));
    fireEvent.click(screen.getByTestId('confirm-discard'));

    expect(onOpenChange).toHaveBeenCalledWith(false);

    // Simulate the parent closing and reopening the wizard.
    rerender(<TemplateCreationWizard open={false} onOpenChange={onOpenChange} />);
    rerender(<TemplateCreationWizard open onOpenChange={onOpenChange} />);
    await waitFor(() => expect(screen.getByLabelText(/Template Name/)).toBeInTheDocument());

    expect(nameInput().value).toBe('');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // Fresh wizard is pristine again: dismissal closes without a prompt.
    fireEvent.click(screen.getByTestId('wizard-dismiss'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('bypasses the guard when template creation succeeds', async () => {
    mockedCreate.mockResolvedValue('tpl-123' as any);
    const { onOpenChange, onComplete } = await renderWizard();

    fireEvent.change(nameInput(), { target: { value: 'Ship It' } });
    fireEvent.click(screen.getByTestId('wizard-finish'));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onComplete).toHaveBeenCalledWith('tpl-123');
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('ignores close requests while creation is submitting', async () => {
    let resolveCreate: (value: string) => void = () => {};
    mockedCreate.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve as (value: string) => void; }) as any
    );
    const { onOpenChange } = await renderWizard();

    fireEvent.change(nameInput(), { target: { value: 'In Flight' } });
    fireEvent.click(screen.getByTestId('wizard-finish'));

    // Submission is now pending; every dismissal mechanism must be ignored.
    fireEvent.click(screen.getByTestId('wizard-dismiss'));
    fireEvent.click(screen.getByTestId('wizard-dismiss'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate('tpl-456');
    });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });
});
