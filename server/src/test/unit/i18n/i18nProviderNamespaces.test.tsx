/** @vitest-environment jsdom */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNamespacesForRoute } from '@alga-psa/core/i18n/config';

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

describe('I18nProvider route namespaces (T016-T019)', () => {
  beforeEach(() => {
    vi.resetModules();
    pendingReads.length = 0;
  });
  afterEach(cleanup);

  it('awaits missing namespaces before the first translated render and reuses cached bundles', async () => {
    const { I18nProvider, useTranslation } = await import('@alga-psa/ui/lib/i18n/client');
    const { default: i18next } = await import('i18next');
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

  it('awaits service-principal attribution translations before rendering a nested ticket route', async () => {
    const { I18nProvider } = await import('@alga-psa/ui/lib/i18n/client');
    const { ServiceAuthorBadge } = await import('../../../../../ee/server/src/components/service-principals/ServiceAuthorBadge');
    const { ViaPrincipalLabel } = await import('../../../../../ee/server/src/components/service-principals/ViaPrincipalLabel');
    const namespaces = getNamespacesForRoute('/msp/tickets/ticket-1');
    const renderedAttribution: string[] = [];

    render(
      <I18nProvider
        initialLocale="es"
        namespaces={namespaces}
        preloadedResources={Object.fromEntries(
          namespaces.filter((namespace) => namespace !== 'msp/settings').map((namespace) => [namespace, {}]),
        )}
      >
        <React.Profiler id="attribution" onRender={() => {
          const badge = screen.queryByTestId('service-author-badge');
          if (badge) renderedAttribution.push(badge.textContent ?? '');
        }}>
          <ServiceAuthorBadge />
          <ViaPrincipalLabel principalName="Ticket Bot" />
        </React.Profiler>
      </I18nProvider>,
    );

    await waitFor(() => expect(pendingReads.some(({ language, namespace }) =>
      language === 'es' && namespace === 'msp/settings')).toBe(true));
    // Finish other bundles while the attribution bundle remains in flight.
    await act(async () => {
      const requests = pendingReads.splice(0);
      for (const request of requests) {
        if (request.namespace === 'msp/settings') pendingReads.push(request);
        else request.callback(null, {});
      }
    });
    expect(screen.queryByTestId('service-author-badge')).toBeNull();
    expect(renderedAttribution).toEqual([]);

    await act(async () => {
      for (const request of pendingReads.splice(0)) {
        const resources = JSON.parse(fs.readFileSync(path.resolve(
          __dirname, `../../../../public/locales/${request.language}/${request.namespace}.json`,
        ), 'utf8'));
        request.callback(null, resources);
      }
    });
    await screen.findByText('Servicio');
    expect(screen.getByText('vía Ticket Bot')).toBeTruthy();
    expect(renderedAttribution.length).toBeGreaterThan(0);
    expect(renderedAttribution.every((label) => label === 'Servicio')).toBe(true);
  });
});
