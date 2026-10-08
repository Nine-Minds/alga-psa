/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.unmock('@alga-psa/ui/lib/i18n/client');

const initMock = vi.hoisted(() => vi.fn());
const hasResourceBundle = vi.hoisted(() => vi.fn(() => true));

vi.mock('i18next', () => {
  const instance = {
    use: () => instance,
    init: (...args: unknown[]) => initMock(...args),
    changeLanguage: vi.fn(async () => {}),
    hasResourceBundle,
    addResourceBundle: vi.fn(),
    loadNamespaces: vi.fn(async () => {}),
    language: 'en',
    t: (key: string) => key,
  };
  return { default: instance, ...instance };
});

vi.mock('i18next-http-backend', () => ({ default: {} }));
vi.mock('react-i18next', () => ({
  initReactI18next: {},
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { I18nProvider } = await import('./client');

describe('I18nProvider pending initialization', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('falls back without overlapping init and retries after a timed-out attempt rejects', async () => {
    vi.useFakeTimers();
    let rejectInitialization!: (error: Error) => void;
    const pendingInitialization = new Promise<void>((_resolve, reject) => {
      rejectInitialization = reject;
    });
    initMock.mockReturnValue(pendingInitialization);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <I18nProvider initialLocale="en">
        <div>Sign-in inputs</div>
      </I18nProvider>,
    );

    expect(screen.getByText('Loading translations...')).toBeTruthy();
    expect(screen.queryByText('Sign-in inputs')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.getByText('Sign-in inputs')).toBeTruthy();
    expect(screen.queryByText('Loading translations...')).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to initialize translations:',
      expect.objectContaining({ message: 'Translation initialization exceeded 10000ms' }),
    );

    // A remount after the deadline must use the degraded instance rather than
    // calling init() a second time while the original singleton attempt owns it.
    const secondMount = render(
      <I18nProvider initialLocale="en">
        <div>Second sign-in form</div>
      </I18nProvider>,
    );
    await act(async () => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(screen.getByText('Second sign-in form')).toBeTruthy();
    expect(initMock).toHaveBeenCalledTimes(1);

    // Do not retry against the singleton while the first init remains pending.
    // Once it rejects, a later mount may safely retry.
    await act(async () => {
      rejectInitialization(new Error('backend initialization failed late'));
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    initMock.mockResolvedValueOnce(undefined);
    render(
      <I18nProvider initialLocale="en">
        <div>Retried sign-in form</div>
      </I18nProvider>,
    );
    await act(async () => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(screen.getByText('Retried sign-in form')).toBeTruthy();
    expect(initMock).toHaveBeenCalledTimes(2);

    secondMount.unmount();
  });
});
