/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

type TranslationOptions = {
  defaultValue?: string;
  [key: string]: unknown;
};

const replaceMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getCurrentUserPermissionsMock = vi.fn();
const getConsolidatedTicketListDataMock = vi.fn();
const getTicketingDisplaySettingsMock = vi.fn();
const getTeamsMock = vi.fn();

let pathname = '/msp/tickets';

const translations = {
  en: {
    'features/tickets': {
      'dashboard.title': '__EN Dashboard Frame__',
      'dashboard.addTicket': '__EN Add CTA__',
      'dashboard.filters.allAssignees': '__EN All Assignees__',
      'dashboard.filters.selectStatus': '__EN Select Status__',
      'dashboard.filters.responseState': '__EN Response State__',
      'filters.allPriorities': '__EN All Priorities__',
      'dashboard.filters.dueDate': '__EN Due Date__',
      'filters.category': '__EN Category Filter__',
      'resetFilters': '__EN Reset__',
    },
  },
  de: {
    'features/tickets': {
      'dashboard.title': 'Ticket-Dashboard',
      'dashboard.addTicket': 'Ticket hinzufügen',
      'dashboard.filters.allAssignees': 'Alle Zuständigen',
      'dashboard.filters.selectStatus': 'Status auswählen',
      'dashboard.filters.responseState': 'Antwortstatus',
      'filters.allPriorities': 'Alle Prioritäten',
      'dashboard.filters.dueDate': 'Fälligkeitsdatum',
      'filters.category': 'Nach Kategorie filtern',
      'resetFilters': 'Zurücksetzen',
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
    locale: 'en',
    namespaces: [],
  });

  const resolveTranslation = (
    locale: keyof typeof translations,
    namespace: string,
    key: string
  ): string | undefined => {
    return translations[locale]?.[namespace as 'features/tickets']?.[
      key as keyof (typeof translations)['en']['features/tickets']
    ];
  };

  return {
    I18nProvider: ({
      children,
      initialLocale = 'en',
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
            namespace && hasNamespace ? resolveTranslation(locale, namespace, key) : undefined;

          return interpolate(translation ?? defaultValue ?? key, options);
        },
        i18n: {
          language: locale,
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

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  getCurrentUserPermissions: (...args: unknown[]) => getCurrentUserPermissionsMock(...args),
}));

vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({
  getConsolidatedTicketListData: (...args: unknown[]) => getConsolidatedTicketListDataMock(...args),
}));

vi.mock('@alga-psa/tickets/actions/ticketDisplaySettings', () => ({
  getTicketingDisplaySettings: (...args: unknown[]) => getTicketingDisplaySettingsMock(...args),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: (...args: unknown[]) => getTeamsMock(...args),
}));

vi.mock('@alga-psa/msp-composition/tickets', async () => {
  const ReactModule = await import('react');
  const { useTranslation } = await import('@alga-psa/ui/lib/i18n/client');

  return {
    MspTicketsPageClient: () => {
      const { t } = useTranslation('features/tickets');

      return (
        <section data-testid="ticket-dashboard-frame">
          <h1>{t('dashboard.title', 'Ticketing Dashboard')}</h1>
          <button type="button">{t('dashboard.addTicket', 'Add Ticket')}</button>
          <span>{t('dashboard.filters.allAssignees', 'All Assignees')}</span>
          <span>{t('dashboard.filters.selectStatus', 'Select Status')}</span>
          <span>{t('dashboard.filters.responseState', 'Response State')}</span>
          <span>{t('filters.allPriorities', 'All Priorities')}</span>
          <span>{t('dashboard.filters.dueDate', 'Due Date')}</span>
          <span>{t('filters.category', 'Filter by category')}</span>
          <button type="button">{t('resetFilters', 'Reset')}</button>
        </section>
      );
    },
  };
});

const { default: TicketsPage } = await import('server/src/app/msp/tickets/page');
const { MspLayoutClient } = await import('server/src/app/msp/MspLayoutClient');

async function renderTicketsList(locale: keyof typeof translations = 'en') {
  const page = await TicketsPage({ searchParams: Promise.resolve({}) });

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

describe('/msp/tickets i18n integration', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    pathname = '/msp/tickets';

    getCurrentUserMock.mockResolvedValue({ id: 'user-1' });
    getCurrentUserPermissionsMock.mockResolvedValue(['ticket:update']);
    getConsolidatedTicketListDataMock.mockResolvedValue({
      options: {},
      tickets: [],
      totalCount: 0,
    });
    getTicketingDisplaySettingsMock.mockResolvedValue({});
    getTeamsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('T100: /msp/tickets loads the dashboard frame in en through features/tickets instead of fallback English literals', async () => {
    await renderTicketsList('en');

    expect(await screen.findByText('__EN Dashboard Frame__')).toBeInTheDocument();
    expect(screen.getByText('__EN Add CTA__')).toBeInTheDocument();
    expect(screen.getByText('__EN All Assignees__')).toBeInTheDocument();
    expect(screen.getByText('__EN Select Status__')).toBeInTheDocument();
    expect(screen.getByText('__EN Response State__')).toBeInTheDocument();
    expect(screen.getByText('__EN All Priorities__')).toBeInTheDocument();
    expect(screen.getByText('__EN Due Date__')).toBeInTheDocument();
    expect(screen.getByText('__EN Category Filter__')).toBeInTheDocument();
    expect(screen.getByText('__EN Reset__')).toBeInTheDocument();

    expect(screen.queryByText('Ticketing Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Ticket')).not.toBeInTheDocument();
    expect(screen.queryByText('All Assignees')).not.toBeInTheDocument();
    expect(screen.queryByText('Select Status')).not.toBeInTheDocument();
    expect(screen.queryByText('Response State')).not.toBeInTheDocument();
    expect(screen.queryByText('All Priorities')).not.toBeInTheDocument();
    expect(screen.queryByText('Due Date')).not.toBeInTheDocument();
    expect(screen.queryByText('Filter by category')).not.toBeInTheDocument();
    expect(screen.queryByText('Reset')).not.toBeInTheDocument();
  });

  it('T101: /msp/tickets loads the dashboard frame in de with translated title, add button, and filters', async () => {
    await renderTicketsList('de');

    expect(await screen.findByText('Ticket-Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Ticket hinzufügen')).toBeInTheDocument();
    expect(screen.getByText('Alle Zuständigen')).toBeInTheDocument();
    expect(screen.getByText('Status auswählen')).toBeInTheDocument();
    expect(screen.getByText('Antwortstatus')).toBeInTheDocument();
    expect(screen.getByText('Alle Prioritäten')).toBeInTheDocument();
    expect(screen.getByText('Fälligkeitsdatum')).toBeInTheDocument();
    expect(screen.getByText('Nach Kategorie filtern')).toBeInTheDocument();
    expect(screen.getByText('Zurücksetzen')).toBeInTheDocument();

    expect(screen.queryByText('Ticketing Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Ticket')).not.toBeInTheDocument();
    expect(screen.queryByText('All Assignees')).not.toBeInTheDocument();
    expect(screen.queryByText('Select Status')).not.toBeInTheDocument();
    expect(screen.queryByText('Response State')).not.toBeInTheDocument();
    expect(screen.queryByText('All Priorities')).not.toBeInTheDocument();
    expect(screen.queryByText('Due Date')).not.toBeInTheDocument();
    expect(screen.queryByText('Filter by category')).not.toBeInTheDocument();
    expect(screen.queryByText('Reset')).not.toBeInTheDocument();
  });
});
