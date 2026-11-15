/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import enServiceRequests from '../../../../../../public/locales/en/client-portal/service-requests.json';

(globalThis as unknown as { React?: typeof React }).React = React;

type TranslationOptions = {
  defaultValue?: string;
  [key: string]: unknown;
};

const listRequestServiceCatalogGroupsActionMock = vi.fn();
const listMyRecentServiceRequestsActionMock = vi.fn();
const getMyServiceRequestSubmissionSummaryActionMock = vi.fn();

const interpolate = (template: string, values: Record<string, unknown> = {}) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => String(values[key] ?? ''));

function resolveKey(source: Record<string, unknown>, key: string): string | undefined {
  let current: unknown = source;
  for (const segment of key.split('.')) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

// Translations come from the real en locale file: assertions run against the
// copy users actually see rather than strings duplicated into the test.
const t = (key: string, defaultValueOrOptions?: string | TranslationOptions) => {
  const options =
    typeof defaultValueOrOptions === 'string'
      ? { defaultValue: defaultValueOrOptions }
      : defaultValueOrOptions ?? {};
  const translation = resolveKey(enServiceRequests as Record<string, unknown>, key);
  return interpolate(translation ?? options.defaultValue ?? key, options);
};

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: vi.fn().mockResolvedValue({ t }),
  getServerLocale: vi.fn().mockResolvedValue('en'),
  formatDate: (date: Date) => `formatted:${date.toISOString()}`,
}));

const getDateFormatPreferenceMock = vi.fn();
vi.mock('@alga-psa/clients/actions/countryActions', () => ({
  getDateFormatPreference: (...args: unknown[]) => getDateFormatPreferenceMock(...args),
}));

vi.mock('@/lib/serverProductRouteGuard', () => ({
  enforceServerProductRoute: vi.fn().mockResolvedValue(null),
}));

vi.mock('server/src/app/client-portal/request-services/actions', () => ({
  listRequestServiceCatalogGroupsAction: (...args: unknown[]) =>
    listRequestServiceCatalogGroupsActionMock(...args),
  listMyRecentServiceRequestsAction: (...args: unknown[]) =>
    listMyRecentServiceRequestsActionMock(...args),
}));

vi.mock(
  'server/src/app/client-portal/request-services/my-requests/actions',
  () => ({
    getMyServiceRequestSubmissionSummaryAction: (...args: unknown[]) =>
      getMyServiceRequestSubmissionSummaryActionMock(...args),
  })
);

vi.mock(
  'server/src/app/client-portal/request-services/my-requests/MyRequestsTable',
  () => ({
    MyRequestsTable: () => <div data-testid="my-requests-table" />,
  })
);

const { default: ServiceRequestsPage } = await import(
  'server/src/app/client-portal/request-services/page'
);

