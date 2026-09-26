/** @vitest-environment jsdom */

import React from 'react';
import { act, fireEvent } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MspLoginForm from '@alga-psa/auth/components/MspLoginForm';
import { I18nWrapper } from './I18nWrapper';
import { ThemeBridge } from '../../../../../server/src/components/providers/ThemeBridge';

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

vi.mock('next/navigation', () => ({
  usePathname: () => '/auth/msp/signin',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../../actions', () => ({ getHierarchicalLocaleAction: vi.fn() }));
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock('@alga-psa/ui/components', async () => {
  const ReactModule = await import('react');
  const Box = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    ReactModule.createElement('div', props, children);
  return {
    Card: Box,
    CardContent: Box,
    CardDescription: Box,
    CardHeader: Box,
    CardTitle: Box,
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => ReactModule.createElement('input', props),
    Label: (props: React.LabelHTMLAttributes<HTMLLabelElement>) => ReactModule.createElement('label', props),
    Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => ReactModule.createElement('button', props),
    Checkbox: ({ id, checked, label, onChange }: {
      id: string;
      checked: boolean;
      label: string;
      onChange: React.ChangeEventHandler<HTMLInputElement>;
    }) => ReactModule.createElement('label', {},
      ReactModule.createElement('input', { id, type: 'checkbox', checked, onChange }), label),
    Alert: Box,
    AlertDescription: ({ children }: React.PropsWithChildren) => ReactModule.createElement('p', {}, children),
  };
});
vi.mock('@alga-psa/ui/ui-reflection', () => ({
  useRegisterUIComponent: () => vi.fn(),
  withDataAutomationId: () => ({}),
}));
vi.mock('@alga-psa/auth/sso/entry', () => ({ default: () => null }));
vi.mock('@alga-psa/auth/components/CaptchaChallenge', () => ({ default: () => null }));
vi.mock('@alga-psa/auth/components/useLoginCaptcha', () => ({
  useLoginCaptcha: () => ({
    required: false,
    config: null,
    token: null,
    setToken: vi.fn(),
    requireCaptcha: vi.fn(),
    refreshChallenge: vi.fn(),
    resetSignal: 0,
  }),
}));
vi.mock('@mantine/core', () => ({
  MantineProvider: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock('@radix-ui/themes', () => ({
  Theme: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: undefined }) }));

const onError = vi.fn();
const onTwoFactorRequired = vi.fn();

function SignInTree() {
  return (
    <React.StrictMode>
      <ThemeBridge>
        <I18nWrapper initialLocale="en" portal="msp" renderChildrenWhileLoading>
          <MspLoginForm
            callbackUrl="/msp/dashboard"
            onError={onError}
            onTwoFactorRequired={onTwoFactorRequired}
          />
        </I18nWrapper>
      </ThemeBridge>
    </React.StrictMode>
  );
}

describe('MSP sign-in bootstrap during pending translations', () => {
  afterEach(() => {
    pendingReads.length = 0;
    document.body.innerHTML = '';
  });

  it('renders fallback controls in server markup and hydrates an interactive form while reads are pending', async () => {
    const initSpy = vi.spyOn(i18next, 'init');
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    expect(windowDescriptor?.configurable).toBe(true);
    Reflect.deleteProperty(globalThis, 'window');
    let markup: string;
    try {
      expect(typeof window).toBe('undefined');
      markup = renderToString(<SignInTree />);
      expect(i18next.isInitialized).not.toBe(true);
      expect(initSpy).not.toHaveBeenCalled();
    } finally {
      if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    }
    expect(markup).toContain('id="msp-email-field"');
    expect(markup).toContain('id="msp-password-field"');
    expect(markup).toContain('Email');
    expect(markup).toContain('Password');
    expect(markup).not.toContain('visibility:hidden');

    const container = document.createElement('div');
    container.innerHTML = markup;
    document.body.appendChild(container);

    let root: Root | undefined;
    const recoverableErrors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, <SignInTree />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
    });

    expect(pendingReads.length).toBeGreaterThan(0);
    expect(i18next.isInitialized).not.toBe(true);
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(recoverableErrors).toEqual([]);

    const email = container.querySelector<HTMLInputElement>('#msp-email-field');
    const password = container.querySelector<HTMLInputElement>('#msp-password-field');
    expect(email).not.toBeNull();
    expect(password).not.toBeNull();
    expect(email?.closest('[style*="visibility"]')).toBeNull();
    expect(container.querySelector('label[for="msp-email-field"]')?.textContent).toBe('Email');

    await act(async () => {
      fireEvent.change(email!, { target: { value: 'operator@example.test' } });
      fireEvent.change(password!, { target: { value: 'secret' } });
    });
    expect(email?.value).toBe('operator@example.test');
    expect(password?.value).toBe('secret');
    const reactPropsKey = Object.keys(email!).find((key) => key.startsWith('__reactProps'));
    expect(reactPropsKey && (email as any)[reactPropsKey].value).toBe('operator@example.test');

    await act(async () => root?.unmount());
    initSpy.mockRestore();
  });
});
