// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutboundEmailDiagnosticsDialog } from './OutboundEmailDiagnosticsDialog';

const { runOutboundEmailDiagnosticsMock } = vi.hoisted(() => ({
  runOutboundEmailDiagnosticsMock: vi.fn(),
}));

vi.mock('../../../actions/email-actions/emailSettingsActions', () => ({
  runOutboundEmailDiagnostics: runOutboundEmailDiagnosticsMock,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, isOpen }: any) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: ({ id, checked, onChange }: any) => (
    <input id={id} type="checkbox" checked={checked} onChange={onChange} />
  ),
}));

vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({
  default: ({ text }: any) => <div>{text}</div>,
}));

function makeReport(overrides: Record<string, any> = {}) {
  return {
    createdAt: '2026-09-13T00:00:00.000Z',
    summary: {
      providerId: 'p1',
      providerType: 'microsoft',
      configuredMailbox: 'sender@example.com',
      ticketingFromEmail: 'ticketing@example.com',
      effectiveSender: 'sender@example.com',
      authenticatedUserEmail: 'auth@example.com',
      mailboxBasePath: '/users/sender@example.com',
      checkedCapabilities: ['oauth_tokens'],
      liveSendRequested: false,
      liveSendPerformed: false,
      overallStatus: 'pass',
    },
    steps: [
      {
        id: 'graph_me',
        title: 'Connected Microsoft account',
        status: 'pass',
        durationMs: 12,
        http: { method: 'GET', path: '/me', status: 200, requestId: 'req-1', clientRequestId: 'cli-1' },
        data: { userPrincipalName: 'auth@example.com' },
      },
      {
        id: 'sent_items_writable',
        title: 'Sent Items accessibility',
        status: 'warn',
        durationMs: 3,
        detail: 'Sent Items folder could not be inspected.',
        error: { message: 'Not verified', status: 403, code: 'ErrorAccessDenied', requestId: 'req-403' },
      },
    ],
    recommendations: [],
    supportBundle: {
      createdAt: '2026-09-13T00:00:00.000Z',
      summary: { effectiveSender: '[redacted-email]' },
      steps: [{ id: 'graph_me', http: { path: '/me', status: 200, requestId: 'req-1' } }],
      recommendations: [],
    },
    ...overrides,
  };
}

