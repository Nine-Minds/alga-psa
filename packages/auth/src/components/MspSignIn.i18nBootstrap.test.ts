/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

(globalThis as unknown as { React?: typeof React }).React = React;

type BackendRead = {
  language: string;
  namespace: string;
  callback: (error: Error | null, resources?: Record<string, unknown>) => void;
};

const backendReads = vi.hoisted(() => [] as BackendRead[]);
const backendReadHistory = vi.hoisted(() => [] as Array<{ language: string; namespace: string }>);
const signInMock = vi.hoisted(() => vi.fn());

vi.mock('i18next-http-backend', () => {
  class DeferredTranslationBackend {
    static type = 'backend';

    init() {}

    read(
      language: string,
      namespace: string,
      callback: BackendRead['callback'],
    ) {
      backendReads.push({ language, namespace, callback });
      backendReadHistory.push({ language, namespace });
    }
  }

  return { default: DeferredTranslationBackend };
});

vi.mock('next-auth/react', () => ({ signIn: (...args: unknown[]) => signInMock(...args) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}));
vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement('img', props),
}));
vi.mock('@alga-psa/ui/components', () => {
  const box = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement('div', props, children);
  const label = ({ children, htmlFor, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) =>
    React.createElement('label', { htmlFor, ...props }, children);
  const input = (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    React.createElement('input', props);
  const button = (props: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement('button', props);
  const checkbox = ({ label: checkboxLabel, ...props }: {
    id?: string;
    checked?: boolean;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
    label?: React.ReactNode;
  }) => React.createElement(React.Fragment, null,
    React.createElement('input', { ...props, type: 'checkbox' }),
    checkboxLabel ? React.createElement('label', { htmlFor: props.id }, checkboxLabel) : null,
  );

  return {
    Alert: box,
    AlertDescription: box,
    Button: button,
    Card: box,
    CardContent: box,
    CardDescription: box,
    CardHeader: box,
    CardTitle: box,
    Checkbox: checkbox,
    Input: input,
    Label: label,
  };
});
vi.mock('@alga-psa/auth/sso/entry', () => ({ default: () => null }));
vi.mock('./TwoFA', () => ({ default: () => null }));
vi.mock('./Alert', () => ({ default: () => null }));
vi.mock('./useLoginCaptcha', () => ({
  useLoginCaptcha: () => ({
    config: null,
    required: false,
    token: '',
    setToken: vi.fn(),
    resetSignal: 0,
    requireCaptcha: vi.fn(),
    refreshChallenge: vi.fn(),
  }),
}));

const { I18nProvider } = await import('@alga-psa/ui/lib/i18n/client');
const { default: i18next } = await import('i18next');
const { default: MspSignIn } = await import('./MspSignIn');

async function flushEffects() {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}

function resolveRead(namespace: string, resources: Record<string, unknown> = {}) {
  const read = backendReads.find((candidate) => candidate.namespace === namespace);
  if (!read) throw new Error(`No pending translation read for namespace ${namespace}`);
  backendReads.splice(backendReads.indexOf(read), 1);
  read.callback(null, resources);
}

describe('MSP sign-in i18n bootstrap', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    backendReads.length = 0;
    backendReadHistory.length = 0;
  });

  it('reconciles the current locale and preloaded namespaces after a timed-out init settles', async () => {
    vi.useFakeTimers();
    signInMock.mockResolvedValue({ error: 'CredentialsSignin' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const initSpy = vi.spyOn(i18next, 'init');

    const oldProvider = render(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en', portal: 'msp', namespaces: ['common', 'msp/auth', 'msp/old-only'] },
        React.createElement(MspSignIn),
      ),
    );
    await flushEffects();

    expect(
      backendReads.some((read) => read.namespace === 'common'),
      JSON.stringify(errorSpy.mock.calls),
    ).toBe(true);
    expect(screen.getByText('Loading translations...')).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    const email = screen.getByLabelText('Email') as HTMLInputElement;
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    expect(email).toBeTruthy();
    expect(password).toBeTruthy();
    expect(screen.queryByText('Loading translations...')).toBeNull();

    fireEvent.change(email, { target: { value: 'operator@example.com' } });
    fireEvent.change(password, { target: { value: 'secret' } });
    await act(async () => {
      fireEvent.submit(email.closest('form')!);
    });
    expect(signInMock).toHaveBeenCalledWith(
      'credentials',
      expect.objectContaining({ email: 'operator@example.com', password: 'secret' }),
    );

    oldProvider.unmount();
    render(
      React.createElement(
        I18nProvider,
        {
          initialLocale: 'fr',
          portal: 'msp',
          namespaces: ['common', 'msp/auth', 'msp/core'],
          preloadedResources: {
            common: {},
            'msp/auth': {
              signIn: {
                form: {
                  emailLabel: 'Courriel',
                  passwordLabel: 'Mot de passe',
                  submit: 'Se connecter',
                },
              },
            },
          },
        },
        React.createElement(MspSignIn),
      ),
    );
    await flushEffects();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(initSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRead('common');
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    if (backendReads.some((read) => read.language === 'en' && read.namespace === 'msp/auth')) {
      await act(async () => {
        resolveRead('msp/auth');
        for (let index = 0; index < 12; index += 1) await Promise.resolve();
      });
    }
    expect(backendReads.some((read) => read.language === 'fr' && read.namespace === 'msp/core')).toBe(true);
    expect(backendReadHistory).not.toContainEqual({ language: 'en', namespace: 'msp/old-only' });
    expect(i18next.language).toBe('fr');

    // Route namespace work can still be pending; its preloaded current-locale
    // auth namespace is already available through the real translation hook.
    expect(screen.getByLabelText('Courriel')).toBeTruthy();
    expect(screen.getByLabelText('Mot de passe')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeTruthy();

    await act(async () => {
      resolveRead('msp/core', { core: { nav: { home: 'Accueil' } } });
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });

    expect(screen.getByLabelText('Courriel')).toBeTruthy();
    expect(i18next.language).toBe('fr');
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
