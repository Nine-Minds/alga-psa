/** @vitest-environment jsdom */

import React from 'react';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      key === 'auth.sso.signInWithGoogle' ? 'Google Übersetzung' : options?.defaultValue ?? key,
  }),
}));

import SsoProviderButtons from '../../../../../packages/auth/src/components/SsoProviderButtons';

describe('SSO provider label hydration', () => {
  const originalEdition = process.env.NEXT_PUBLIC_EDITION;

  afterEach(() => {
    if (originalEdition === undefined) delete process.env.NEXT_PUBLIC_EDITION;
    else process.env.NEXT_PUBLIC_EDITION = originalEdition;
  });

  it('keeps the SSR and initial hydrated Google label identical before applying translations', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    const element = <SsoProviderButtons callbackUrl="/msp" email="user@example.com" />;
    const serverHtml = renderToString(element);
    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.appendChild(container);
    const hydrationErrors: unknown[] = [];

    await act(async () => {
      hydrateRoot(container, element, { onRecoverableError: (error) => hydrationErrors.push(error) });
    });

    expect(hydrationErrors).toEqual([]);
    expect(container.textContent).toContain('Google Übersetzung');
    expect(serverHtml).toContain('Sign in with Google');
    container.remove();
  });
});
