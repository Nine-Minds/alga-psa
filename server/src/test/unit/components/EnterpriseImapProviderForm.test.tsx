/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import { ImapProviderForm } from '../../../../../ee/server/src/components/ImapProviderForm';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? ({
    'imapForm.oauth.connected': 'Connected',
    'imapForm.oauth.notConnected': 'Not connected',
  } as Record<string, string>)[key] ?? key }),
}));
vi.mock('@alga-psa/integrations/actions/email-actions/emailProviderActions', () => ({
  createEmailProvider: vi.fn(), updateEmailProvider: vi.fn(),
}));
vi.mock('@alga-psa/integrations/actions/email-actions/inboundTicketDefaultsActions', () => ({
  getInboundTicketDefaults: vi.fn().mockResolvedValue({ defaults: [] }),
}));
afterEach(cleanup);

describe('Enterprise IMAP OAuth status with redacted credentials', () => {
  it.each([
    ['connected', 'Connected'],
    ['reauthorization_required', 'Reauthorization required'],
    ['not_connected', 'Not connected'],
  ])('renders %s from safe server metadata', (status, label) => {
    render(<ImapProviderForm tenant="tenant" onSuccess={vi.fn()} onCancel={vi.fn()} provider={{
      id: 'provider', tenant: 'tenant', providerType: 'imap', providerName: 'Review mailbox',
      mailbox: 'review@example.test', isActive: false,
      imapConfig: { host: 'imap.example.test', port: 993, secure: true, username: 'review',
        auth_type: 'oauth2', oauth_authorization_status: status, folder_filters: [] },
    } as any} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
