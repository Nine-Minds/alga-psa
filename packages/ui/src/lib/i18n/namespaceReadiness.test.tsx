/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

/**
 * The tenant-discovery page logged, on every load:
 *
 *   key "auth.tenantDiscovery.title" won't get resolved as namespace
 *   "client-portal" was not yet loaded ... something IS WRONG in your setup
 *
 * The namespace was in the route's list; it just wasn't awaited. I18nProvider
 * unblocked its children as soon as i18next itself had initialized and loaded
 * the route's namespaces in a *later* effect, so the first render called t()
 * against a namespace still in flight. It resolved to the English defaultValue
 * and then re-rendered, which is why the visible text looked correct locally
 * and would flash English on a cold cache.
 *
 * This pins the ordering: nothing inside the provider renders until the
 * namespaces the route asked for are actually in memory.
 */

vi.unmock('@alga-psa/ui/lib/i18n/client');

const loadNamespaces = vi.hoisted(() => vi.fn());
const hasResourceBundle = vi.hoisted(() => vi.fn());
const renderOrder = vi.hoisted(() => [] as string[]);

vi.mock('i18next', () => {
  const instance = {
    use: () => instance,
    init: vi.fn(async () => {
      renderOrder.push('init');
    }),
    changeLanguage: vi.fn(async () => {}),
    hasResourceBundle,
    addResourceBundle: vi.fn(),
    loadNamespaces: vi.fn(async (ns: string[]) => {
      renderOrder.push(`load:${ns.join('+')}`);
      return loadNamespaces(ns);
    }),
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

function Child() {
  renderOrder.push('child-render');
  return <div data-testid="child">ready</div>;
}

describe('I18nProvider namespace readiness', () => {
  beforeEach(() => {
    renderOrder.length = 0;
    loadNamespaces.mockClear();
    hasResourceBundle.mockReturnValue(false);
  });

  afterEach(cleanup);

  it('loads the route namespaces before rendering children', async () => {
    render(
      <I18nProvider initialLocale="fr" namespaces={['common', 'client-portal']}>
        <Child />
      </I18nProvider>
    );

    await waitFor(() => expect(screen.queryByTestId('child')).not.toBeNull());

    expect(loadNamespaces).toHaveBeenCalledWith(['common', 'client-portal']);

    const firstChildRender = renderOrder.indexOf('child-render');
    const namespaceLoad = renderOrder.findIndex((entry) => entry.startsWith('load:'));
    expect(namespaceLoad).toBeGreaterThanOrEqual(0);
    expect(firstChildRender).toBeGreaterThan(namespaceLoad);
  });

  it('skips the fetch for namespaces already in memory', async () => {
    hasResourceBundle.mockReturnValue(true);

    render(
      <I18nProvider initialLocale="fr" namespaces={['common', 'client-portal']}>
        <Child />
      </I18nProvider>
    );

    await waitFor(() => expect(screen.queryByTestId('child')).not.toBeNull());
    expect(loadNamespaces).not.toHaveBeenCalled();
  });

  it('still renders children when a namespace fails to load', async () => {
    loadNamespaces.mockRejectedValueOnce(new Error('offline'));

    render(
      <I18nProvider initialLocale="fr" namespaces={['client-portal']}>
        <Child />
      </I18nProvider>
    );

    await waitFor(() => expect(screen.queryByTestId('child')).not.toBeNull());
  });
});
