/** @vitest-environment jsdom */

import React, { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

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

describe('I18nProvider initialization lifecycle', () => {
  beforeEach(() => {
    initMock.mockReset();
    hasResourceBundle.mockReturnValue(true);
  });

  afterEach(cleanup);

  it('shares StrictMode initialization and releases children after init rejects', async () => {
    initMock.mockRejectedValueOnce(new Error('backend initialization failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const firstMount = render(
      <StrictMode>
        <I18nProvider initialLocale="en">
          <div>Sign-in form</div>
        </I18nProvider>
      </StrictMode>
    );

    await waitFor(() => expect(screen.getByText('Sign-in form')).toBeTruthy());

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({ react: { useSuspense: false } }));
    expect(screen.queryByText('Loading translations...')).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to initialize translations:',
      expect.objectContaining({ message: 'backend initialization failed' })
    );

    firstMount.unmount();
    initMock.mockResolvedValue(undefined);
    render(
      <I18nProvider initialLocale="en">
        <div>Retry form</div>
      </I18nProvider>
    );
    await waitFor(() => expect(screen.getByText('Retry form')).toBeTruthy());
    expect(initMock).toHaveBeenCalledTimes(2);

    errorSpy.mockRestore();
  });
});
