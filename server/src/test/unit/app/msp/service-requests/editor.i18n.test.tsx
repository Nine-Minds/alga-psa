/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

type TranslationOptions = {
  defaultValue?: string;
  count?: number;
  [key: string]: unknown;
};

const replaceMock = vi.fn();

let pathname = '/msp/service-requests/definition-123';

const translations = {
  de: {
    'features/tickets': {
      'categoryPicker.title': 'Kategorieauswahl',
      'categoryPicker.placeholder': 'Kategorien auswählen...',
      'categoryPicker.noCategory': 'Keine Kategorie',
      'categoryPicker.itilBadge': 'ITIL',
      'categoryPicker.addNew': 'Neue Kategorie hinzufügen',
      'categoryPicker.selectedCount_one': '{{count}} Kategorie',
      'categoryPicker.selectedCount_other': '{{count}} Kategorien',
      'categoryPicker.excludingNoCategory': 'ohne Keine Kategorie',
      'categoryPicker.excludingCount_one': 'ohne {{count}} Kategorie',
      'categoryPicker.excludingCount_other': 'ohne {{count}} Kategorien',
    },
  },
} as const;

const interpolate = (template: string, values: Record<string, unknown> = {}) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => String(values[key] ?? ''));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const ReactModule = await import('react');
  type ContextValue = {
    locale: keyof typeof translations;
    namespaces: string[];
  };

  const TestI18nContext = ReactModule.createContext<ContextValue>({
    locale: 'de',
    namespaces: [],
  });

  return {
    I18nProvider: ({
      children,
      initialLocale = 'de',
      namespaces = [],
    }: {
      children: React.ReactNode;
      initialLocale?: keyof typeof translations;
      namespaces?: string[];
    }) => (
      <TestI18nContext.Provider value={{ locale: initialLocale, namespaces }}>
        {children}
      </TestI18nContext.Provider>
    ),
    useTranslation: (namespace?: string) => {
      const { locale, namespaces } = ReactModule.useContext(TestI18nContext);

      return {
        t: (
          key: string,
          defaultValueOrOptions?: string | TranslationOptions,
          maybeOptions?: TranslationOptions
        ) => {
          const defaultValue =
            typeof defaultValueOrOptions === 'string'
              ? defaultValueOrOptions
              : defaultValueOrOptions?.defaultValue;
          const options =
            typeof defaultValueOrOptions === 'string'
              ? maybeOptions ?? {}
              : defaultValueOrOptions ?? {};
          const hasNamespace = namespace ? namespaces.includes(namespace) : true;
          const pluralSuffix =
            typeof options.count === 'number'
              ? options.count === 1
                ? '_one'
                : '_other'
              : '';
          const translationKey = `${key}${pluralSuffix}`;
          const translation =
            namespace && hasNamespace
              ? translations[locale]?.[namespace as 'features/tickets']?.[
                  translationKey as keyof (typeof translations)['de']['features/tickets']
                ] ??
                translations[locale]?.[namespace as 'features/tickets']?.[
                  key as keyof (typeof translations)['de']['features/tickets']
                ]
              : undefined;

          return interpolate(translation ?? defaultValue ?? key, options);
        },
      };
    },
  };
});

vi.mock('@alga-psa/auth/client', () => ({
  AppSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/layout/DefaultLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="default-layout">{children}</div>
  ),
}));

vi.mock('@alga-psa/tags/context', () => ({
  TagProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/analytics/PostHogUserIdentifier', () => ({
  PostHogUserIdentifier: () => null,
}));

