// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'react-hot-toast';
import CancellationFeedbackModal from '../../components/settings/account/CancellationFeedbackModal';

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, footer, isOpen }: { children: React.ReactNode; footer: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div>{children}{footer}</div> : null,
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
  TextArea: ({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) => (
    <label>{label}<textarea {...props} /></label>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({
    label,
    options,
    onValueChange,
    ...props
  }: {
    label: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
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
    t: (key: string) => {
      if (key === 'cancellationModal.otherReasonHelp') {
        return 'Please share a little more about what led to your decision.';
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
    onLogout?: () => Promise<void>;
  } = {}) {
    const onClose = overrides.onClose ?? vi.fn();

    render(
      <CancellationFeedbackModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        onLogout={overrides.onLogout}
      />
    );

    return {
      category: screen.getByRole('combobox'),
      feedback: screen.getByRole('textbox'),
      submit: screen.getByRole('button', { name: 'cancellationModal.submitFeedback' }),
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

  it('shows a gentle request for detail when Other is selected', () => {
    const { category } = renderModal();

    fireEvent.change(category, { target: { value: 'Other' } });

    expect(screen.getByText('Please share a little more about what led to your decision.')).toBeInTheDocument();
  });

  it('keeps the modal data open and does not log out when cancellation submission rejects', async () => {
    const onLogout = vi.fn(async () => undefined);
    onConfirm.mockRejectedValue(new Error('Cancellation request failed'));
    const { category, feedback, submit, onClose } = renderModal({ onLogout });

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
    expect(onLogout).not.toHaveBeenCalled();
    expect(category).toHaveValue('Other');
    expect(feedback).toHaveValue('The service no longer fits our current workflow.');
  });
});
