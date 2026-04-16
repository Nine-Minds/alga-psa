/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MyRequestDetailPage from './page';

const getMyServiceRequestSubmissionDetailAction = vi.fn();
const notFound = vi.fn();

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

vi.mock('../actions', () => ({
  getMyServiceRequestSubmissionDetailAction: (...args: unknown[]) =>
    getMyServiceRequestSubmissionDetailAction(...args),
}));

describe('MyRequestDetailPage', () => {
  beforeEach(() => {
    getMyServiceRequestSubmissionDetailAction.mockReset();
    notFound.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders snapshot-aware answers and linked ticket references for submission history detail', async () => {
    getMyServiceRequestSubmissionDetailAction.mockResolvedValue({
      submission_id: 'submission-1',
      definition_id: 'definition-1',
      definition_version_id: 'version-1',
      request_name: 'Access Request',
      submitted_payload: {
        access_level: 'standard',
        needs_manager_approval: true,
      },
      execution_status: 'succeeded',
      execution_error_summary: null,
      created_ticket_id: 'ticket-123',
      workflow_execution_id: 'workflow-456',
      submitted_at: '2026-03-29T14:30:00.000Z',
      form_schema_snapshot: {
        fields: [
          {
            key: 'access_level',
            label: 'Access Level',
            type: 'select',
            options: [
              { value: 'standard', label: 'Standard Access' },
              { value: 'admin', label: 'Admin Access' },
            ],
          },
          {
            key: 'needs_manager_approval',
            label: 'Manager Approval Required',
            type: 'checkbox',
          },
          {
            key: 'supporting_quote',
            label: 'Supporting Quote',
            type: 'file-upload',
          },
        ],
      },
      attachments: [
        {
          submission_attachment_id: 'attachment-1',
          field_key: 'supporting_quote',
          file_id: 'file-1',
          file_name: 'quote.pdf',
          mime_type: 'application/pdf',
          file_size: '1024',
          created_at: '2026-03-29T14:30:00.000Z',
        },
      ],
    });

    render(
      await MyRequestDetailPage({
        params: Promise.resolve({ submissionId: 'submission-1' }),
      })
    );

    expect(screen.getByText('Standard Access')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    const submittedAnswersSection = screen
      .getByRole('heading', { name: 'Submitted Answers' })
      .closest('section');
    expect(submittedAnswersSection).not.toBeNull();
    expect(within(submittedAnswersSection as HTMLElement).getByText('quote.pdf')).toBeInTheDocument();

    const ticketLink = screen.getByRole('link', { name: 'ticket-123' });
    expect(ticketLink).toHaveAttribute('href', '/client-portal/tickets/ticket-123');
  });
});
