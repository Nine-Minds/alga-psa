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
const getCurrentUserMock = vi.fn();
const getConsolidatedTicketDataMock = vi.fn();
const getSurveyTicketSummaryMock = vi.fn();

let pathname = '/msp/tickets/ticket-123';

const translations = {
  de: {
    'features/tickets': {
      'info.unsavedChanges':
        'Du hast ungespeicherte Änderungen. Klicke auf "Änderungen speichern", um sie anzuwenden.',
      'info.saveChanges': 'Änderungen speichern',
      'info.discardChangesTitle': 'Änderungen verwerfen',
      'fields.description': 'Beschreibung',
      'itil.impact': 'Auswirkung',
      'properties.timeEntry': 'Zeiteintrag',
      'properties.contactInfo': 'Kontaktinformationen',
      'properties.additionalAgents': 'Zusätzliche Agents',
      'properties.removeTeamAssignment': 'Teamzuweisung entfernen',
      'materials.title': 'Materialien',
      'materials.addMaterial': 'Material hinzufügen',
      'materials.empty': 'Diesem Ticket wurden noch keine Materialien hinzugefügt.',
      'watchList.title': 'Beobachtungsliste',
      'watchList.tabs.contact': 'Kontakt',
      'watchList.empty': 'Es wurden noch keine Beobachter hinzugefügt.',
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
          const translation =
            namespace && hasNamespace
              ? translations[locale]?.[namespace as 'features/tickets']?.[
                  key as keyof (typeof translations)['de']['features/tickets']
                ]
              : undefined;

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
  AIChatContextBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/context/TierContext', () => ({
  TierProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
}));

vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({
  getConsolidatedTicketData: (...args: unknown[]) => getConsolidatedTicketDataMock(...args),
}));

vi.mock('@alga-psa/surveys/actions/survey-actions/surveyDashboardActions', () => ({
  getSurveyTicketSummary: (...args: unknown[]) => getSurveyTicketSummaryMock(...args),
}));

vi.mock('@alga-psa/assets/components/AssociatedAssets', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/msp-composition/tickets', async () => {
  const ReactModule = await import('react');
  const { useTranslation } = await import('@alga-psa/ui/lib/i18n/client');

  return {
    MspTicketDetailsContainerClient: () => {
      const { t } = useTranslation('features/tickets');

      return (
        <section data-testid="ticket-detail-frame">
          <div data-testid="ticket-info">
            <span>{t('info.unsavedChanges', 'You have unsaved changes. Click "Save Changes" to apply them.')}</span>
            <span>{t('info.saveChanges', 'Save Changes')}</span>
            <span>{t('info.discardChangesTitle', 'Discard Changes')}</span>
            <span>{t('fields.description', 'Description')}</span>
            <span>{t('itil.impact', 'Impact')}</span>
          </div>
          <div data-testid="ticket-properties">
            <span>{t('properties.timeEntry', 'Time Entry')}</span>
            <span>{t('properties.contactInfo', 'Contact Info')}</span>
            <span>{t('properties.additionalAgents', 'Additional Agents')}</span>
            <span>{t('properties.removeTeamAssignment', 'Remove team assignment')}</span>
          </div>
          <div data-testid="ticket-materials">
            <span>{t('materials.title', 'Materials')}</span>
            <span>{t('materials.addMaterial', 'Add Material')}</span>
            <span>{t('materials.empty', 'No materials added to this ticket.')}</span>
          </div>
          <div data-testid="ticket-watch-list">
            <span>{t('watchList.title', 'Watch List')}</span>
            <span>{t('watchList.tabs.contact', 'Contact')}</span>
            <span>{t('watchList.empty', 'No watchers added.')}</span>
          </div>
        </section>
      );
    },
  };
});

const { default: TicketDetailsPage } = await import('server/src/app/msp/tickets/[id]/page');
const { MspLayoutClient } = await import('server/src/app/msp/MspLayoutClient');

async function renderTicketDetail(locale: keyof typeof translations = 'de') {
  const page = await TicketDetailsPage({
    params: Promise.resolve({
      id: 'ticket-123',
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

describe('/msp/tickets/[id] i18n integration', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    pathname = '/msp/tickets/ticket-123';

    getCurrentUserMock.mockResolvedValue({ id: 'user-1' });
    getConsolidatedTicketDataMock.mockResolvedValue({
      ticket: {
        ticket_id: 'ticket-123',
        client_id: 'client-1',
      },
    });
    getSurveyTicketSummaryMock.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it('T103: /msp/tickets/[id] renders detail-side translated info, properties, materials, and watch-list chrome in de', async () => {
    await renderTicketDetail('de');

    expect(
      await screen.findByText(
        'Du hast ungespeicherte Änderungen. Klicke auf "Änderungen speichern", um sie anzuwenden.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Änderungen speichern')).toBeInTheDocument();
    expect(screen.getByText('Änderungen verwerfen')).toBeInTheDocument();
    expect(screen.getByText('Beschreibung')).toBeInTheDocument();
    expect(screen.getByText('Auswirkung')).toBeInTheDocument();
    expect(screen.getByText('Zeiteintrag')).toBeInTheDocument();
    expect(screen.getByText('Kontaktinformationen')).toBeInTheDocument();
    expect(screen.getByText('Zusätzliche Agents')).toBeInTheDocument();
    expect(screen.getByText('Teamzuweisung entfernen')).toBeInTheDocument();
    expect(screen.getByText('Materialien')).toBeInTheDocument();
    expect(screen.getByText('Material hinzufügen')).toBeInTheDocument();
    expect(screen.getByText('Diesem Ticket wurden noch keine Materialien hinzugefügt.')).toBeInTheDocument();
    expect(screen.getByText('Beobachtungsliste')).toBeInTheDocument();
    expect(screen.getByText('Kontakt')).toBeInTheDocument();
    expect(screen.getByText('Es wurden noch keine Beobachter hinzugefügt.')).toBeInTheDocument();

    expect(screen.queryByText('Save Changes')).not.toBeInTheDocument();
    expect(screen.queryByText('Discard Changes')).not.toBeInTheDocument();
    expect(screen.queryByText('Description')).not.toBeInTheDocument();
    expect(screen.queryByText('Impact')).not.toBeInTheDocument();
    expect(screen.queryByText('Time Entry')).not.toBeInTheDocument();
    expect(screen.queryByText('Contact Info')).not.toBeInTheDocument();
    expect(screen.queryByText('Additional Agents')).not.toBeInTheDocument();
    expect(screen.queryByText('Remove team assignment')).not.toBeInTheDocument();
    expect(screen.queryByText('Materials')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Material')).not.toBeInTheDocument();
    expect(screen.queryByText('No materials added to this ticket.')).not.toBeInTheDocument();
    expect(screen.queryByText('Watch List')).not.toBeInTheDocument();
    expect(screen.queryByText('No watchers added.')).not.toBeInTheDocument();
  });
});