describe('/client-portal/request-services catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDateFormatPreferenceMock.mockResolvedValue('system');
    listMyRecentServiceRequestsActionMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('introduces a mixed store-only/ticket catalog without promising a ticket', async () => {
    // A catalog mixing destinations: one store-only definition, one
    // ticket-creating definition. The shared intro copy must hold for both.
    listRequestServiceCatalogGroupsActionMock.mockResolvedValue([
      {
        category: 'Onboarding',
        items: [
          {
            definitionId: 'store-only-def',
            title: 'Onboarding Questionnaire',
            description: 'Tell us about your new hire.',
            icon: 'file-text',
          },
          {
            definitionId: 'ticket-def',
            title: 'Access Request',
            description: 'Request access to a system.',
            icon: 'key-round',
          },
        ],
      },
    ]);

    render(await ServiceRequestsPage({}));

    const heading = screen.getByText(t('catalog.newRequestHeading', 'Submit a new request'));
    const description = heading.nextElementSibling;

    // The intro copy under the catalog heading must exist and stay
    // destination-neutral: no promise that submitting creates a ticket.
    expect(description).not.toBeNull();
    expect(description?.textContent?.trim()).toBeTruthy();
    expect(description?.textContent).not.toMatch(/ticket/i);

    // Both destination modes render as ordinary catalog entries.
    expect(screen.getByText('Onboarding Questionnaire')).toBeInTheDocument();
    expect(screen.getByText('Access Request')).toBeInTheDocument();
  });

  describe('success banner', () => {
    const summary = {
      submission_id: 'submission-guid-1',
      request_name: 'Access Request',
      execution_status: 'succeeded',
      submitted_at: new Date('2026-09-02T12:00:00Z'),
      created_ticket_id: 'ticket-guid-1',
      ticket_number: '100150',
    };

    beforeEach(() => {
      listRequestServiceCatalogGroupsActionMock.mockResolvedValue([]);
    });

    it('shows the request name and a linked ticket number without any GUID text', async () => {
      getMyServiceRequestSubmissionSummaryActionMock.mockResolvedValue(summary);

      render(
        await ServiceRequestsPage({
          searchParams: Promise.resolve({ submitted: 'submission-guid-1', ticketId: 'forged-ticket-id' }),
        })
      );

      expect(getMyServiceRequestSubmissionSummaryActionMock).toHaveBeenCalledWith('submission-guid-1');
      expect(screen.getByText(/Access Request, submitted/)).toBeInTheDocument();
      const link = screen.getByRole('link', { name: '#100150' });
      expect(link).toHaveAttribute('href', '/client-portal/tickets/ticket-guid-1');
      expect(screen.queryByText(/submission-guid-1/)).not.toBeInTheDocument();
      expect(screen.queryByText(/ticket-guid-1/)).not.toBeInTheDocument();
      expect(screen.queryByText(/forged-ticket-id/)).not.toBeInTheDocument();
      expect(document.querySelector('a[href*="forged-ticket-id"]')).toBeNull();
    });

    it('renders no banner when the summary does not resolve', async () => {
      getMyServiceRequestSubmissionSummaryActionMock.mockResolvedValue(null);

      render(
        await ServiceRequestsPage({
          searchParams: Promise.resolve({ submitted: 'unknown-id', ticketId: 'forged-ticket-id' }),
        })
      );

      expect(screen.queryByText(t('detail.submitted'))).not.toBeInTheDocument();
      expect(screen.queryByText(/forged-ticket-id/)).not.toBeInTheDocument();
    });

    it('renders no banner for a malformed submitted value', async () => {
      // The real action returns null for non-UUID ids; the page must not throw.
      getMyServiceRequestSubmissionSummaryActionMock.mockResolvedValue(null);

      render(
        await ServiceRequestsPage({ searchParams: Promise.resolve({ submitted: 'not-a-uuid' }) })
      );

      expect(screen.queryByText(t('detail.submitted'))).not.toBeInTheDocument();
      expect(getDateFormatPreferenceMock).not.toHaveBeenCalled();
    });

    it('does not look anything up when submitted is absent', async () => {
      render(await ServiceRequestsPage({}));

      expect(getMyServiceRequestSubmissionSummaryActionMock).not.toHaveBeenCalled();
      expect(getDateFormatPreferenceMock).not.toHaveBeenCalled();
      expect(screen.queryByText(t('detail.submitted'))).not.toBeInTheDocument();
    });

    it('renders the banner without a ticket line for a store-only submission', async () => {
      getMyServiceRequestSubmissionSummaryActionMock.mockResolvedValue({
        ...summary,
        created_ticket_id: null,
        ticket_number: null,
      });

      render(
        await ServiceRequestsPage({ searchParams: Promise.resolve({ submitted: 'submission-guid-1' }) })
      );

      expect(screen.getByText(t('detail.submitted'))).toBeInTheDocument();
      expect(screen.getByText(/Access Request, submitted/)).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.queryByText(t('ticketReference.label'))).not.toBeInTheDocument();
    });
  });
});
