'use client';
import { useEffect, useState } from 'react';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { listSharedProjectTaskHistoryAction } from '@/lib/actions/coManagedProjectTaskActions';

export default function CoManagedProjectTaskHistory({ resource, onUnavailable }: { resource: CoManagedSharedResource; onUnavailable: () => void }) {
  return <TaskHistory key={JSON.stringify(resource)} resource={resource} onUnavailable={onUnavailable} />;
}
function TaskHistory({ resource, onUnavailable }: { resource: CoManagedSharedResource; onUnavailable: () => void }) {
  const { t } = useTranslation('msp/licensing'), { formatDate } = useFormatters();
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState<Awaited<ReturnType<typeof listSharedProjectTaskHistoryAction>> | null>(null);
  const [refresh, setRefresh] = useState(0);
  const beforeId = cursors.at(-1);
  useEffect(() => {
    let active = true; setPage(null);
    void listSharedProjectTaskHistoryAction(resource, beforeId).then(result => { if (active) setPage(result); })
      .catch(() => { if (active) onUnavailable(); });
    return () => { active = false; };
  }, [resource, beforeId, refresh, onUnavailable]);
  const labels = { task_name: 'coManaged.projects.name', due_date: 'coManaged.editor.fields.due_date', project_status_mapping_id: 'coManaged.editor.fields.status_id' };
  return <section aria-labelledby="co-project-task-history-title" className="space-y-3 border-t border-[rgb(var(--color-border-200))] pt-5">
    <div className="flex items-center justify-between gap-4"><h2 id="co-project-task-history-title" className="text-lg font-semibold">{t('coManaged.projects.history.title')}</h2>
      <Button id="co-project-task-history-reload" variant="ghost" onClick={() => { setPage(null); setCursors([undefined]); setRefresh(value => value + 1); }}>{t('coManaged.policy.reload')}</Button></div>
    {!page ? <p role="status">{t('coManaged.loading')}</p> : <>
      {!page.items.length ? <p className="text-muted-foreground">{t('coManaged.projects.history.empty')}</p> : <ol className="divide-y divide-[rgb(var(--color-border-200))]">
        {page.items.map(entry => <li key={entry.id} className="space-y-2 py-3">
          <div className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
            {entry.author && <span>{[entry.author.displayName, entry.author.organizationName].filter(Boolean).join(' · ')}</span>}
            {entry.occurredAt && <time dateTime={entry.occurredAt}>{formatDate(new Date(entry.occurredAt), { dateStyle: 'medium', timeStyle: 'short' })}</time>}
          </div>
          <dl className="space-y-1 text-sm">{entry.changes.map(change => <div key={change.field} className="flex flex-wrap gap-x-2">
            <dt className="font-medium">{t(labels[change.field])}</dt>
            <dd className="break-words">{change.field === 'project_status_mapping_id' ? (change.statusName ?? t('coManaged.projects.history.updated')) :
              change.value === null ? t('coManaged.projects.history.cleared') : change.field === 'due_date' ? formatDate(new Date(change.value), { dateStyle: 'medium', timeStyle: 'short' }) : change.value}</dd>
          </div>)}</dl>
        </li>)}
      </ol>}
      <div className="flex gap-2"><Button id="co-project-task-history-newer" variant="ghost" disabled={cursors.length === 1} onClick={() => { setPage(null); setCursors(value => value.slice(0, -1)); }}>{t('coManaged.provisioning.previous')}</Button>
        <Button id="co-project-task-history-older" variant="ghost" disabled={!page.nextBeforeId} onClick={() => { setPage(null); setCursors(value => [...value, page.nextBeforeId!]); }}>{t('coManaged.provisioning.next')}</Button></div>
    </>}
  </section>;
}
