// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'react-hot-toast';
import CancellationFeedbackModal from '../../components/settings/account/CancellationFeedbackModal';

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({
    children,
    footer,
    hideCloseButton,
    isOpen,
    onClose,
  }: {
    children: React.ReactNode;
    footer: React.ReactNode;
    hideCloseButton?: boolean;
    isOpen: boolean;
    onClose: () => void;
  }) => isOpen ? (
    <div>
      {children}
      {footer}
      {!hideCloseButton && <button aria-label="Close" onClick={onClose}>Close</button>}
    </div>
  ) : null,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({ label, wrapperClassName: _wrapperClassName, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; wrapperClassName?: string }) => (
    <label>{label}<textarea {...props} /></label>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({
    label,
    options,
    onValueChange,
    allowClear: _allowClear,
    ...props
  }: {
    label: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
    allowClear?: boolean;
  } & React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <label>
      {label}
      <select {...props} onChange={(event) => onValueChange(event.target.value)}>
        <option value="">Select a reason</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  ),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      if (key === 'cancellationModal.beforeYouCancelBody') {
        return `Access ends ${values?.date}`;
      }
      return key;
    },
  }),
}));

vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe('CancellationFeedbackModal', () => {
  const onConfirm = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    onConfirm.mockResolvedValue(undefined);
  });

  function renderModal(overrides: {
    onClose?: () => void;
    subscriptionEndDate?: string;
    hasScheduledLicenseChange?: boolean;
  } = {}) {
    const onClose = overrides.onClose ?? vi.fn();

    render(
      <CancellationFeedbackModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        subscriptionEndDate={overrides.subscriptionEndDate}
        hasScheduledLicenseChange={overrides.hasScheduledLicenseChange}
      />
    );

    return {
      category: screen.getByRole('combobox'),
      feedback: screen.getByRole('textbox'),
      submit: screen.getByRole('button', { name: 'dangerZone.cancelSubscription' }),
      onClose,
    };
  }

  it('allows cancellation without providing feedback', async () => {
    const { category, feedback, submit } = renderModal();

    expect(submit).toBeEnabled();
    expect(category).not.toBeRequired();
    expect(feedback).not.toBeRequired();
    expect(feedback).not.toHaveAttribute('maxlength');

    await act(async () => {
      fireEvent.click(submit);
    });

    expect(onConfirm).toHaveBeenCalledWith('', undefined);
  });

  it('submits trimmed feedback without imposing a maximum length', async () => {
    const { category, feedback, submit } = renderModal();
    const reasonText = 'x'.repeat(5_000);

    fireEvent.change(category, { target: { value: 'Pricing too high' } });
    fireEvent.change(feedback, { target: { value: `  ${reasonText}  ` } });

    await act(async () => {
      fireEvent.click(submit);
    });

    expect(onConfirm).toHaveBeenCalledWith(reasonText, 'Pricing too high');
  });

  it('shows the subscription end date and scheduled-change consequence', () => {
    renderModal({
      subscriptionEndDate: '2026-09-01T00:00:00.000Z',
      hasScheduledLicenseChange: true,
    });

    expect(screen.getByText(/Access ends .*2026/)).toBeInTheDocument();
    expect(screen.getByText('cancellationModal.replacesScheduledChange')).toBeInTheDocument();
  });

  it('keeps the modal data open when cancellation submission rejects', async () => {
    onConfirm.mockRejectedValue(new Error('Cancellation request failed'));
    const { category, feedback, submit, onClose } = renderModal();

    fireEvent.change(category, { target: { value: 'Other' } });
    fireEvent.change(feedback, {
      target: { value: 'The service no longer fits our current workflow.' },
    });

    await act(async () => {
      fireEvent.click(submit);
    });

    expect(toast.error).toHaveBeenCalledWith('Cancellation request failed');
    expect(toast.success).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(category).toHaveValue('Other');
    expect(feedback).toHaveValue('The service no longer fits our current workflow.');
  });

  it('prevents dismissal while cancellation is in progress', async () => {
    let resolveCancellation: (() => void) | undefined;
    onConfirm.mockReturnValue(new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    }));
    const { submit, onClose } = renderModal();

    fireEvent.click(submit);

    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(submit).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveCancellation?.();
    });
  });
});
