import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMyServiceRequestSubmissionDetailAction } from '../actions';

interface MyRequestDetailPageProps {
  params: Promise<{
    submissionId: string;
  }>;
}

function formatDateTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return date.toLocaleString();
}

export default async function MyRequestDetailPage(props: MyRequestDetailPageProps) {
  const { submissionId } = await props.params;
  const submission = await getMyServiceRequestSubmissionDetailAction(submissionId);

  if (!submission) {
    notFound();
  }

  const fields = Array.isArray((submission.form_schema_snapshot as any)?.fields)
    ? ((submission.form_schema_snapshot as any).fields as any[])
    : [];
  const payload = submission.submitted_payload ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{submission.request_name}</h1>
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            Request ID: <span className="font-mono">{submission.submission_id}</span>
          </p>
        </div>
        <Link
          href="/client-portal/request-services/my-requests"
          className="text-sm text-[rgb(var(--color-primary-600))] hover:underline"
        >
          Back to My Requests
        </Link>
      </div>

      <section className="rounded border p-4 bg-[rgb(var(--color-background-100))]">
        <h2 className="text-base font-semibold mb-2">Status</h2>
        <p className="text-sm">Submitted: {formatDateTime(submission.submitted_at)}</p>
        <p className="text-sm">Execution status: {submission.execution_status}</p>
        {submission.created_ticket_id && <p className="text-sm">Ticket: {submission.created_ticket_id}</p>}
        {submission.workflow_execution_id && (
          <p className="text-sm">Workflow: {submission.workflow_execution_id}</p>
        )}
      </section>

      <section className="rounded border p-4 bg-[rgb(var(--color-background-100))]">
        <h2 className="text-base font-semibold mb-2">Submitted Answers</h2>
        {fields.length === 0 ? (
          <pre className="text-xs bg-white p-2 rounded overflow-auto">
            {JSON.stringify(payload, null, 2)}
          </pre>
        ) : (
          <dl className="space-y-2">
            {fields.map((field: any, index: number) => {
              const key = typeof field?.key === 'string' ? field.key : `field_${index}`;
              const label = typeof field?.label === 'string' ? field.label : key;
              const value = (payload as Record<string, unknown>)[key];
              return (
                <div key={key} className="rounded border bg-white p-2">
                  <dt className="text-xs font-semibold text-[rgb(var(--color-text-700))]">{label}</dt>
                  <dd className="text-sm">
                    {value === null || value === undefined || value === '' ? (
                      <span className="text-[rgb(var(--color-text-500))]">No response</span>
                    ) : (
                      String(value)
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </section>

      <section className="rounded border p-4 bg-[rgb(var(--color-background-100))]">
        <h2 className="text-base font-semibold mb-2">Attachments</h2>
        {submission.attachments.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-600))]">No attachments included.</p>
        ) : (
          <ul className="space-y-2">
            {submission.attachments.map((attachment) => (
              <li key={attachment.submission_attachment_id} className="rounded border bg-white p-2">
                <p className="text-sm font-medium">{attachment.file_name ?? attachment.file_id}</p>
                <p className="text-xs text-[rgb(var(--color-text-600))]">File ID: {attachment.file_id}</p>
                {attachment.mime_type && (
                  <p className="text-xs text-[rgb(var(--color-text-600))]">Type: {attachment.mime_type}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
