'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { BentoChip, BentoTile, type BentoChipTone } from '@alga-psa/ui/components/bento';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import Pagination from '@alga-psa/ui/components/Pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedClientOverviewAction } from '@/lib/actions/coManagedActions';

type Page = Awaited<ReturnType<typeof getCoManagedClientOverviewAction>>;
const PAGE_SIZE = 20;

/** State marker tone, so the table reads at a glance like the rest of the product. */
const STATE_TONE: Record<string, BentoChipTone> = {
  active: 'success',
  queued: 'info',
  provisioning: 'info',
  pending_acceptance: 'info',
  cleanup_requested: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
  terminated: 'neutral',
};

/**
 * Authorized cross-client status and usage table. Counts come from the same
 * record-policy projection as the rows, so the sponsor pool totals are never
 * reconciled by subtracting restricted clients from a visible list.
 */
export default function CoManagedClientOverviewTable({ className }: { className?: string }) {
  const { t } = useTranslation('msp/licensing');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page | null>(null);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const reload = useCallback(() => {
    const current = ++generation.current;
    void getCoManagedClientOverviewAction({ search, page, pageSize: PAGE_SIZE }).then(
      next => { if (generation.current === current) { setResult(next); setError(false); } },
      () => { if (generation.current === current) { setResult(null); setError(true); } },
    );
    return () => { generation.current += 1; };
  }, [search, page]);

  useEffect(() => {
    const cancel = reload();
    return cancel;
  }, [reload]);

  useEffect(() => {
    const timer = setTimeout(() => setPage(1), 200);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <BentoTile
      id="co-managed-client-overview"
      className={className}
      title={t('coManaged.overview.clients', { defaultValue: 'Co-managed clients' })}
      action={<div className="flex items-center gap-3">
        {result ? <BentoChip tone="neutral">{result.totalCount}</BentoChip> : null}
        <Link id="co-managed-overview-all-clients" href="/msp/clients"
          className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary-600 hover:text-primary-800 whitespace-nowrap">
          {t('coManaged.overview.allClients', { defaultValue: 'All clients' })}
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="co-managed-overview-search">
            {t('coManaged.overview.search', { defaultValue: 'Search clients' })}
          </Label>
          <Input id="co-managed-overview-search" type="search" maxLength={200} value={search}
            onChange={(event) => setSearch(event.target.value)} />
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{t('coManaged.overview.loadError', { defaultValue: 'Could not load co-managed clients.' })}</AlertDescription></Alert>}
        {!result && !error && <p role="status">{t('coManaged.loading')}</p>}
        {result && result.rows.length === 0 && <p>{t('coManaged.overview.empty', { defaultValue: 'No co-managed clients match this search.' })}</p>}
        {result && result.rows.length > 0 && <div className="overflow-x-auto"><Table className="[&_td]:py-2.5 [&_th]:h-10">
          <TableHeader><TableRow>{['client', 'workspace', 'status', 'seats', 'actions'].map((key) =>
            <TableHead key={key}>{t(`coManaged.overview.${key}`, { defaultValue: key })}</TableHead>)}</TableRow></TableHeader>
          <TableBody className="[&_tr]:border-b [&_tr]:border-[rgb(var(--color-border-100))]">{result.rows.map((row) => {
            const href = `/msp/clients/${encodeURIComponent(row.clientId)}?tab=co-managed&relationshipId=${encodeURIComponent(row.relationshipId)}`;
            return <TableRow key={`${row.clientId}:${row.operationId}`}>
              <TableCell><Link id={`co-managed-overview-client-${row.operationId}`}
                className="font-semibold text-[rgb(var(--color-primary-700))] hover:underline" href={href}>
                {row.clientName ?? t('coManaged.overview.unnamed', { defaultValue: 'Client' })}
              </Link></TableCell>
              <TableCell className="text-muted-foreground">{row.workspaceName ?? '—'}</TableCell>
              <TableCell>
                <BentoChip tone={STATE_TONE[row.state] ?? 'neutral'}>
                  {t(`coManaged.provisioning.states.${row.state}`, { defaultValue: row.state })}
                </BentoChip>
                {row.invitationExpired && <p className="mt-1 text-muted-foreground">{t('coManaged.provisioning.invitationExpired')}</p>}
                {row.deliveryFailed && <p className="mt-1 text-muted-foreground">{t('coManaged.provisioning.deliveryFailed')}</p>}
                {row.cleanupFailed && <p className="mt-1 text-muted-foreground">{t('coManaged.provisioning.cleanupFailed')}</p>}
              </TableCell>
              <TableCell className="font-medium tabular-nums">{row.usedSeats != null
                ? t('coManaged.client.seatUsage', { defaultValue: '{{used}} of {{allocated}} technician seats', used: row.usedSeats, allocated: row.seats })
                : t('coManaged.client.seatAllocation', { defaultValue: '{{allocated}} allocated technician seats', allocated: row.seats })}</TableCell>
              <TableCell><Button id={`co-managed-overview-manage-${row.operationId}`} variant="outline" size="sm" asChild>
                <Link href={href}>{t('coManaged.policy.manage', { defaultValue: 'Manage' })}</Link>
              </Button></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table></div>}
        {result && <Pagination id="co-managed-overview-pagination" totalItems={result.totalCount}
          itemsPerPage={PAGE_SIZE} currentPage={page} onPageChange={setPage} />}
      </div>
    </BentoTile>
  );
}
