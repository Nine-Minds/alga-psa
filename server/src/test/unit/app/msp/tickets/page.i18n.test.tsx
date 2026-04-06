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
      'quickAdd.dialogTitle': '__EN Quick Add Ticket__',
      'quickAdd.titlePlaceholder': '__EN Ticket Title *__',
      'quickAdd.descriptionLabel': '__EN Description__',
      'quickAdd.descriptionPlaceholder': '__EN Description Placeholder__',
      'quickAdd.clientPlaceholder': '__EN Select Client *__',
      'quickAdd.selectContact': '__EN Select contact__',
      'quickAdd.selectLocation': '__EN Select location__',
      'quickAdd.boardPlaceholder': '__EN Select Board *__',
      'quickAdd.assignedTo': '__EN Assigned To__',
      'quickAdd.additionalAgents': '__EN Additional Agents__',
      'quickAdd.selectCategory': '__EN Select category__',
      'quickAdd.statusPlaceholder': '__EN Select Status *__',
      'quickAdd.selectPriority': '__EN Select Priority *__',
      'quickAdd.dueDate': '__EN Due Date Label__',
      'quickAdd.selectDate': '__EN Select date__',
      'actions.cancel': '__EN Cancel__',
      'actions.create': '__EN Create__',
      'quickAdd.createAndView': '__EN Create + View Ticket__',
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
      'quickAdd.dialogTitle': 'Ticket schnell hinzufügen',
      'quickAdd.titlePlaceholder': 'Ticket-Titel *',
      'quickAdd.descriptionLabel': 'Beschreibung',
      'quickAdd.descriptionPlaceholder': 'Beschreibung',
      'quickAdd.clientPlaceholder': 'Kunden auswählen *',
      'quickAdd.selectContact': 'Kontakt auswählen',
      'quickAdd.selectLocation': 'Standort auswählen',
      'quickAdd.boardPlaceholder': 'Board auswählen *',
      'quickAdd.assignedTo': 'Zugewiesen an',
      'quickAdd.additionalAgents': 'Zusätzliche Agents',
      'quickAdd.selectCategory': 'Kategorie auswählen',
      'quickAdd.statusPlaceholder': 'Status auswählen *',
      'quickAdd.selectPriority': 'Priorität auswählen *',
      'quickAdd.dueDate': 'Fälligkeitsdatum',
      'quickAdd.selectDate': 'Datum auswählen',
      'actions.cancel': 'Abbrechen',
      'actions.create': 'Erstellen',
      'quickAdd.createAndView': 'Erstellen + Ticket anzeigen',
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
          <div aria-label={t('quickAdd.dialogTitle', 'Quick Add Ticket')}>
            <h2>{t('quickAdd.dialogTitle', 'Quick Add Ticket')}</h2>
            <span>{t('quickAdd.titlePlaceholder', 'Ticket Title *')}</span>
            <span>{t('quickAdd.descriptionLabel', 'Description')}</span>
            <span>{t('quickAdd.descriptionPlaceholder', 'Description')}</span>
            <span>{t('quickAdd.clientPlaceholder', 'Select Client *')}</span>
            <span>{t('quickAdd.selectContact', 'Select contact')}</span>
            <span>{t('quickAdd.selectLocation', 'Select location')}</span>
            <span>{t('quickAdd.boardPlaceholder', 'Select Board *')}</span>
            <span>{t('quickAdd.assignedTo', 'Assigned To')}</span>
            <span>{t('quickAdd.additionalAgents', 'Additional Agents')}</span>
            <span>{t('quickAdd.selectCategory', 'Select category')}</span>
            <span>{t('quickAdd.statusPlaceholder', 'Select Status *')}</span>
            <span>{t('quickAdd.selectPriority', 'Select Priority *')}</span>
            <span>{t('quickAdd.dueDate', 'Due Date')}</span>
            <span>{t('quickAdd.selectDate', 'Select date')}</span>
            <button type="button">{t('actions.cancel', 'Cancel')}</button>
            <button type="button">{t('actions.create', 'Create')}</button>
            <button type="button">{t('quickAdd.createAndView', 'Create + View Ticket')}</button>
          </div>
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
    expect(screen.getAllByText('Fälligkeitsdatum').length).toBeGreaterThanOrEqual(2);
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

  it('T102: /msp/tickets renders the quick-add dialog shell in de with translated labels and actions', async () => {
    await renderTicketsList('de');

    expect(await screen.findByText('Ticket schnell hinzufügen')).toBeInTheDocument();
    expect(screen.getByText('Ticket-Titel *')).toBeInTheDocument();
    expect(screen.getAllByText('Beschreibung').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Kunden auswählen *')).toBeInTheDocument();
    expect(screen.getByText('Kontakt auswählen')).toBeInTheDocument();
    expect(screen.getByText('Standort auswählen')).toBeInTheDocument();
    expect(screen.getByText('Board auswählen *')).toBeInTheDocument();
    expect(screen.getByText('Zugewiesen an')).toBeInTheDocument();
    expect(screen.getByText('Zusätzliche Agents')).toBeInTheDocument();
    expect(screen.getByText('Kategorie auswählen')).toBeInTheDocument();
    expect(screen.getByText('Status auswählen *')).toBeInTheDocument();
    expect(screen.getByText('Priorität auswählen *')).toBeInTheDocument();
    expect(screen.getAllByText('Fälligkeitsdatum').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Datum auswählen')).toBeInTheDocument();
    expect(screen.getByText('Abbrechen')).toBeInTheDocument();
    expect(screen.getByText('Erstellen')).toBeInTheDocument();
    expect(screen.getByText('Erstellen + Ticket anzeigen')).toBeInTheDocument();

    expect(screen.queryByText('Quick Add Ticket')).not.toBeInTheDocument();
    expect(screen.queryByText('Ticket Title *')).not.toBeInTheDocument();
    expect(screen.queryByText('Select Client *')).not.toBeInTheDocument();
    expect(screen.queryByText('Select contact')).not.toBeInTheDocument();
    expect(screen.queryByText('Select location')).not.toBeInTheDocument();
    expect(screen.queryByText('Select Board *')).not.toBeInTheDocument();
    expect(screen.queryByText('Assigned To')).not.toBeInTheDocument();
    expect(screen.queryByText('Additional Agents')).not.toBeInTheDocument();
    expect(screen.queryByText('Select category')).not.toBeInTheDocument();
    expect(screen.queryByText('Select Status *')).not.toBeInTheDocument();
    expect(screen.queryByText('Select Priority *')).not.toBeInTheDocument();
    expect(screen.queryByText('Select date')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(screen.queryByText('Create')).not.toBeInTheDocument();
    expect(screen.queryByText('Create + View Ticket')).not.toBeInTheDocument();
  });
});
