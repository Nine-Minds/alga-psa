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

const refreshMock = vi.fn();
const replaceMock = vi.fn();
const pushMock = vi.fn();

let pathname = '/msp/dashboard';

const translations = {
  de: {
    'msp/core': {
      'quickCreate.dialogTitles.ticket': 'Ticket schnell hinzufügen',
    },
    'features/tickets': {
      'quickAdd.dialogTitle': 'Ticket schnell hinzufügen',
      'quickAdd.titlePlaceholder': 'Ticket-Titel *',
      'quickAdd.clientPlaceholder': 'Kunden auswählen *',
      'quickAdd.boardPlaceholder': 'Board auswählen *',
      'quickAdd.statusPlaceholder': 'Status auswählen *',
      'quickAdd.selectPriority': 'Priorität auswählen *',
      'quickAdd.dueDate': 'Fälligkeitsdatum',
      'quickAdd.createAndView': 'Erstellen + Ticket anzeigen',
      'actions.cancel': 'Abbrechen',
      'actions.create': 'Erstellen',
    },
  },
} as const;

const interpolate = (template: string, values: Record<string, unknown> = {}) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => String(values[key] ?? ''));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({
    refresh: refreshMock,
    replace: replaceMock,
    push: pushMock,
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const ReactModule = await import('react');
  type ContextValue = {
    locale: keyof typeof translations;
  };

  const TestI18nContext = ReactModule.createContext<ContextValue>({
    locale: 'de',
  });

  return {
    detectClientLocale: () => 'de',
    useOptionalI18n: () => null,
    I18nProvider: ({
      children,
      initialLocale = 'de',
    }: {
      children: React.ReactNode;
      initialLocale?: keyof typeof translations;
    }) => (
      <TestI18nContext.Provider value={{ locale: initialLocale }}>
        {children}
      </TestI18nContext.Provider>
    ),
    useTranslation: (namespace?: string) => {
      const { locale } = ReactModule.useContext(TestI18nContext);

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
          const translation =
            namespace
              ? translations[locale]?.[namespace as 'msp/core' | 'features/tickets']?.[
                  key as keyof (typeof translations)['de']['msp/core'] &
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

vi.mock('server/src/components/layout/DefaultLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="default-layout">{children}</div>
  ),
}));

vi.mock('server/src/components/layout/Header', () => ({
  QUICK_CREATE_OPEN_EVENT: 'alga:quick-create:open',
  default: () => null,
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

// MspLayoutClient now wraps the tree in ProductProvider, which calls
// next-auth's useSession(); the AppSessionProvider mock above is a passthrough
// that doesn't supply a session context, so stub the provider out.
vi.mock('@/context/ProductContext', () => ({
  ProductProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/assets/components/QuickAddAsset', () => ({
  QuickAddAsset: () => null,
}));

vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({}));

vi.mock('@alga-psa/tickets/components', async () => {
  const ReactModule = await import('react');
  const { useTranslation } = await import('@alga-psa/ui/lib/i18n/client');

  return {
    QuickAddTicket: () => {
      const { t } = useTranslation('features/tickets');

      return (
        <section data-testid="global-quick-add-ticket">
          <h2>{t('quickAdd.dialogTitle', 'Quick Add Ticket')}</h2>
          <span>{t('quickAdd.titlePlaceholder', 'Ticket Title *')}</span>
          <span>{t('quickAdd.clientPlaceholder', 'Select Client *')}</span>
          <span>{t('quickAdd.boardPlaceholder', 'Select Board *')}</span>
          <span>{t('quickAdd.statusPlaceholder', 'Select Status *')}</span>
          <span>{t('quickAdd.selectPriority', 'Select Priority *')}</span>
          <span>{t('quickAdd.dueDate', 'Due Date')}</span>
          <button type="button">{t('actions.cancel', 'Cancel')}</button>
          <button type="button">{t('actions.create', 'Create')}</button>
          <button type="button">{t('quickAdd.createAndView', 'Create + View Ticket')}</button>
        </section>
      );
    },
  };
});

vi.mock('@alga-psa/clients/components/clients/QuickAddClient', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/clients/components/contacts/QuickAddContact', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/projects/components/ProjectQuickAdd', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/billing/components', () => ({
  QuickAddProduct: () => null,
  QuickAddService: () => null,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getAllClients: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions', () => ({
  getServiceTypesForSelection: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
}));

const { QuickCreateDialog } = await import('server/src/components/layout/QuickCreateDialog');
const { MspLayoutClient } = await import('server/src/app/msp/MspLayoutClient');

function renderQuickCreateDialog(locale: keyof typeof translations = 'de') {
  render(
    <MspLayoutClient
      session={null}
      needsOnboarding={false}
      initialSidebarCollapsed={false}
      initialLocale={locale}
      i18nEnabled={true}
    >
      <QuickCreateDialog type="ticket" onClose={vi.fn()} />
    </MspLayoutClient>
  );
}

describe('global quick-create ticket i18n integration', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    pathname = '/msp/dashboard';
  });

  afterEach(() => {
    cleanup();
  });

  it('T106: the global quick-create dialog routes ticket creation to the create-ticket modal route instead of rendering the editor inline', () => {
    renderQuickCreateDialog('de');

    // The heavy ticket quick-add shell (and its rich-text editor) must NOT load in the
    // app shell anymore — selecting "ticket" navigates to the create-ticket route, which
    // renders the dialog as an intercepted modal and keeps the editor out of first-load.
    expect(pushMock).toHaveBeenCalledWith('/msp/create-ticket');

    expect(screen.queryByTestId('global-quick-add-ticket')).not.toBeInTheDocument();
    expect(screen.queryByText('Ticket schnell hinzufügen')).not.toBeInTheDocument();
    expect(screen.queryByText('Ticket-Titel *')).not.toBeInTheDocument();
  });
});
