/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

// The component freezes `isEnterprise` from process.env.NEXT_PUBLIC_EDITION at
// module-load time. The unit suite runs single-fork, so process.env is shared
// across files; a prior test leaving NEXT_PUBLIC_EDITION=enterprise would flip
// this CE-only component to its EE branch and fail every assertion here. Pin
// Community Edition before the component import (hoisted above it) — a
// beforeEach would be too late, since the import is already evaluated by then.
const originalEdition = vi.hoisted(() => {
  const previous = process.env.NEXT_PUBLIC_EDITION;
  process.env.NEXT_PUBLIC_EDITION = 'community';
  return previous;
});

const listMspSsoLoginDomainsMock = vi.hoisted(() => vi.fn());
const saveMspSsoLoginDomainsMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const i18nMock = vi.hoisted(() => {
  const t = (_key: string, options?: Record<string, unknown>) => {
    const template = typeof options?.defaultValue === 'string' ? options.defaultValue : _key;
    return template.replace(/\{\{(\w+)\}\}/g, (match, name) =>
      options && options[name] != null ? String(options[name]) : match,
    );
  };

  return {
    t,
    translation: { t },
  };
});

vi.mock('@alga-psa/integrations/actions/integrations/mspSsoDomainActions', () => ({
  listMspSsoLoginDomains: (...args: unknown[]) => listMspSsoLoginDomainsMock(...args),
  saveMspSsoLoginDomains: (...args: unknown[]) => saveMspSsoLoginDomainsMock(...args),
  listMspSsoDomainClaims: vi.fn(),
  refreshMspSsoDomainClaimChallenge: vi.fn(),
  requestMspSsoDomainClaim: vi.fn(),
  revokeMspSsoDomainClaim: vi.fn(),
  verifyMspSsoDomainClaimOwnership: vi.fn(),
}));

vi.mock('@alga-psa/ui/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => i18nMock.translation,
  useFormatters: () => ({
    formatDate: (d: Date | string) => String(d),
    formatNumber: (n: number) => String(n),
    formatCurrency: (n: number) => String(n),
    formatRelativeTime: (d: Date | string) => String(d),
  }),
  useI18n: () => ({ locale: 'en' }),
  useOptionalI18n: () => ({ locale: 'en' }),
  detectClientLocale: () => 'en',
  I18nProvider: ({ children }: any) => children,
}));

import { MspSsoLoginDomainsSettings } from '@alga-psa/integrations/components/settings/integrations/MspSsoLoginDomainsSettings';

describe('MspSsoLoginDomainsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMspSsoLoginDomainsMock.mockResolvedValue({ success: true, domains: ['acme.com'] });
    saveMspSsoLoginDomainsMock.mockResolvedValue({ success: true, domains: ['acme.com'] });
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    if (originalEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalEdition;
    }
  });

  it('T012: renders MSP SSO login-domain management section', async () => {
    render(<MspSsoLoginDomainsSettings />);

    expect(screen.getByText('MSP SSO Login Domains')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByDisplayValue('acme.com')).toBeInTheDocument();
    });
  });

  it('T013: add-domain flow saves and refreshes rendered domain list', async () => {
    const user = userEvent.setup();
    saveMspSsoLoginDomainsMock.mockResolvedValueOnce({
      success: true,
      domains: ['acme.com', 'beta.com'],
    });

    render(<MspSsoLoginDomainsSettings />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('acme.com')).toBeInTheDocument();
    });

    await user.type(screen.getByDisplayValue(''), 'beta.com');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Save Domains' }));

    expect(saveMspSsoLoginDomainsMock).toHaveBeenCalledWith({
      domains: ['acme.com', 'beta.com'],
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue('beta.com')).toBeInTheDocument();
    });
  });

  it('T014: remove-domain flow saves and removes domain row from view', async () => {
    const user = userEvent.setup();
    listMspSsoLoginDomainsMock.mockResolvedValueOnce({
      success: true,
      domains: ['acme.com', 'beta.com'],
    });
    saveMspSsoLoginDomainsMock.mockResolvedValueOnce({
      success: true,
      domains: ['beta.com'],
    });

    render(<MspSsoLoginDomainsSettings />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('acme.com')).toBeInTheDocument();
      expect(screen.getByDisplayValue('beta.com')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Remove domain 1'));
    await user.click(screen.getByRole('button', { name: 'Save Domains' }));

    expect(saveMspSsoLoginDomainsMock).toHaveBeenCalledWith({
      domains: ['beta.com'],
    });
    await waitFor(() => {
      expect(screen.queryByDisplayValue('acme.com')).not.toBeInTheDocument();
    });
  });

  it('T015: shows malformed-domain validation errors without backend internals', async () => {
    const user = userEvent.setup();
    saveMspSsoLoginDomainsMock.mockResolvedValue({
      success: false,
      error: 'Invalid domain "bad_domain". Enter a valid domain like example.com.',
    });

    render(<MspSsoLoginDomainsSettings />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('acme.com')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Save Domains' }));

    expect(await screen.findByText(/invalid domain "bad_domain"/i)).toBeInTheDocument();
    expect(screen.queryByText(/SQL|stack|trace/i)).not.toBeInTheDocument();
  });

  it('T016: shows neutral conflict/ambiguity error messaging with actionable details', async () => {
    const user = userEvent.setup();
    saveMspSsoLoginDomainsMock.mockResolvedValue({
      success: false,
      error: 'One or more domains are already in use.',
      conflicts: ['acme.com'],
    });

    render(<MspSsoLoginDomainsSettings />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('acme.com')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Save Domains' }));

    expect(await screen.findByText(/one or more domains are already in use\./i)).toBeInTheDocument();
    expect(await screen.findByText(/conflicts: acme\.com\./i)).toBeInTheDocument();
  });

  it('T022: renders CE advisory copy and guidance', async () => {
    render(<MspSsoLoginDomainsSettings />);

    expect(
      await screen.findByText(
        /advisory mode: domain registration helps route msp sso discovery but does not require ownership verification in community edition\./i,
      ),
    ).toBeInTheDocument();
  });

  it('T023: CE advisory controls persist add/remove domain registrations', async () => {
    const user = userEvent.setup();
    listMspSsoLoginDomainsMock.mockResolvedValueOnce({
      success: true,
      domains: ['acme.com', 'old.example'],
    });
    saveMspSsoLoginDomainsMock.mockResolvedValueOnce({
      success: true,
      domains: ['acme.com', 'beta.com'],
    });

    render(<MspSsoLoginDomainsSettings />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('acme.com')).toBeInTheDocument();
      expect(screen.getByDisplayValue('old.example')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Remove domain 2'));
    await user.type(screen.getByDisplayValue(''), 'beta.com');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Save Domains' }));

    expect(saveMspSsoLoginDomainsMock).toHaveBeenCalledWith({
      domains: ['acme.com', 'beta.com'],
    });
    expect(await screen.findByDisplayValue('beta.com')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('old.example')).not.toBeInTheDocument();
  });

  it('T024: CE settings copy states unmanaged domain fallback to Nine Minds app-level providers', async () => {
    render(<MspSsoLoginDomainsSettings />);

    expect(
      await screen.findByText(
        /register advisory domains for msp login sso discovery\. ownership verification is not enforced in community edition, and unmanaged domains fall back to nine minds app-level providers\./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /domains without an eligible tenant claim use the nine minds app-level sso provider configuration\./i,
      ),
    ).toBeInTheDocument();
  });
});
