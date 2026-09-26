/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pendingReads = vi.hoisted(() => [] as Array<{
  language: string;
  namespace: string;
  callback: (error: Error | null, data?: unknown) => void;
}>);

vi.mock('i18next-http-backend', () => ({
  default: {
    type: 'backend',
    init: () => {},
    read: (
      language: string,
      namespace: string,
      callback: (error: Error | null, data?: unknown) => void,
    ) => pendingReads.push({ language, namespace, callback }),
  },
}));

vi.unmock('i18next');
vi.unmock('react-i18next');
vi.unmock('@alga-psa/ui/lib/i18n/client');

const { I18nProvider, useTranslation } = await import('./client');

function SignInForm() {
  const { t } = useTranslation('msp/auth', { useSuspense: false });
  const [email, setEmail] = useState('');

  return (
    <form aria-label="Sign in">
      <label htmlFor="recovery-signin-email">
        {t('signIn.form.emailLabel', { defaultValue: 'Email' })}
      </label>
      <input
        id="recovery-signin-email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <output data-testid="three-argument-plural">
        {t('articleCount', '{{count}} article', { count: 3 })}
      </output>
      <output data-testid="three-argument-singular">
        {t('articleCount', '{{count}} article', { count: 1 })}
      </output>
    </form>
  );
}

describe('I18nProvider auth loading recovery', () => {
  afterEach(() => {
    cleanup();
    pendingReads.length = 0;
  });

  it('keeps sign-in inputs usable while backend reads are pending, then applies translations', async () => {
    const initSpy = vi.spyOn(i18next, 'init');
    render(
      <React.StrictMode>
        <I18nProvider
          initialLocale="en"
          namespaces={['common', 'msp/auth']}
          renderChildrenWhileLoading
        >
          <SignInForm />
        </I18nProvider>
      </React.StrictMode>,
    );

    const email = await screen.findByRole('textbox', { name: 'Email' });
    expect(screen.queryByText('Loading translations...')).toBeNull();
    expect(pendingReads.length).toBeGreaterThan(0);
    expect(pendingReads.some((request) => request.namespace === 'common')).toBe(true);
    expect(i18next.isInitialized).not.toBe(true);
    expect(initSpy).toHaveBeenCalledTimes(1);

    fireEvent.change(email, { target: { value: 'operator@example.test' } });
    expect((email as HTMLInputElement).value).toBe('operator@example.test');

    await act(async () => {
      const firstBatch = pendingReads.splice(0);
      for (const request of firstBatch) {
        request.callback(null, request.namespace === 'msp/auth'
          ? {
            signIn: { form: { emailLabel: 'Courriel' } },
            articleCount_one: '{{count}} article',
            articleCount_other: '{{count}} articles',
          }
          : {});
      }
    });

    await waitFor(() => expect(i18next.isInitialized).toBe(true));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Courriel' })).not.toBeNull());
    expect((screen.getByRole('textbox', { name: 'Courriel' }) as HTMLInputElement).value)
      .toBe('operator@example.test');
    expect(screen.getByTestId('three-argument-plural').textContent).toBe('3 articles');
    expect(screen.getByTestId('three-argument-singular').textContent).toBe('1 article');
    initSpy.mockRestore();
  });
});
