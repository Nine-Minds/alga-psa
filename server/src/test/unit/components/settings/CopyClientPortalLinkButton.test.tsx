/**
 * @vitest-environment jsdom
 *
 * The portal sign-in link is handed out from two screens now — the user list and
 * the client portal branding screen — so the button that copies it lives in one
 * place and both screens must mount that one.
 */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

const handleError = vi.fn();
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ handleError: (...args: unknown[]) => handleError(...args) }));

const getTenantPortalLoginLink = vi.fn();
vi.mock('@alga-psa/client-portal/actions/portal-actions/clientPortalLinkActions', () => ({
  getTenantPortalLoginLink: (...args: unknown[]) => getTenantPortalLoginLink(...args),
}));

const writeText = vi.fn(async () => undefined);

async function renderButton() {
  const { CopyClientPortalLinkButton } = await import(
    '@/components/settings/general/CopyClientPortalLinkButton'
  );
  render(<CopyClientPortalLinkButton />);
  return screen.getByRole('button');
}

describe('CopyClientPortalLinkButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('copies the vanity address when the tenant has a live portal domain', async () => {
    getTenantPortalLoginLink.mockResolvedValue({
      success: true,
      data: { url: 'https://portal.acme.com/auth/client-portal/signin', source: 'vanity', tenantSlug: 'acme' },
    });

    await userEvent.click(await renderButton());

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://portal.acme.com/auth/client-portal/signin'));
    expect(toastSuccess).toHaveBeenCalledWith('users.messages.success.copiedVanityLink');
  });

  it('copies the slugged canonical address otherwise', async () => {
    getTenantPortalLoginLink.mockResolvedValue({
      success: true,
      data: { url: 'https://app.algapsa.com/auth/client-portal/signin?tenant=acme', source: 'canonical', tenantSlug: 'acme' },
    });

    await userEvent.click(await renderButton());

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://app.algapsa.com/auth/client-portal/signin?tenant=acme'),
    );
    expect(toastSuccess).toHaveBeenCalledWith('users.messages.success.copiedCanonicalLink');
  });

  it('surfaces the action error and copies nothing', async () => {
    getTenantPortalLoginLink.mockResolvedValue({
      success: false,
      error: 'Client portal login links are not configured.',
    });

    await userEvent.click(await renderButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Client portal login links are not configured.'));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('reports a browser without clipboard access instead of failing silently', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    getTenantPortalLoginLink.mockResolvedValue({
      success: true,
      data: { url: 'https://portal.acme.com/auth/client-portal/signin', source: 'vanity', tenantSlug: 'acme' },
    });

    await userEvent.click(await renderButton());

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('users.messages.error.clipboardUnavailable'));
  });
});

describe('Copy portal link placement', () => {
  const sourceOf = (relativePath: string) =>
    fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

  it('is offered on the client portal branding screen', () => {
    const settings = sourceOf('src/components/settings/general/ClientPortalSettings.tsx');
    expect(settings).toContain("import { CopyClientPortalLinkButton } from './CopyClientPortalLinkButton'");
    expect(settings).toContain('headerAction={advancedAppearanceEnabled ? (');
    expect(settings).toContain('<CopyClientPortalLinkButton id="copy-client-portal-link-branding-button" />');
  });

  it('keeps the user list on the same shared button', () => {
    const users = sourceOf('src/components/settings/general/UserManagement.tsx');
    expect(users).toContain("import { CopyClientPortalLinkButton } from './CopyClientPortalLinkButton'");
    expect(users).toContain("{portalType === 'client' && <CopyClientPortalLinkButton />}");
    expect(users).not.toContain('getTenantPortalLoginLink');
  });
});
