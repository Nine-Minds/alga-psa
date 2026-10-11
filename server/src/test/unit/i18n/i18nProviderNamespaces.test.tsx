/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pendingReads = vi.hoisted(() => [] as Array<{
  language: string;
  namespace: string;
  callback: (error: Error | null, data: Record<string, unknown>) => void;
}>);

// Control only transport; namespace caching and translation use the real engine.
vi.mock('i18next-http-backend', () => ({
  default: {
    type: 'backend',
    init: () => {},
    read: (
      language: string,
      namespace: string,
      callback: (error: Error | null, data: Record<string, unknown>) => void,
    ) => {
      if (namespace === 'common') callback(null, {});
      else pendingReads.push({ language, namespace, callback });
    },
  },
}));
vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('i18next')>();
  return { ...actual, default: actual.createInstance() };
});
vi.unmock('react-i18next');
vi.unmock('@alga-psa/ui/lib/i18n/client');

const { I18nProvider, useTranslation } = await import('@alga-psa/ui/lib/i18n/client');

describe('I18nProvider route namespaces (T016-T019)', () => {
  afterEach(cleanup);

  it('awaits missing namespaces before the first translated render and reuses cached bundles', async () => {
    const renderedTitles: string[] = [];
    function Child() {
      const { t } = useTranslation('msp/core', { useSuspense: false });
      const title = t('page.title', { defaultValue: 'Dashboard' });
      renderedTitles.push(title);
      return <h1>{title}</h1>;
    }
    const provider = (
      <I18nProvider
        initialLocale="fr"
        namespaces={['common', 'msp/core']}
        preloadedResources={{ common: { greeting: 'Bonjour' } }}
      >
        <Child />
      </I18nProvider>
    );
    const firstMount = render(provider);

    await waitFor(() => expect(pendingReads.map(({ language, namespace }) =>
      `${language}:${namespace}`)).toContain('fr:msp/core'));
    expect(i18next.isInitialized).toBe(true);
    expect(pendingReads.every(({ namespace }) => namespace === 'msp/core')).toBe(true);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(renderedTitles).toEqual([]);

    await act(async () => {
      for (const request of pendingReads.splice(0)) {
        request.callback(null, {
          page: { title: request.language === 'fr' ? 'Tableau de bord' : 'Dashboard' },
        });
      }
    });
    await screen.findByRole('heading', { name: 'Tableau de bord' });
    expect(renderedTitles.length).toBeGreaterThan(0);
    expect(renderedTitles.every((title) => title === 'Tableau de bord')).toBe(true);
    expect(i18next.t('greeting', { ns: 'common' })).toBe('Bonjour');

    firstMount.unmount();
    render(provider);
    await screen.findByRole('heading', { name: 'Tableau de bord' });
    expect(pendingReads).toEqual([]);
  });
});
