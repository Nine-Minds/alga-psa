import Link from 'next/link';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { listMyServiceRequestSubmissionsAction } from './actions';
import { MyRequestsTable, type MyRequestsTableRow } from './MyRequestsTable';

export default async function MyServiceRequestsPage() {
  const [submissions, { t }] = await Promise.all([
    listMyServiceRequestSubmissionsAction(),
    getServerTranslation(undefined, 'client-portal/service-requests'),
  ]);

  const rows: MyRequestsTableRow[] = submissions.map((submission) => ({
    submission_id: submission.submission_id,
    request_name: submission.request_name,
    execution_status: submission.execution_status,
    submitted_at:
      submission.submitted_at instanceof Date
        ? submission.submitted_at.toISOString()
        : String(submission.submitted_at),
    created_ticket_id: submission.created_ticket_id,
    ticket_number: submission.ticket_number,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('myRequests.title')}</h1>
        <Link
          href="/client-portal/request-services"
          className="text-sm text-[rgb(var(--color-primary-600))] hover:underline"
        >
          {t('myRequests.browseServices')}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded border p-4 text-sm text-[rgb(var(--color-text-600))]">
          {t('myRequests.empty')}
        </p>
      ) : (
        <MyRequestsTable
          rows={rows}
          labels={{
            request: t('myRequests.columns.request'),
            submitted: t('myRequests.columns.submitted'),
            status: t('myRequests.columns.status'),
            ticket: t('myRequests.columns.ticket', 'Ticket'),
            noTicket: t('myRequests.noTicket', 'No ticket'),
            details: t('myRequests.columns.details'),
            view: t('myRequests.view'),
            unknownDate: t('myRequests.unknownDate'),
            statuses: {
              pending: t('myRequests.statuses.pending'),
              succeeded: t('myRequests.statuses.succeeded'),
              failed: t('myRequests.statuses.failed'),
            },
          }}
        />
      )}
    </div>
  );
}
