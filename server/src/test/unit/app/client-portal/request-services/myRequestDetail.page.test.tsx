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

const getMyServiceRequestSubmissionDetailActionMock = vi.fn();

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

// Translations come from the real en locale file so the assertions exercise the
// copy users actually see, without pinning exact source strings in the test.
const t = (key: string, options: TranslationOptions = {}) => {
  const translation = resolveKey(enServiceRequests as Record<string, unknown>, key);
  return interpolate(translation ?? options.defaultValue ?? key, options);
};

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@alga-psa/ui/components/BackNav', () => ({
  default: ({ children }: { children: React.ReactNode }) => <nav>{children}</nav>,
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerLocale: vi.fn().mockResolvedValue('en'),
  getServerTranslation: vi.fn().mockResolvedValue({ t }),
  formatDate: (date: Date) => date.toISOString(),
}));

vi.mock(
  'server/src/app/client-portal/request-services/my-requests/actions',
  () => ({
    getMyServiceRequestSubmissionDetailAction: (...args: unknown[]) =>
      getMyServiceRequestSubmissionDetailActionMock(...args),
  })
);

const { default: MyRequestDetailPage } = await import(
  'server/src/app/client-portal/request-services/my-requests/[submissionId]/page'
);

function buildDetail(overrides: Record<string, unknown> = {}) {
  return {
    submission_id: 'submission-1',
    definition_id: 'definition-1',
    definition_version_id: 'version-1',
    definition_version_number: 1,
    request_name: 'Onboarding Questionnaire',
    submitted_payload: { request_title: 'New Hire Onboarding' },
    execution_status: 'succeeded',
    execution_error_summary: null,
    created_ticket_id: null,
    workflow_execution_id: null,
    submitted_at: new Date('2026-09-02T12:00:00Z'),
    form_schema_snapshot: {
      fields: [
        { key: 'request_title', type: 'short-text', label: 'Request Title', required: true },
      ],
    },
    attachments: [],
    audit_events: [],
    ...overrides,
  };
}

async function renderDetailPage() {
  render(
    await MyRequestDetailPage({
      params: Promise.resolve({ submissionId: 'submission-1' }),
    })
  );
}

describe('/client-portal/request-services/my-requests/[submissionId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the immutable captured form version for a store-only submission', async () => {
    getMyServiceRequestSubmissionDetailActionMock.mockResolvedValue(buildDetail());

    await renderDetailPage();

    expect(screen.getByText('Version 1')).toBeInTheDocument();
    expect(screen.getByText('New Hire Onboarding')).toBeInTheDocument();
  });

  it('renders timestamped, actor-attributed audit history entries', async () => {
    getMyServiceRequestSubmissionDetailActionMock.mockResolvedValue(
      buildDetail({
        audit_events: [
          {
            audit_id: 'audit-1',
            operation: 'service_request_submission_created',
            user_id: 'user-1',
            actor_name: 'Casey Client',
            timestamp: new Date('2026-09-02T12:00:00Z'),
            details: {},
          },
          {
            audit_id: 'audit-2',
            operation: 'service_request_submission_execution_succeeded',
            user_id: 'user-1',
            actor_name: 'Casey Client',
            timestamp: new Date('2026-09-02T12:00:05Z'),
            details: {},
          },
        ],
      })
    );

    await renderDetailPage();

    // Lifecycle operations render as translated labels, not raw operation keys.
    expect(
      screen.getByText(t('submissionDetail.historyOperations.service_request_submission_created'))
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        t('submissionDetail.historyOperations.service_request_submission_execution_succeeded')
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText('service_request_submission_created')
    ).not.toBeInTheDocument();

    // Each entry is actor-attributed.
    const actorLines = screen.getAllByText((_, element) =>
      Boolean(element?.textContent?.includes(t('submissionDetail.historyActor', { actor: 'Casey Client' })))
    );
    expect(actorLines.length).toBeGreaterThan(0);
  });

  it('shows a graceful empty state for legacy submissions without audit history', async () => {
    getMyServiceRequestSubmissionDetailActionMock.mockResolvedValue(buildDetail());

    await renderDetailPage();

    expect(screen.getByText(t('submissionDetail.historyTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('submissionDetail.historyEmpty'))).toBeInTheDocument();
  });
});
