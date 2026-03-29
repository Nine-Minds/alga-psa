import Link from 'next/link';
import { listMyServiceRequestSubmissionsAction } from './actions';

function formatDateTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return date.toLocaleString();
}

export default async function MyServiceRequestsPage() {
  const submissions = await listMyServiceRequestSubmissionsAction();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Requests</h1>
        <Link
          href="/client-portal/request-services"
          className="text-sm text-[rgb(var(--color-primary-600))] hover:underline"
        >
          Browse Services
        </Link>
      </div>

      {submissions.length === 0 ? (
        <p className="rounded border p-4 text-sm text-[rgb(var(--color-text-600))]">
          You have not submitted any service requests yet.
        </p>
      ) : (
        <div className="rounded border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[rgb(var(--color-background-100))] text-left">
              <tr>
                <th className="px-4 py-2">Request</th>
                <th className="px-4 py-2">Submitted</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => (
                <tr key={submission.submission_id} className="border-t">
                  <td className="px-4 py-2">{submission.request_name}</td>
                  <td className="px-4 py-2">{formatDateTime(submission.submitted_at)}</td>
                  <td className="px-4 py-2">{submission.execution_status}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/client-portal/request-services/my-requests/${submission.submission_id}`}
                      className="text-[rgb(var(--color-primary-600))] hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
