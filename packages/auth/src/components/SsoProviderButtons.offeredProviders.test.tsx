/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('next-auth/react', () => ({ signIn: vi.fn(async () => null) }));

import SsoProviderButtons from './SsoProviderButtons';

const savedEdition = process.env.NEXT_PUBLIC_EDITION;

function buildFetchMock(discoverProviders: string[] = []) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/auth/providers') {
      return { ok: true, json: async () => ({ google: {}, 'azure-ad': {}, keycloak: {} }) };
    }
    if (url === '/api/auth/client-portal/sso/discover') {
      return { ok: true, json: async () => ({ ok: true, providers: discoverProviders }) };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  });
}

const fetchedUrls = (mock: ReturnType<typeof buildFetchMock>) => mock.mock.calls.map(([url]) => String(url));

describe('SsoProviderButtons offeredProviders (client portal)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    if (savedEdition === undefined) delete process.env.NEXT_PUBLIC_EDITION;
    else process.env.NEXT_PUBLIC_EDITION = savedEdition;
  });

  it('renders only the offered provider on the first render and never fetches the NextAuth registry', async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SsoProviderButtons
        callbackUrl="/client-portal"
        authSurface="client_portal"
        tenantHint="abc123def456"
        offeredProviders={['azure-ad']}
      />,
    );

    // Synchronously after render: no effect has had a chance to widen or narrow the set.
    expect(document.getElementById('sso-provider-azure-ad-button')).not.toBeNull();
    expect(document.getElementById('sso-provider-google-button')).toBeNull();
    expect(document.getElementById('sso-provider-keycloak-button')).toBeNull();
    expect(screen.getByText('Sign in with Microsoft')).toBeTruthy();

    // Let effects and any fetch settle, then check again.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchedUrls(fetchMock)).not.toContain('/api/auth/providers');
    expect(document.getElementById('sso-provider-google-button')).toBeNull();
  });

  it('renders nothing for an empty offered list', async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(
      <SsoProviderButtons callbackUrl="/client-portal" authSurface="client_portal" offeredProviders={[]} />,
    );

    expect(container.innerHTML).toBe('');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still lets discovery drive enabled/disabled for an offered provider', async () => {
    const fetchMock = buildFetchMock(['azure-ad']);
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SsoProviderButtons
        callbackUrl="/client-portal"
        authSurface="client_portal"
        tenantHint="abc123def456"
        email="user@example.com"
        offeredProviders={['google', 'azure-ad']}
      />,
    );

    await waitFor(() =>
      expect((document.getElementById('sso-provider-azure-ad-button') as HTMLButtonElement).disabled).toBe(false),
    );
    expect((document.getElementById('sso-provider-google-button') as HTMLButtonElement).disabled).toBe(true);
    expect(fetchedUrls(fetchMock)).not.toContain('/api/auth/providers');
  });

  it('does not let an offered list widen the edition set (CE client portal stays empty)', () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    vi.stubGlobal('fetch', buildFetchMock());

    const { container } = render(
      <SsoProviderButtons
        callbackUrl="/client-portal"
        authSurface="client_portal"
        offeredProviders={['google', 'azure-ad', 'keycloak']}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('keeps the registry-driven set on the MSP surface when the prop is omitted', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/providers') {
        return { ok: true, json: async () => ({ 'azure-ad': {} }) };
      }
      throw new Error(`Unexpected fetch URL: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SsoProviderButtons callbackUrl="/msp" />);

    // Before the registry answers every edition provider renders...
    expect(document.getElementById('sso-provider-google-button')).not.toBeNull();
    // ...then it narrows to what NextAuth registered.
    await waitFor(() => expect(document.getElementById('sso-provider-google-button')).toBeNull());
    expect(document.getElementById('sso-provider-azure-ad-button')).not.toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('/api/auth/providers');
  });
});
