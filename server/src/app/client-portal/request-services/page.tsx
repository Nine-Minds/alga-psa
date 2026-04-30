import Link from 'next/link';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import {
  listRequestServiceCatalogGroupsAction,
  listMyRecentServiceRequestsAction,
} from './actions';
import { ServiceRequestCard } from './ServiceRequestCard';
import { MyRequestsTable, type MyRequestsTableRow } from './my-requests/MyRequestsTable';

interface ServiceRequestsPageProps {
  searchParams?: Promise<{
    submitted?: string;
    ticketId?: string;
  }>;
}

export default async function ServiceRequestsPage(props: ServiceRequestsPageProps) {
  const resolvedSearchParams = props.searchParams ? await props.searchParams : undefined;
  const submittedRequestId =
    typeof resolvedSearchParams?.submitted === 'string' ? resolvedSearchParams.submitted : null;
  const submittedTicketId =
    typeof resolvedSearchParams?.ticketId === 'string' ? resolvedSearchParams.ticketId : null;

  // Fetching all submissions here keeps the page a single round-trip; the table
  // paginates client-side, which is fine for the small per-client volume.
  const [groups, allSubmissions, { t }] = await Promise.all([
    listRequestServiceCatalogGroupsAction(),
    listMyRecentServiceRequestsAction(1000),
    getServerTranslation(undefined, 'client-portal/service-requests'),
  ]);

  const rows: MyRequestsTableRow[] = allSubmissions.map((submission) => ({
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
    <div className="space-y-8">
      {/* Header is provided by the layout topbar via clientPortalRouteTitles */}

      {/* Success banner: rendered after a redirect from the form-submit action. */}
      {submittedRequestId && (
        <Alert variant="success">
          <AlertTitle>{t('detail.submitted')}</AlertTitle>
          <AlertDescription>
            <p>
              {t('detail.requestIdLabel')}
              <span className="font-mono">{submittedRequestId}</span>
            </p>
            {submittedTicketId && (
              <p>
                {t('detail.ticketIdLabel')}
                <Link
                  href={`/client-portal/tickets/${submittedTicketId}`}
                  className="font-mono underline"
                >
                  {submittedTicketId}
                </Link>
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Submit a new request — catalog grid */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">
            {t('catalog.newRequestHeading', 'Submit a new request')}
          </h2>
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            {t('catalog.description')}
          </p>
        </div>

        {groups.length === 0 ? (
          <div className="rounded border p-4 text-sm text-[rgb(var(--color-text-600))]">
            {t('catalog.empty')}
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.category} className="space-y-3">
                <h3 className="text-base font-semibold">{group.category}</h3>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {group.items.map((item) => (
                    <Link
                      key={item.definitionId}
                      id={`request-service-card-${item.definitionId}`}
                      href={`/client-portal/request-services/${item.definitionId}`}
                      className="block"
                    >
                      <ServiceRequestCard
                        title={item.title}
                        description={item.description}
                        icon={item.icon}
                        categoryLabel={group.category}
                        fallbackCategory={t('catalog.fallbackCategory')}
                        noDescription={t('catalog.noDescription')}
                      />
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      {/* Your requests — full paginated table */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          {t('myRequestsAll.title', 'Your requests')}
        </h2>
        {rows.length === 0 ? (
          <div className="rounded border p-4 text-sm text-[rgb(var(--color-text-600))]">
            {t('myRequests.empty')}
          </div>
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
      </section>
    </div>
  );
}
