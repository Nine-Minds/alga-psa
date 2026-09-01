import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDate, getServerLocale, getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { SupportedLocale } from '@alga-psa/core/i18n/config';
import BackNav from '@alga-psa/ui/components/BackNav';
import { getMyServiceRequestSubmissionDetailAction } from '../actions';
import { getSubmissionFieldDisplay } from '../../submissionFieldPresentation';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('clientPortal.requestServices.myRequests.detail.title', { defaultValue: 'Request Details' }),
  };
}

interface MyRequestDetailPageProps {
  params: Promise<{
    submissionId: string;
  }>;
}

// Module scope has no hook to read the locale from, so it is passed in rather
// than omitted — omitting it silently means the browser's, not the app's.
function formatDateTime(
  value: Date | string,
  locale: SupportedLocale,
  unknownLabel: string,
): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return unknownLabel;
  }
  return formatDate(date, locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function MyRequestDetailPage(props: MyRequestDetailPageProps) {
  const { submissionId } = await props.params;
  const [submission, { t }, locale] = await Promise.all([
    getMyServiceRequestSubmissionDetailAction(submissionId),
    getServerTranslation(undefined, 'client-portal/service-requests'),
    getServerLocale(),
  ]);

  if (!submission) {
    notFound();
  }

  const unknownLabel = t('myRequests.unknownDate');
  const fields = Array.isArray((submission.form_schema_snapshot as any)?.fields)
    ? ((submission.form_schema_snapshot as any).fields as any[])
    : [];
  const payload = submission.submitted_payload ?? {};

  return (
    <div className="space-y-4">
      <div className="mb-1">
        <BackNav href="/client-portal/request-services/my-requests">
          {t('submissionDetail.backToMyRequests')}
        </BackNav>
      </div>
      <div>
        <h1 className="text-2xl font-semibold">{submission.request_name}</h1>
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          {t('submissionDetail.requestIdLabel')}{' '}
          <span className="font-mono">{submission.submission_id}</span>
        </p>
      </div>

      <section className="rounded border p-4 bg-[rgb(var(--color-border-100))]">
        <h2 className="text-base font-semibold mb-2">{t('submissionDetail.statusSection')}</h2>
        <p className="text-sm">
          {t('submissionDetail.submittedAt', {
            date: formatDateTime(submission.submitted_at, locale, unknownLabel),
          })}
        </p>
        <p className="text-sm">
          {t('submissionDetail.executionStatus', { status: submission.execution_status })}
        </p>
        {submission.created_ticket_id && (
          <p className="text-sm">
            {t('submissionDetail.ticketLabel')}{' '}
            <Link
              href={`/client-portal/tickets/${submission.created_ticket_id}`}
              className="text-[rgb(var(--color-primary-600))] hover:underline"
            >
              {submission.created_ticket_id}
            </Link>
          </p>
        )}
        {submission.workflow_execution_id && (
          <p className="text-sm">
            {t('submissionDetail.workflowLabel', { id: submission.workflow_execution_id })}
          </p>
        )}
      </section>

      <section className="rounded border p-4 bg-[rgb(var(--color-border-100))]">
        <h2 className="text-base font-semibold mb-2">{t('submissionDetail.submittedAnswersTitle')}</h2>
        {fields.length === 0 ? (
          <pre className="text-xs bg-white p-2 rounded overflow-auto">
            {JSON.stringify(payload, null, 2)}
          </pre>
        ) : (
          <dl className="space-y-2">
            {fields.map((field: any, index: number) => {
              const key = typeof field?.key === 'string' ? field.key : `field_${index}`;
              const label = typeof field?.label === 'string' ? field.label : key;
              const display = getSubmissionFieldDisplay(
                field,
                fields,
                payload as Record<string, unknown>,
                submission.attachments
              );
              return (
                <div key={key} className="rounded border bg-white p-2">
                  <dt className="text-xs font-semibold text-[rgb(var(--color-text-700))]">{label}</dt>
                  <dd className="text-sm">
                    {display.kind === 'missing' ? (
                      <span className="text-[rgb(var(--color-text-500))]">{t('submissionDetail.noResponse')}</span>
                    ) : display.kind === 'attachments' ? (
                      <ul className="space-y-1">
                        {(display.attachments ?? []).map((attachment) => (
                          <li key={`${key}-${attachment.file_id}`}>
                            <span className="font-medium">
                              {attachment.file_name ?? attachment.file_id}
                            </span>
                            {attachment.file_name && (
                              <span className="text-[rgb(var(--color-text-600))]">
                                {' '}
                                ({attachment.file_id})
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      display.text
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </section>

      <section className="rounded border p-4 bg-[rgb(var(--color-border-100))]">
        <h2 className="text-base font-semibold mb-2">{t('submissionDetail.attachmentsTitle')}</h2>
        {submission.attachments.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-600))]">{t('submissionDetail.noAttachments')}</p>
        ) : (
          <ul className="space-y-2">
            {submission.attachments.map((attachment) => (
              <li key={attachment.submission_attachment_id} className="rounded border bg-white p-2">
                <p className="text-sm font-medium">{attachment.file_name ?? attachment.file_id}</p>
                <p className="text-xs text-[rgb(var(--color-text-600))]">
                  {t('submissionDetail.fileIdLabel', { id: attachment.file_id })}
                </p>
                {attachment.mime_type && (
                  <p className="text-xs text-[rgb(var(--color-text-600))]">
                    {t('submissionDetail.fileTypeLabel', { mime: attachment.mime_type })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
