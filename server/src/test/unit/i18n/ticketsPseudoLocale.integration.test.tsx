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

let pathname = '/msp/tickets';

const translations = {
  xx: {
    'features/tickets': {
      'dashboard.title': '11111',
      'quickAdd.dialogTitle': '11111',
      'bulk.move.dialogTitle': '11111',
      'info.unsavedChanges': '11111',
      'properties.timeEntry': '11111',
      'materials.title': '11111',
      'watchList.title': '11111',
      'settings.categories.title': '11111',
      'settings.display.preferencesTitle': '11111',
    },
  },
} as const;

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
    locale: 'xx',
    namespaces: [],
  });

  return {
    I18nProvider: ({
      children,
      initialLocale = 'xx',
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
                  key as keyof (typeof translations)['xx']['features/tickets']
                ]
              : undefined;

          const template = translation ?? defaultValue ?? key;
          return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, token) =>
            String(options[token] ?? '')
          );
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

const { useTranslation } = await import('@alga-psa/ui/lib/i18n/client');
const { MspLayoutClient } = await import('server/src/app/msp/MspLayoutClient');

function TicketsListPseudoFrame() {
  const { t } = useTranslation('features/tickets');
  return (
    <section data-testid="tickets-list-pseudo">
      <span>{t('dashboard.title', 'Ticketing Dashboard')}</span>
      <span>{t('quickAdd.dialogTitle', 'Quick Add Ticket')}</span>
      <span>{t('bulk.move.dialogTitle', 'Move Selected Tickets')}</span>
    </section>
  );
}

function TicketDetailPseudoFrame() {
  const { t } = useTranslation('features/tickets');
  return (
    <section data-testid="tickets-detail-pseudo">
      <span>{t('info.unsavedChanges', 'You have unsaved changes. Click "Save Changes" to apply them.')}</span>
      <span>{t('properties.timeEntry', 'Time Entry')}</span>
      <span>{t('materials.title', 'Materials')}</span>
      <span>{t('watchList.title', 'Watch List')}</span>
    </section>
  );
}

function TicketSettingsPseudoFrame() {
  const { t } = useTranslation('features/tickets');
  return (
    <section data-testid="tickets-settings-pseudo">
      <span>{t('settings.categories.title', 'Categories')}</span>
      <span>{t('settings.display.preferencesTitle', 'Ticket Display Preferences')}</span>
    </section>
  );
}

function renderWithRoute(path: string, child: React.ReactNode) {
  pathname = path;
  render(
    <MspLayoutClient
      session={null}
      needsOnboarding={false}
      initialSidebarCollapsed={false}
      initialLocale="xx"
      i18nEnabled={true}
    >
      {child}
    </MspLayoutClient>
  );
}

describe('ticket pseudo-locale smoke integration', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('T108: xx pseudo-locale renders pseudo-ticket copy across list, detail, and settings routes', () => {
    renderWithRoute('/msp/tickets', <TicketsListPseudoFrame />);

    expect(screen.getAllByText('11111').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('Ticketing Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Quick Add Ticket')).not.toBeInTheDocument();
    expect(screen.queryByText('Move Selected Tickets')).not.toBeInTheDocument();

    cleanup();
    renderWithRoute('/msp/tickets/ticket-123', <TicketDetailPseudoFrame />);

    expect(screen.getAllByText('11111').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText('Time Entry')).not.toBeInTheDocument();
    expect(screen.queryByText('Materials')).not.toBeInTheDocument();
    expect(screen.queryByText('Watch List')).not.toBeInTheDocument();

    cleanup();
    renderWithRoute('/msp/settings', <TicketSettingsPseudoFrame />);

    expect(screen.getAllByText('11111').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Categories')).not.toBeInTheDocument();
    expect(screen.queryByText('Ticket Display Preferences')).not.toBeInTheDocument();
  });
});
