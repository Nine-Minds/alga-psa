'use client';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { CoManagedArchiveWork, CoManagedArchiveHistory, CoManagedSharedResource } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { listArchiveWorkAction, getArchiveHistoryAction, listArchiveFilesAction } from '@/lib/actions/coManagedArchiveActions';
import { CoManagedFeatureBoundary } from './CoManagedFeatureBoundary';
import { conversationText } from './conversationText';

const identity = (resource: CoManagedSharedResource) => JSON.stringify([resource.tenant, resource.relationshipId, resource.kind, resource.id]);
export default function CoManagedArchive() {
  const { data: session, status } = useSession();
  if (status !== 'authenticated' || !session?.user?.id || !session.user.tenant) return null;
  return <CoManagedFeatureBoundary><Archive key={JSON.stringify([session.user.tenant, session.user.id])} /></CoManagedFeatureBoundary>;
}
function Archive() {
  const { t } = useTranslation('msp/licensing');
  const [page, setPage] = useState(0), [refresh, setRefresh] = useState(0), [error, setError] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof listArchiveWorkAction>> | null>(null);
  const [selected, setSelected] = useState<CoManagedArchiveWork | null>(null);
  useEffect(() => {
    let active = true;
    setResult(null); setSelected(null); setError(false);
    void listArchiveWorkAction(page).then(value => { if (active) setResult(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [page, refresh]);
  const navigate = (next: number) => { setSelected(null); setResult(null); setPage(next); };
  return <div className="mx-auto max-w-6xl space-y-5 p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-3xl font-bold">{t('coManaged.archive.title')}</h1><p className="mt-2 text-muted-foreground">{t('coManaged.archive.description')}</p></div>
      <Button id="co-archive-refresh" type="button" variant="outline" onClick={() => { setSelected(null); setResult(null); setRefresh(value => value + 1); }}>{t('coManaged.policy.reload')}</Button>
    </div>
    {error ? <p role="alert" className="text-destructive">{t('coManaged.archive.error')}</p> : !result ? <p role="status">{t('coManaged.loading')}</p> : <>
      <div className="grid gap-5 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,3fr)]">
        <nav aria-label={t('coManaged.archive.work')} className="space-y-2">
          {!result.items.length && <p>{t('coManaged.archive.empty')}</p>}
          {result.items.map(work => <Button key={identity(work.resource)} id={`co-archive-work-${work.resource.tenant}-${work.resource.relationshipId}-${work.resource.kind}-${work.resource.id}`}
            type="button" variant={selected && identity(selected.resource) === identity(work.resource) ? 'default' : 'outline'} className="h-auto w-full justify-start whitespace-normal text-left"
            onClick={() => setSelected(work)}>
            <span className="min-w-0"><span className="block break-words font-semibold">{work.title || work.ticketNumber || t(`coManaged.archive.${work.resource.kind}`)}</span>
              <span className="block text-sm">{work.clientName || t('coManaged.archive.unknownClient')}</span></span>
          </Button>)}
          <div className="flex gap-2 pt-3">
            <Button id="co-archive-work-previous" type="button" variant="ghost" disabled={page === 0} onClick={() => navigate(page - 1)}>{t('coManaged.provisioning.previous')}</Button>
            <Button id="co-archive-work-next" type="button" variant="ghost" disabled={result.nextPage === null} onClick={() => navigate(result.nextPage!)}>{t('coManaged.provisioning.next')}</Button>
          </div>
        </nav>
        {selected ? <ArchiveDetail key={identity(selected.resource)} resource={selected.resource} /> : <p className="text-muted-foreground">{t('coManaged.archive.select')}</p>}
      </div>
    </>}
  </div>;
}
function ArchiveDetail({ resource }: { resource: CoManagedSharedResource }) {
  const { t } = useTranslation('msp/licensing'), { formatDate, formatNumber } = useFormatters();
  const [historyPage, setHistoryPage] = useState(0), [filePage, setFilePage] = useState(0), [error, setError] = useState(false);
  const [data, setData] = useState<{ history: CoManagedArchiveHistory; files: Awaited<ReturnType<typeof listArchiveFilesAction>> } | null>(null);
  useEffect(() => {
    let active = true; setData(null); setError(false);
    void Promise.all([getArchiveHistoryAction(resource, historyPage), listArchiveFilesAction(resource, filePage)])
      .then(([history, files]) => { if (active) setData({ history, files }); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [resource, historyPage, filePage]);
  const pageHistory = (page: number) => { setData(null); setHistoryPage(page); }, pageFiles = (page: number) => { setData(null); setFilePage(page); };
  if (error) return <p role="alert" className="text-destructive">{t('coManaged.archive.error')}</p>;
  if (!data) return <p role="status">{t('coManaged.loading')}</p>;
  return <section aria-label={t('coManaged.archive.history')} className="min-w-0 space-y-5">
    <div><h2 className="text-xl font-semibold">{data.history.work.title || data.history.work.ticketNumber || t(`coManaged.archive.${resource.kind}`)}</h2>
      <p className="text-sm text-muted-foreground">{data.history.work.clientName || t('coManaged.archive.unknownClient')}</p></div>
    <div className="space-y-3">
      {!data.history.entries.length && <p>{t('coManaged.archive.noHistory')}</p>}
      {data.history.entries.map(entry => <article key={entry.id} className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{t(`coManaged.archive.events.${entry.kind === 'ticket_handoff' ? entry.event : entry.kind}`)}</h3>
          <time dateTime={entry.occurredAt} className="text-sm text-muted-foreground">{formatDate(new Date(entry.occurredAt), { dateStyle: 'medium', timeStyle: 'short' })}</time></div>
        {entry.author && <p className="mt-1 text-sm">{entry.author.name || t('coManaged.archive.unknownAuthor')}{entry.author.organization ? ` · ${entry.author.organization}` : ''}</p>}
        {entry.deleted ? <p className="mt-2 italic text-muted-foreground">{t('coManaged.archive.deleted')}</p> :
          <p className="mt-2 whitespace-pre-wrap break-words">{conversationText(entry.note, entry.markdown)}</p>}
        {entry.changes && Object.keys(entry.changes).length > 0 && <ul className="mt-2 list-disc pl-5 text-sm">{Object.entries(entry.changes).map(([field, value]) =>
          <li key={field}>{t(`coManaged.archive.changes.${field}`)}{field === 'task_name' || field === 'due_date' ? `: ${value ?? t('coManaged.archive.cleared')}` : ''}</li>)}</ul>}
      </article>)}
      <div className="flex gap-2"><Button id="co-archive-history-previous" type="button" variant="ghost" disabled={historyPage === 0} onClick={() => pageHistory(historyPage - 1)}>{t('coManaged.provisioning.previous')}</Button>
        <Button id="co-archive-history-next" type="button" variant="ghost" disabled={data.history.nextPage === null} onClick={() => pageHistory(data.history.nextPage!)}>{t('coManaged.provisioning.next')}</Button></div>
    </div>
    <div className="space-y-3"><h3 className="font-semibold">{t('coManaged.archive.files')}</h3>
      {!data.files.items.length && <p className="text-sm text-muted-foreground">{t('coManaged.archive.noFiles')}</p>}
      <ul className="space-y-2">{data.files.items.map(file => <li key={file.archiveFileId}>
        <a id={`co-archive-file-${file.archiveFileId}`} className="break-words text-primary underline" href={`/api/co-management/archive-files/${file.archiveFileId}?${new URLSearchParams({ customerTenant: resource.tenant, relationshipId: resource.relationshipId, ticketId: resource.id })}`}>{file.fileName}</a>
        <span className="ml-2 text-sm text-muted-foreground">{t('coManaged.archive.bytes', { value: formatNumber(file.size) })}</span>
        {file.audience === 'organization_private' && <span className="ml-2 text-sm font-medium">{t('coManaged.archive.privateFile')}</span>}
      </li>)}</ul>
      <div className="flex gap-2"><Button id="co-archive-files-previous" type="button" variant="ghost" disabled={filePage === 0} onClick={() => pageFiles(filePage - 1)}>{t('coManaged.provisioning.previous')}</Button>
        <Button id="co-archive-files-next" type="button" variant="ghost" disabled={data.files.nextPage === null} onClick={() => pageFiles(data.files.nextPage!)}>{t('coManaged.provisioning.next')}</Button></div>
    </div>
  </section>;
}
