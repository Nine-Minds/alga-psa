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
  });

  it('keeps credentials usable through stalled init and route namespaces, then applies late translations', async () => {
    vi.useFakeTimers();
    signInMock.mockResolvedValue({ error: 'CredentialsSignin' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en', portal: 'msp', namespaces: ['common', 'msp/auth'] },
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

    await act(async () => {
      resolveRead('common');
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    expect(backendReads.some((read) => read.namespace === 'msp/auth')).toBe(true);
    expect(screen.getByLabelText('Email')).toBeTruthy();

    await act(async () => {
      resolveRead('msp/auth', {
        signIn: {
          form: {
            emailLabel: 'Work email',
            passwordLabel: 'Secret phrase',
            submit: 'Continue',
          },
        },
      });
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });

    expect(screen.getByLabelText('Work email')).toBeTruthy();
    expect(screen.getByLabelText('Secret phrase')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to initialize translations:',
      expect.objectContaining({ message: 'Translation initialization exceeded 10000ms' }),
    );
  });
});
