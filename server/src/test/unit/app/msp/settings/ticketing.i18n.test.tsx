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
  [key: string]: unknown;
};

const replaceMock = vi.fn();

let pathname = '/msp/settings';

const translations = {
  de: {
    'msp/settings': {
      'ticketing.title': 'Ticket-Einstellungen',
    },
    'features/tickets': {
      'settings.categories.title': 'Kategorien',
      'settings.categories.allBoards': 'Alle Boards',
      'settings.categories.name': 'Name',
      'fields.board': 'Board',
      'settings.categories.orderColumn': 'Reihenfolge',
      'settings.display.columns.actions': 'Aktionen',
      'settings.display.responseStateTrackingTitle': 'Antwortstatus-Tracking',
      'settings.display.preferencesTitle': 'Darstellungseinstellungen für Tickets',
      'settings.display.dateTimeFormat': 'Datum-/Zeitformat',
      'settings.display.columnsTitle': 'Spalten der Ticketliste',
      'settings.display.showTags': 'Tags anzeigen',
      'settings.display.tagsUnderTitle': 'Unter dem Titel anzeigen',
      'settings.display.tagsSeparateColumn': 'In separater Spalte anzeigen',
      'actions.save': 'Speichern',
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
  useSearchParams: () => ({
    get: () => null,
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
          const translation =
            namespace && hasNamespace
              ? translations[locale]?.[namespace as 'msp/settings' | 'features/tickets']?.[
                  key as keyof (typeof translations)['de']['msp/settings'] &
                    keyof (typeof translations)['de']['features/tickets']
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

vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  default: ({ tabs }: { tabs: Array<{ id: string; content: React.ReactNode }> }) => (
    <div data-testid="custom-tabs">
      {tabs
        .filter((tab) => tab.id === 'display' || tab.id === 'categories')
        .map((tab) => (
          <section key={tab.id} data-testid={`tab-${tab.id}`}>
            {tab.content}
          </section>
        ))}
    </div>
  ),
}));

vi.mock('@alga-psa/tickets/components', async () => {
  const ReactModule = await import('react');
  const { useTranslation } = await import('@alga-psa/ui/lib/i18n/client');

  return {
    CategoriesSettings: () => {
      const { t } = useTranslation('features/tickets');
      return (
        <div data-testid="categories-settings">
          <span>{t('settings.categories.title', 'Categories')}</span>
          <span>{t('settings.categories.allBoards', 'All Boards')}</span>
          <span>{t('settings.categories.name', 'Name')}</span>
          <span>{t('fields.board', 'Board')}</span>
          <span>{t('settings.categories.orderColumn', 'Order')}</span>
          <span>{t('settings.display.columns.actions', 'Actions')}</span>
        </div>
      );
    },
    DisplaySettings: () => {
      const { t } = useTranslation('features/tickets');
      return (
        <div data-testid="display-settings">
          <span>{t('settings.display.responseStateTrackingTitle', 'Response State Tracking')}</span>
          <span>{t('settings.display.preferencesTitle', 'Ticket Display Preferences')}</span>
          <span>{t('settings.display.dateTimeFormat', 'Date/Time Format')}</span>
          <span>{t('settings.display.columnsTitle', 'Ticket List Columns')}</span>
          <span>{t('settings.display.showTags', 'Show Tags')}</span>
          <span>{t('settings.display.tagsUnderTitle', 'Display under Title')}</span>
          <span>{t('settings.display.tagsSeparateColumn', 'Display in separate column')}</span>
          <span>{t('actions.save', 'Save')}</span>
        </div>
      );
    },
  };
});

vi.mock('@alga-psa/reference-data/components', () => ({
  NumberingSettings: () => null,
  PrioritySettings: () => null,
}));

vi.mock('server/src/components/settings/general/BoardsSettings', () => ({
  default: () => null,
}));

vi.mock('server/src/components/settings/general/StatusSettings', () => ({
  default: () => null,
}));

const { default: TicketingSettings } = await import('server/src/components/settings/general/TicketingSettings');
const { MspLayoutClient } = await import('server/src/app/msp/MspLayoutClient');

function renderTicketingSettings(locale: keyof typeof translations = 'de') {
  render(
    <MspLayoutClient
      session={null}
      needsOnboarding={false}
      initialSidebarCollapsed={false}
      initialLocale={locale}
      i18nEnabled={true}
    >
      <TicketingSettings />
    </MspLayoutClient>
  );
}

describe('/msp/settings ticketing i18n integration', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    pathname = '/msp/settings';
  });

  afterEach(() => {
    cleanup();
  });

  it('T104: /msp/settings ticketing renders categories and display settings in de through features/tickets', () => {
    renderTicketingSettings('de');

    expect(screen.getByText('Ticket-Einstellungen')).toBeInTheDocument();
    expect(screen.getByText('Kategorien')).toBeInTheDocument();
    expect(screen.getByText('Alle Boards')).toBeInTheDocument();
    expect(screen.getByText('Reihenfolge')).toBeInTheDocument();
    expect(screen.getByText('Aktionen')).toBeInTheDocument();
    expect(screen.getByText('Antwortstatus-Tracking')).toBeInTheDocument();
    expect(screen.getByText('Darstellungseinstellungen für Tickets')).toBeInTheDocument();
    expect(screen.getByText('Datum-/Zeitformat')).toBeInTheDocument();
    expect(screen.getByText('Spalten der Ticketliste')).toBeInTheDocument();
    expect(screen.getByText('Tags anzeigen')).toBeInTheDocument();
    expect(screen.getByText('Unter dem Titel anzeigen')).toBeInTheDocument();
    expect(screen.getByText('In separater Spalte anzeigen')).toBeInTheDocument();
    expect(screen.getByText('Speichern')).toBeInTheDocument();

    expect(screen.queryByText('Categories')).not.toBeInTheDocument();
    expect(screen.queryByText('All Boards')).not.toBeInTheDocument();
    expect(screen.queryByText('Order')).not.toBeInTheDocument();
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Response State Tracking')).not.toBeInTheDocument();
    expect(screen.queryByText('Ticket Display Preferences')).not.toBeInTheDocument();
    expect(screen.queryByText('Date/Time Format')).not.toBeInTheDocument();
    expect(screen.queryByText('Ticket List Columns')).not.toBeInTheDocument();
    expect(screen.queryByText('Show Tags')).not.toBeInTheDocument();
    expect(screen.queryByText('Display under Title')).not.toBeInTheDocument();
    expect(screen.queryByText('Display in separate column')).not.toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });
});
