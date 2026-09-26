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

  it('releases the sign-in content when initialization never settles', async () => {
    vi.useFakeTimers();
    initMock.mockReturnValue(new Promise(() => {}));
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
  });
});
