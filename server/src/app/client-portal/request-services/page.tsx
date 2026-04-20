import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { listRequestServiceCatalogGroupsAction } from './actions';
import Link from 'next/link';
import { ServiceRequestCard } from './ServiceRequestCard';

export default async function RequestServicesPage() {
  const [groups, { t }] = await Promise.all([
    listRequestServiceCatalogGroupsAction(),
    getServerTranslation(undefined, 'client-portal/service-requests'),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('catalog.title')}</h1>
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            {t('catalog.description')}
          </p>
        </div>
        <Link
          href="/client-portal/request-services/my-requests"
          className="text-sm text-[rgb(var(--color-primary-600))] hover:underline"
        >
          {t('catalog.myRequests')}
        </Link>
      </div>

      {groups.length === 0 ? (
        <div className="rounded border p-4 text-sm text-[rgb(var(--color-text-600))]">
          {t('catalog.empty')}
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
    </div>
  );
}
