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
    request_name: 'Onboarding Questionnaire',
    submitted_payload: { request_title: 'New Hire Onboarding' },
    execution_status: 'succeeded',
    created_ticket_id: null,
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

  it('renders submitted answers against the captured form snapshot', async () => {
    getMyServiceRequestSubmissionDetailActionMock.mockResolvedValue(buildDetail());

    await renderDetailPage();

    expect(screen.getByText('Request Title')).toBeInTheDocument();
    expect(screen.getByText('New Hire Onboarding')).toBeInTheDocument();
  });

  it('renders a translated status badge, attachment names and no internal data', async () => {
    const namedId = '11111111-1111-4111-8111-111111111111';
    getMyServiceRequestSubmissionDetailActionMock.mockResolvedValue(
      buildDetail({
        execution_status: 'failed',
        form_schema_snapshot: {
          fields: [{ key: 'upload', type: 'file-upload', label: 'Upload' }],
        },
        submitted_payload: {},
        attachments: [
          {
            submission_attachment_id: namedId,
            field_key: 'upload',
            file_name: 'report.pdf',
            mime_type: 'application/pdf',
          },
          {
            submission_attachment_id: '22222222-2222-4222-8222-222222222222',
            field_key: 'upload',
            file_name: null,
            mime_type: null,
          },
        ],
        audit_events: [
          {
            audit_id: 'audit-1',
            operation: 'service_request_submission_execution_failed',
            actor_name: null,
            timestamp: new Date('2026-09-02T12:00:00Z'),
          },
        ],
      })
    );

    await renderDetailPage();

    expect(screen.getByText(t('myRequests.statuses.failed'))).toBeInTheDocument();
    expect(screen.getAllByText('report.pdf').length).toBeGreaterThan(0);
    expect(screen.getAllByText(t('submissionDetail.unnamedAttachment')).length).toBeGreaterThan(0);
    expect(
      screen.getByText(t('submissionDetail.historyOperations.service_request_submission_execution_failed'))
    ).toBeInTheDocument();

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Execution status/i);
    expect(text).not.toMatch(/Version/i);
    expect(text).not.toMatch(/Workflow/i);
    expect(text).not.toMatch(/File ID/i);
    expect(text).not.toContain(namedId);
    expect(text).not.toContain('22222222-2222-4222-8222-222222222222');
  });

  it('renders the payload as label/value rows when the snapshot has no fields', async () => {
    getMyServiceRequestSubmissionDetailActionMock.mockResolvedValue(
      buildDetail({
        form_schema_snapshot: {},
        submitted_payload: { legacy_answer: 'Blue', count: 3 },
      })
    );

    await renderDetailPage();

    const terms = Array.from(document.querySelectorAll('dt')).map((el) => el.textContent);
    expect(terms).toEqual(['legacy_answer', 'count']);
    const definitions = Array.from(document.querySelectorAll('dd')).map((el) => el.textContent);
    expect(definitions).toEqual(['Blue', '3']);
    expect(document.querySelector('pre')).toBeNull();
  });

  it('renders timestamped, actor-attributed audit history entries', async () => {
    getMyServiceRequestSubmissionDetailActionMock.mockResolvedValue(
      buildDetail({
        audit_events: [
          {
            audit_id: 'audit-1',
            operation: 'service_request_submission_created',
            actor_name: 'Casey Client',
            timestamp: new Date('2026-09-02T12:00:00Z'),
          },
          {
            audit_id: 'audit-2',
            operation: 'service_request_submission_execution_succeeded',
            actor_name: 'Casey Client',
            timestamp: new Date('2026-09-02T12:00:05Z'),
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
