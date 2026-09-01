/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { ImapProviderForm } from '@alga-psa/integrations/components';
import { renderWithProviders } from '../../utils/testWrapper';

// Mock server actions (single factory: repeated vi.mock calls for the same
// module override each other, so all exports must live in one mock).
vi.mock('@alga-psa/integrations/actions', () => ({
  createEmailProvider: vi.fn(),
  updateEmailProvider: vi.fn(),
  upsertEmailProvider: vi.fn(),
  getInboundTicketDefaults: vi.fn().mockResolvedValue({ defaults: [] }),
  initiateEmailOAuth: vi.fn().mockResolvedValue({ success: false, error: 'not used in unit tests' }),
}));

import * as emailProviderActions from '@alga-psa/integrations/actions';

const pausedImapProvider = {
  id: 'paused-imap-1',
  tenant: 'test-tenant-123',
  providerType: 'imap' as const,
  providerName: 'Paused IMAP',
  mailbox: 'paused@example.com',
  isActive: true,
  status: 'error' as const,
  inboundPausedAt: '2026-08-16T00:00:00.000Z',
  inboundPauseReason: 'auth_failure' as const,
  imapConfig: {
    email_provider_id: 'paused-imap-1',
    tenant: 'test-tenant-123',
    host: 'imap.example.com',
    port: 993,
    secure: true,
    allow_starttls: false,
    auth_type: 'password' as const,
    username: 'paused',
    folder_filters: ['INBOX'],
    auto_process_emails: true,
    max_emails_per_sync: 5,
    created_at: '2026-08-15T00:00:00.000Z',
    updated_at: '2026-08-15T00:00:00.000Z',
  },
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
};

describe('ImapProviderForm', () => {
  const mockOnSuccess = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultProps = {
    tenant: 'test-tenant-123',
    onSuccess: mockOnSuccess,
    onCancel: mockOnCancel,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'http://localhost:3000',
        href: 'http://localhost:3000',
      },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('should render form fields in edit mode', () => {
    renderWithProviders(<ImapProviderForm {...defaultProps} provider={pausedImapProvider as any} />);

    expect(screen.getByDisplayValue('Paused IMAP')).toBeInTheDocument();
    expect(screen.getByDisplayValue('paused@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('imap.example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update provider/i })).toBeInTheDocument();
  });

  it('should pass the fresh provider through on a successful reconnect save', async () => {
    vi.mocked(emailProviderActions.updateEmailProvider).mockResolvedValueOnce({
      provider: {
        ...pausedImapProvider,
        status: 'connected',
        inboundPausedAt: null,
        inboundPauseReason: null,
      },
    } as any);

    const user = userEvent.setup();
    renderWithProviders(<ImapProviderForm {...defaultProps} provider={pausedImapProvider as any} />);

    await user.click(screen.getByRole('button', { name: /update provider/i }));

    await waitFor(() => {
      expect(emailProviderActions.updateEmailProvider).toHaveBeenCalledTimes(1);
    });
    expect(mockOnSuccess).toHaveBeenCalledTimes(1);
    expect(mockOnSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'paused-imap-1', inboundPausedAt: null })
    );
  });

  it('surfaces setupError in the form and does not report success when reconnect recovery fails', async () => {
    // The Reconnect drawer's save (skipAutomation=true) on an auth-paused
    // provider: the credentials were persisted but recovery refused them, so
    // the action returns setupError AND the still-paused provider. The form
    // must keep the drawer open with the error shown and never call
    // onSuccess — the parent only re-renders the pause banner from the
    // provider delivered on success.
    vi.mocked(emailProviderActions.updateEmailProvider).mockResolvedValueOnce({
      provider: { ...pausedImapProvider },
      setupError: 'Authentication failed',
    } as any);

    const user = userEvent.setup();
    renderWithProviders(<ImapProviderForm {...defaultProps} provider={pausedImapProvider as any} />);

    await user.click(screen.getByRole('button', { name: /update provider/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Provider saved but setup incomplete: Authentication failed/)
      ).toBeInTheDocument();
    });

    expect(mockOnSuccess).not.toHaveBeenCalled();
  });
});