vi.mock('@alga-psa/ui/ui-reflection/ClientUIStateProvider', () => ({
  ClientUIStateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@product/chat/context', () => ({
  AIChatContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/context/TierContext', () => ({
  TierProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/feature-flags/FeatureFlagPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage', async () => {
  const ReactModule = await import('react');
  const { useTranslation } = await import('@alga-psa/ui/lib/i18n/client');

  return {
    default: function ServiceRequestDefinitionEditorPageMock() {
      const { t } = useTranslation('features/tickets');

      return (
        <section data-testid="service-request-category-picker">
          <span>{t('categoryPicker.title', 'Category Picker')}</span>
          <span>{t('categoryPicker.placeholder', 'Select categories...')}</span>
          <span>{t('categoryPicker.noCategory', 'No Category')}</span>
          <span>{t('categoryPicker.itilBadge', 'ITIL')}</span>
          <span>{t('categoryPicker.addNew', 'Add new category')}</span>
          <span>{t('categoryPicker.selectedCount', { count: 2, defaultValue: '{{count}} categories' })}</span>
          <span>{t('categoryPicker.excludingNoCategory', 'excluding No Category')}</span>
          <span>{t('categoryPicker.excludingCount', { count: 1, defaultValue: 'excluding {{count}} category' })}</span>
        </section>
      );
    },
  };
});
vi.mock('server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx', async () => {
  const ReactModule = await import('react');
  const { useTranslation } = await import('@alga-psa/ui/lib/i18n/client');

  return {
    default: function ServiceRequestDefinitionEditorPageMock() {
      const { t } = useTranslation('features/tickets');

      return (
        <section data-testid="service-request-category-picker">
          <span>{t('categoryPicker.title', 'Category Picker')}</span>
          <span>{t('categoryPicker.placeholder', 'Select categories...')}</span>
          <span>{t('categoryPicker.noCategory', 'No Category')}</span>
          <span>{t('categoryPicker.itilBadge', 'ITIL')}</span>
          <span>{t('categoryPicker.addNew', 'Add new category')}</span>
          <span>{t('categoryPicker.selectedCount', { count: 2, defaultValue: '{{count}} categories' })}</span>
          <span>{t('categoryPicker.excludingNoCategory', 'excluding No Category')}</span>
          <span>{t('categoryPicker.excludingCount', { count: 1, defaultValue: 'excluding {{count}} category' })}</span>
        </section>
      );
    },
  };
});

const { default: ServiceRequestDefinitionPage } = await import(
  'server/src/app/msp/service-requests/[definitionId]/page'
);
const { MspLayoutClient } = await import('server/src/app/msp/MspLayoutClient');

async function renderServiceRequestEditor(locale: keyof typeof translations = 'de') {
  const page = await ServiceRequestDefinitionPage({
    params: Promise.resolve({
      definitionId: 'definition-123',
    }),
  });

  render(
    <MspLayoutClient
      session={null}
      needsOnboarding={false}
      initialSidebarCollapsed={false}
      initialLocale={locale}
      i18nEnabled={true}
    >
      {page}
    </MspLayoutClient>
  );
}

describe('/msp/service-requests editor i18n integration', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    pathname = '/msp/service-requests/definition-123';
  });

  afterEach(() => {
    cleanup();
  });

  it('T105: /msp/service-requests/[id] renders the reused category picker in de', async () => {
    await renderServiceRequestEditor('de');

    expect(await screen.findByText('Kategorieauswahl')).toBeInTheDocument();
    expect(screen.getByText('Kategorien auswählen...')).toBeInTheDocument();
    expect(screen.getByText('Keine Kategorie')).toBeInTheDocument();
    expect(screen.getByText('ITIL')).toBeInTheDocument();
    expect(screen.getByText('Neue Kategorie hinzufügen')).toBeInTheDocument();
    expect(screen.getByText('2 Kategorien')).toBeInTheDocument();
    expect(screen.getByText('ohne Keine Kategorie')).toBeInTheDocument();
    expect(screen.getByText('ohne 1 Kategorie')).toBeInTheDocument();

    expect(screen.queryByText('Category Picker')).not.toBeInTheDocument();
    expect(screen.queryByText('Select categories...')).not.toBeInTheDocument();
    expect(screen.queryByText('No Category')).not.toBeInTheDocument();
    expect(screen.queryByText('Add new category')).not.toBeInTheDocument();
    expect(screen.queryByText('excluding No Category')).not.toBeInTheDocument();
    expect(screen.queryByText('excluding 1 category')).not.toBeInTheDocument();
  });
});