describe('OutboundEmailDiagnosticsDialog', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
    if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
    else Reflect.deleteProperty(document, 'execCommand');
  });
  beforeEach(() => {
    vi.clearAllMocks();
    runOutboundEmailDiagnosticsMock.mockResolvedValue({ success: true, report: makeReport() });
  });

  it('shows administrator results while keeping protocol evidence in closed support details', async () => {
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);

    await waitFor(() => expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledTimes(1));
    // Default diagnostics must not request a live send.
    expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledWith({ liveSendTest: false, recipient: undefined });

    expect(await screen.findByText('Connected Microsoft account')).toBeInTheDocument();
    expect(screen.getAllByText(/auth@example\.com/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/sender@example\.com/).length).toBeGreaterThan(0);
    const technical = screen.getByText('Technical details for support').closest('details');
    expect(technical).not.toHaveAttribute('open');
    expect(technical).not.toHaveTextContent('sender@example.com');
    expect(technical).toHaveTextContent('req-1');
    expect(screen.getByText('Setup checks passed')).toBeInTheDocument();
    expect(screen.getByText('These checks did not send an email.')).toBeInTheDocument();
    expect(screen.queryByText('Sent Items accessibility')).not.toBeInTheDocument();
    expect(screen.getByText(/The Sent Items folder could not be checked/)).toBeInTheDocument();
    expect(screen.getByText(/Share this report with support/)).toBeInTheDocument();
  });

  it('renders action/transport errors with a retry path', async () => {
    runOutboundEmailDiagnosticsMock
      .mockResolvedValueOnce({ success: false, error: 'Permission denied' })
      .mockResolvedValueOnce({ success: true, report: makeReport() });
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);

    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Connected Microsoft account')).toBeInTheDocument();
  });

  it('validates the recipient and does not live-send until opted in with a valid address', async () => {
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);
    await waitFor(() => expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('Send a test email'));
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /send test email/i }));

    expect(await screen.findByText('Enter a valid recipient email address.')).toBeInTheDocument();
    expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'admin@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send test email/i }));
    await waitFor(() => expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledTimes(2));
    expect(runOutboundEmailDiagnosticsMock).toHaveBeenLastCalledWith({
      liveSendTest: true,
      recipient: 'admin@example.com',
    });
  });

  it('shows the saved-settings notice when the screen has unsaved changes', async () => {
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} hasUnsavedChanges />);
    expect(
      await screen.findByText(/Unsaved changes on this screen are not included/),
    ).toBeInTheDocument();
  });
  it('copies only the sanitized bundle without running diagnostics again', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy report' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(makeReport().supportBundle, null, 2));
    expect(writeText.mock.calls[0][0]).not.toContain('sender@example.com');
    expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledTimes(1);
  });

  it('copies on HTTP installations without the Clipboard API and removes the temporary field', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    let copiedText = '';
    const execCommand = vi.fn(() => {
      copiedText = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);
    const button = await screen.findByRole('button', { name: 'Copy report' });
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(JSON.parse(copiedText)).toEqual(makeReport().supportBundle);
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledTimes(1);
  });

  it.each(['unavailable', 'denied'])('offers Download when clipboard copying is %s', async (reason) => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: reason === 'denied'
      ? { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) } : undefined });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy report' }));
    expect(await screen.findByText('Could not copy the report. Use Download report to save it as a file.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('offers send verification as guidance beside the live-send action', async () => {
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);
    const guidance = await screen.findByText('Send a test email to confirm this account can send from the selected mailbox.');
    expect(guidance.closest('details')).toBeNull();
    expect(screen.queryByText('Exchange Send As verification')).not.toBeInTheDocument();
    expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledWith({ liveSendTest: false, recipient: undefined });
  });

  it('removes the invitation to verify sending after a live send has run', async () => {
    runOutboundEmailDiagnosticsMock.mockResolvedValue({ success: true, report: makeReport({
      summary: { ...makeReport().summary, liveSendPerformed: true, liveSendRequested: true },
    }) });
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);
    await screen.findByRole('button', { name: 'Copy report' });
    expect(screen.queryByText('Send a test email to confirm this account can send from the selected mailbox.')).not.toBeInTheDocument();
  });

  it('removes the previous report when a rerun fails', async () => {
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);
    await screen.findByText('Setup checks passed');
    runOutboundEmailDiagnosticsMock.mockResolvedValue({ success: false, error: 'Permission denied' });
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByText('Permission denied');
    expect(screen.queryByText('Setup checks passed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy report' })).not.toBeInTheDocument();
  });

  it('does not claim a message was unsent when the send request fails without a result', async () => {
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);
    fireEvent.click(await screen.findByLabelText('Send a test email'));
    fireEvent.change(screen.getByLabelText('Send to'), { target: { value: 'admin@example.com' } });
    runOutboundEmailDiagnosticsMock.mockRejectedValue(new Error('Network response lost'));
    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(await screen.findByText('We could not confirm whether the test email was sent. Check the recipient’s inbox before trying again.')).toBeInTheDocument();
    expect(screen.queryByText('These checks did not send an email.')).not.toBeInTheDocument();
  });

  it('shows test-email acceptance without expanding technical details', async () => {
    const detail = 'The email service accepted the test email. Check the recipient’s inbox and spam folder to confirm delivery.';
    runOutboundEmailDiagnosticsMock.mockResolvedValue({ success: true, report: makeReport({
      summary: { ...makeReport().summary, liveSendPerformed: true, liveSendRequested: true },
      steps: [{ id: 'live_send_test', title: 'Test email', status: 'pass', durationMs: 1, detail, data: { accepted: true, delivered: false } }],
    }) });
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);
    const result = await screen.findByText(detail);
    expect(result.closest('details')).toBeNull();
    expect(screen.queryByText('These checks did not send an email.')).not.toBeInTheDocument();
  });

});
