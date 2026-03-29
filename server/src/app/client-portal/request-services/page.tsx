import { listRequestServiceCatalogGroupsAction } from './actions';
import Link from 'next/link';

export default async function RequestServicesPage() {
  const groups = await listRequestServiceCatalogGroupsAction();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Request Services</h1>
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            Browse published services and submit structured requests.
          </p>
        </div>
        <Link
          href="/client-portal/request-services/my-requests"
          className="text-sm text-[rgb(var(--color-primary-600))] hover:underline"
        >
          My Requests
        </Link>
      </div>

      {groups.length === 0 ? (
        <div className="rounded border p-4 text-sm text-[rgb(var(--color-text-600))]">
          No request services are currently available.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.category} className="space-y-3">
              <h2 className="text-lg font-semibold">{group.category}</h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.items.map((item) => (
                  <Link
                    key={item.definitionId}
                    id={`request-service-card-${item.definitionId}`}
                    href={`/client-portal/request-services/${item.definitionId}`}
                    className="rounded border p-4 bg-[rgb(var(--color-background-100))]"
                  >
                    <div className="text-xs uppercase tracking-wide text-[rgb(var(--color-text-500))] mb-1">
                      {item.icon ?? 'service'}
                    </div>
                    <div className="text-base font-semibold">{item.title}</div>
                    <p className="text-sm text-[rgb(var(--color-text-700))] mt-1">
                      {item.description ?? 'No description provided'}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
