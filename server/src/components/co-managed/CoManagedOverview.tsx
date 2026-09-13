'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Archive, ArrowUpRight, LifeBuoy, ListChecks } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { BentoTile, BentoRow, BentoRowList } from '@alga-psa/ui/components/bento';
import { getCoManagedBillingState } from '@/lib/actions/coManagedActions';
import CoManagedProvisioningPanel from './CoManagedProvisioningPanel';
import CoManagedPoolEditor from './CoManagedPoolEditor';
import CoManagedClientOverviewTable from './CoManagedClientOverviewTable';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';

/**
 * Cross-client co-managed overview, laid out on the shared bento canvas so it
 * reads as one product with the client command center: a wide tile column with
 * the seat pool, clients, and provisioning, plus a sticky shared-work rail.
 * The sponsor pool editor is shared with Account Management; client setup and
 * recovery are client-scoped, so this page links to client records.
 */
export default function CoManagedOverview({ initialClientId }: { initialClientId?: string }) {
  const { t } = useTranslation('msp/licensing');
  // The provisioning panel needs the pool numbers, not just the permission:
  // seat capacity decides whether a new customer workspace can be created at
  // all. Keep the whole billing state so the panel is driven by real capacity.
  const [state, setState] = useState<Awaited<ReturnType<typeof getCoManagedBillingState>> | null>(null);
  const [denied, setDenied] = useState(false);
  const reload = useCallback(async () => {
    try { setState(await getCoManagedBillingState()); setDenied(false); }
    catch { setState(null); setDenied(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  // Relationship authority is independent of pool authority: an account-only
  // reader still gets the pool editor but no relationship rows.
  const canReadRelationships = state?.canReadRelationships === true;

  return <div id="co-managed-overview" className="min-w-0">
    <header className="mb-4">
      <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">{t('coManaged.title')}</h1>
      <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">{t('coManaged.description')}</p>
    </header>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <CoManagedPoolEditor showTotals className="min-w-0 lg:col-span-2" />
      <div className="min-w-0 lg:col-span-1 [&>*]:h-full">
        <CoManagedFeatureBoundary>
          <SharedWorkTile />
        </CoManagedFeatureBoundary>
      </div>
    </div>
    {/* A failed read is not the same as "no co-managed clients": say so rather
        than rendering an empty page that looks like an answer. */}
    {denied && <p id="co-managed-overview-error" role="alert" className="mt-4 text-destructive">
      {t('coManaged.loadError')}
    </p>}
    {canReadRelationships && state && <div className="mt-4 grid grid-cols-1 gap-4">
      <CoManagedClientOverviewTable />
      <CoManagedProvisioningPanel available={state.available} canGrow={state.isPro && state.canGrow}
        initialClientId={initialClientId} onChanged={reload} />
    </div>}
  </div>;
}

/** Contextual entry points into the co-managed work queues and archive. */
function SharedWorkTile() {
  const { t } = useTranslation('msp/licensing');
  const links = [
    // Canonical combined scope on the one ticket list. /msp/co-managed/tickets
    // still resolves here through the legacy adapter, but product-owned links
    // point at the destination rather than the compatibility route.
    { id: 'co-managed-ticket-queues', href: '/msp/tickets?queueView=working&workspace=all', label: t('coManaged.queue.title'), icon: LifeBuoy },
    { id: 'co-managed-task-queues', href: '/msp/co-management/tasks', label: t('coManaged.projects.queue.title'), icon: ListChecks },
    { id: 'co-managed-archive-link', href: '/msp/co-managed/archive', label: t('coManaged.archive.title'), icon: Archive },
  ];
  return <BentoTile id="co-managed-shared-work" className="h-full" title={t('coManaged.sharedWork', { defaultValue: 'Shared work' })}>
    <BentoRowList id="co-managed-shared-work-list">
      {links.map(({ id, href, label, icon: Icon }) => (
        <BentoRow key={id} align="center">
          <Link id={id} href={href}
            className="group flex min-w-0 w-full items-center gap-2 text-sm font-medium text-[rgb(var(--color-text-700))] hover:text-[rgb(var(--color-primary-600))]">
            <Icon className="h-4 w-4 flex-shrink-0 text-[rgb(var(--color-text-400))] group-hover:text-[rgb(var(--color-primary-500))]" aria-hidden="true" />
            <span className="truncate">{label}</span>
            <ArrowUpRight className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-primary-500 group-hover:text-primary-700" aria-hidden="true" />
          </Link>
        </BentoRow>
      ))}
    </BentoRowList>
  </BentoTile>;
}
