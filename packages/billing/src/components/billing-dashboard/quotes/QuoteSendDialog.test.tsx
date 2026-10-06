// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer, id }: {
    isOpen: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
    id?: string;
  }) => (isOpen ? <div data-testid={id}>{children}{footer}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options }: {
    id: string;
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('./QuoteSendRecipientsField', () => ({
  QuoteSendRecipientsField: ({ value, onChange, disabled, id, clientId }: {
    value: Array<{ email: string }>;
    onChange: (next: Array<Record<string, unknown>>) => void;
    disabled?: boolean;
    id: string;
    clientId?: string | null;
  }) => (
    <div data-testid={`field-${id}`} data-client-id={clientId ?? ''}>
      <span data-testid="picked-count">{value.length}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([
          ...value,
          { key: 'alice@example.com', email: 'Alice@Example.com', name: 'Alice', kind: 'internal', entityId: 'u1', avatarUrl: null },
        ])}
      >
        Pick Alice
      </button>
    </div>
  ),
}));

import { QuoteSendDialog } from './QuoteSendDialog';
import { DEFAULT_SENDER_SELECTION } from '@alga-psa/email/senderSelection';

const baseProps = {
  idPrefix: 'send-quote',
  isOpen: true,
  clientId: 'client-1',
  isSending: false,
  onClose: vi.fn(),
};

describe('QuoteSendDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('merges picked recipients and typed addresses with case-insensitive de-duplication', () => {
    const onConfirm = vi.fn();
    render(<QuoteSendDialog {...baseProps} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByText('Pick Alice'));
    fireEvent.change(document.getElementById('send-quote-additional-emails') as HTMLInputElement, {
      target: { value: '  alice@example.com , BOB@example.com,  , carol@example.com ' },
    });
    fireEvent.change(document.getElementById('send-quote-message') as HTMLTextAreaElement, {
      target: { value: '  Please review.  ' },
    });
    fireEvent.click(document.getElementById('send-quote-confirm') as HTMLButtonElement);

    expect(onConfirm).toHaveBeenCalledWith({
      email_addresses: ['Alice@Example.com', 'BOB@example.com', 'carol@example.com'],
      message: 'Please review.',
    });
  });

  it('omits recipients and message when nothing is entered', () => {
    const onConfirm = vi.fn();
    render(<QuoteSendDialog {...baseProps} onConfirm={onConfirm} />);

    fireEvent.click(document.getElementById('send-quote-confirm') as HTMLButtonElement);

    expect(onConfirm).toHaveBeenCalledWith({
      email_addresses: undefined,
      message: undefined,
    });
  });

  it('omits the shared default sender and sends an explicitly selected override', () => {
    const onConfirm = vi.fn();
    const senders = [
      { sender_id: 'sender-1', email_address: 'one@example.com' },
      { sender_id: 'sender-2', email_address: 'two@example.com' },
    ];
    const { rerender } = render(
      <QuoteSendDialog
        {...baseProps}
        senders={senders}
        effectiveSenderAddress="provider@example.com"
        senderId={DEFAULT_SENDER_SELECTION}
        onSenderChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const senderSelect = document.getElementById('send-quote-sender') as HTMLSelectElement;
    expect(senderSelect.options[0]?.textContent).toBe('Use default (provider@example.com)');
    fireEvent.click(document.getElementById('send-quote-confirm') as HTMLButtonElement);
    expect(onConfirm).toHaveBeenLastCalledWith({
      email_addresses: undefined,
      message: undefined,
    });

    rerender(
      <QuoteSendDialog
        {...baseProps}
        senders={senders}
        effectiveSenderAddress="provider@example.com"
        senderId="sender-2"
        onSenderChange={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(document.getElementById('send-quote-confirm') as HTMLButtonElement);
    expect(onConfirm).toHaveBeenLastCalledWith({
      email_addresses: undefined,
      message: undefined,
      senderId: 'sender-2',
    });
  });

  it('forwards the provided client id to the picker and disables controls while sending', () => {
    render(<QuoteSendDialog {...baseProps} isSending onConfirm={vi.fn()} />);

    expect(screen.getByTestId('field-send-quote-recipients').getAttribute('data-client-id')).toBe('client-1');
    expect((document.getElementById('send-quote-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('send-quote-cancel') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('send-quote-additional-emails') as HTMLInputElement).disabled).toBe(true);
  });

  it('clears drafted recipients, addresses, and message when closed and reopened for another client', () => {
    const { rerender } = render(<QuoteSendDialog {...baseProps} onConfirm={vi.fn()} />);

    fireEvent.click(screen.getByText('Pick Alice'));
    fireEvent.change(document.getElementById('send-quote-additional-emails') as HTMLInputElement, {
      target: { value: 'typed@example.com' },
    });
    fireEvent.change(document.getElementById('send-quote-message') as HTMLTextAreaElement, {
      target: { value: 'old note' },
    });
    expect(screen.getByTestId('picked-count').textContent).toBe('1');

    rerender(<QuoteSendDialog {...baseProps} isOpen={false} onConfirm={vi.fn()} />);
    rerender(<QuoteSendDialog {...baseProps} isOpen clientId="client-2" onConfirm={vi.fn()} />);

    expect(screen.getByTestId('field-send-quote-recipients').getAttribute('data-client-id')).toBe('client-2');
    expect(screen.getByTestId('picked-count').textContent).toBe('0');
    expect((document.getElementById('send-quote-additional-emails') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('send-quote-message') as HTMLTextAreaElement).value).toBe('');
  });
});
