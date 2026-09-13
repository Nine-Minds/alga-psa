// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      overallStatus: 'warn',
    },
    steps: [
      {
        id: 'graph_me',
        title: 'Authenticated Microsoft identity',
        status: 'pass',
        durationMs: 12,
        http: { method: 'GET', path: '/me', status: 200, requestId: 'req-1', clientRequestId: 'cli-1' },
        data: { userPrincipalName: 'auth@example.com' },
      },
      {
        id: 'send_as_probe',
        title: 'Exchange Send As verification',
        status: 'warn',
        durationMs: 3,
        detail: 'Exchange Send As has not been verified.',
        error: { message: 'Not verified', status: 403, code: 'ErrorAccessDenied', requestId: 'req-403' },
      },
    ],
    recommendations: ['Exchange Send As has not been verified.'],
    supportBundle: {
      createdAt: '2026-09-13T00:00:00.000Z',
      summary: { effectiveSender: '[redacted-email]' },
      steps: [],
      recommendations: [],
    },
    ...overrides,
  };
}

describe('OutboundEmailDiagnosticsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runOutboundEmailDiagnosticsMock.mockResolvedValue({ success: true, report: makeReport() });
  });

  it('runs diagnostics on open and renders identities, protocol evidence and status rows', async () => {
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);

    await waitFor(() => expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledTimes(1));
    // Default diagnostics must not request a live send.
    expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledWith({ liveSendTest: false, recipient: undefined });

    expect(await screen.findByText('Authenticated Microsoft identity')).toBeInTheDocument();
    expect(screen.getAllByText(/auth@example\.com/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/sender@example\.com/).length).toBeGreaterThan(0);
    expect(screen.getByText(/\/users\/sender@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/request-id: req-1/)).toBeInTheDocument();
    expect(screen.getByText(/client-request-id: cli-1/)).toBeInTheDocument();
    expect(screen.getAllByText('Exchange Send As has not been verified.').length).toBeGreaterThan(0);
    expect(screen.getByText(/Support export redacts mailbox identifiers/)).toBeInTheDocument();
  });

  it('renders action/transport errors with a retry path', async () => {
    runOutboundEmailDiagnosticsMock
      .mockResolvedValueOnce({ success: false, error: 'Permission denied' })
      .mockResolvedValueOnce({ success: true, report: makeReport() });
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);

    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Authenticated Microsoft identity')).toBeInTheDocument();
  });

  it('validates the recipient and does not live-send until opted in with a valid address', async () => {
    render(<OutboundEmailDiagnosticsDialog isOpen onClose={() => {}} />);
    await waitFor(() => expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByLabelText('Send one test message (live)'));
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /run with live send/i }));

    expect(await screen.findByText('Enter a valid recipient email address.')).toBeInTheDocument();
    expect(runOutboundEmailDiagnosticsMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'admin@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /run with live send/i }));
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
});
