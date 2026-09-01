// @vitest-environment node

import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Anonymous requests have no user to resolve a locale against, but they still
 * carry two signals: the language this device last chose, and the language the
 * browser asks for. These are what keep a pre-login page from being stranded in
 * English.
 */

const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }));
const headerStore = vi.hoisted(() => ({ acceptLanguage: null as string | null }));
const outsideRequestScope = vi.hoisted(() => ({ throws: false }));

vi.mock('next/headers.js', () => ({
  cookies: async () => {
    if (outsideRequestScope.throws) {
      throw new Error('`cookies` was called outside a request scope.');
    }
    return { get: (name: string) => (name === 'locale' && cookieStore.value ? { value: cookieStore.value } : undefined) };
  },
  headers: async () => {
    if (outsideRequestScope.throws) {
      throw new Error('`headers` was called outside a request scope.');
    }
    return { get: (name: string) => (name === 'accept-language' ? headerStore.acceptLanguage : null) };
  },
}));

vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('@alga-psa/db/tenant', () => ({ getConnection: vi.fn() }));

const { resolveRequestLocale } = await import('./serverOnly');

describe('resolveRequestLocale', () => {
  beforeEach(() => {
    cookieStore.value = undefined;
    headerStore.acceptLanguage = null;
    outsideRequestScope.throws = false;
  });

  it('prefers the locale cookie the visitor last chose', async () => {
    cookieStore.value = 'de';
    headerStore.acceptLanguage = 'fr-FR,fr;q=0.9';
    await expect(resolveRequestLocale()).resolves.toBe('de');
  });

  it('ignores an unsupported cookie and falls through to Accept-Language', async () => {
    cookieStore.value = 'kl';
    headerStore.acceptLanguage = 'fr-FR,fr;q=0.9';
    await expect(resolveRequestLocale()).resolves.toBe('fr');
  });

  it('matches Accept-Language on the language subtag', async () => {
    headerStore.acceptLanguage = 'pt-BR,pt;q=0.9,en;q=0.8';
    await expect(resolveRequestLocale()).resolves.toBe('pt');
  });

  it('falls back to the system default when the request asks for nothing supported', async () => {
    headerStore.acceptLanguage = 'kl-GL,kl;q=0.9';
    await expect(resolveRequestLocale()).resolves.toBe('en');
  });

  it('falls back to the system default when the request carries no signal', async () => {
    await expect(resolveRequestLocale()).resolves.toBe('en');
  });

  // Scheduled report rendering calls the hierarchical resolver with no request
  // behind it; next/headers throws there and must not take the caller down.
  it('survives being called outside a request scope', async () => {
    outsideRequestScope.throws = true;
    await expect(resolveRequestLocale()).resolves.toBe('en');
  });
});
