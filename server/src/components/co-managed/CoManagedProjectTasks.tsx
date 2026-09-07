'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { listSharedProjectTasksAction } from '@/lib/actions/coManagedProjectTaskActions';

export default function CoManagedProjectTasks({ resource }: { resource: CoManagedSharedResource }) {
  return <ProjectTasks key={JSON.stringify(resource)} resource={resource} />;
}
function ProjectTasks({ resource }: { resource: CoManagedSharedResource }) {
  const { t } = useTranslation('msp/licensing'), { formatDate } = useFormatters();
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState<Awaited<ReturnType<typeof listSharedProjectTasksAction>> | null>(null);
  const [error, setError] = useState(false), [refresh, setRefresh] = useState(0);
  const cursor = cursors.at(-1);
  useEffect(() => {
    let active = true; setPage(null); setError(false);
    void listSharedProjectTasksAction(resource, cursor).then(result => { if (active) setPage(result); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [resource, cursor, refresh]);
  return <section className="space-y-5">
    <div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-semibold">{t('coManaged.projects.tasks')}</h1>
      <Button id="co-project-tasks-reload" variant="outline" onClick={() => { setPage(null); setRefresh(value => value + 1); }}>{t('coManaged.policy.reload')}</Button></div>
    {error ? <p role="alert" className="text-destructive">{t('coManaged.projects.loadError')}</p> : !page ? <p role="status">{t('coManaged.loading')}</p> : <>
      {!page.items.length ? <p className="text-muted-foreground">{t('coManaged.projects.empty')}</p> : <ul className="divide-y rounded-lg border border-[rgb(var(--color-border-200))]">
        {page.items.map(item => <li key={`${item.resource.tenant}:${item.resource.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <Link id={`co-project-task-open-${item.resource.id}`} className="font-medium text-primary hover:underline"
            href={`/msp/co-management/tasks/${item.resource.tenant}/${item.resource.relationshipId}/${item.resource.id}`}>
            {item.values.task_name ?? t('coManaged.projects.task')}</Link>
          <span className="text-sm text-muted-foreground">{[item.organizationName, item.projectName, item.phaseName].filter(Boolean).join(' · ')}</span>
          <div className="flex gap-4 text-sm text-muted-foreground">{item.selectedStatus && <span>{item.selectedStatus.name}</span>}
            {item.values.due_date && <span>{t('coManaged.projects.due', { date: formatDate(new Date(item.values.due_date)) })}</span>}</div>
        </li>)}
      </ul>}
      <div className="flex gap-2"><Button id="co-project-tasks-previous" variant="ghost" disabled={cursors.length === 1} onClick={() => setCursors(value => value.slice(0, -1))}>{t('coManaged.provisioning.previous')}</Button>
        <Button id="co-project-tasks-next" variant="ghost" disabled={!page.nextAfterId} onClick={() => setCursors(value => [...value, page.nextAfterId!])}>{t('coManaged.provisioning.next')}</Button></div>
    </>}
  </section>;
}
