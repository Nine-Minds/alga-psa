'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CoManagedTaskQueuePage, CoManagedTaskQueueRequest } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { getSharedProjectTaskQueueAction } from '@/lib/actions/coManagedProjectTaskActions';

export default function CoManagedProjectTaskQueue() {
  const { t } = useTranslation('msp/licensing'), { formatDate } = useFormatters();
  const [request, setRequest] = useState<CoManagedTaskQueueRequest>({ view: 'working', state: 'open', assignment: 'all', sort: 'updated', direction: 'desc', page: 1, pageSize: 25 });
  const [search, setSearch] = useState(''), [result, setResult] = useState<CoManagedTaskQueuePage | null>(null);
  const [error, setError] = useState(false), [refresh, setRefresh] = useState(0), [canOversight, setCanOversight] = useState(false);
  useEffect(() => {
    // LEVERAGE: pattern qualified-queue-request-lifetime — ticket/task filters must discard older requests and clear stale rows/counts.
    let active = true; setResult(null); setError(false);
    void getSharedProjectTaskQueueAction(request).then(page => { if (active) { setResult(page); setCanOversight(page.canOversight); } }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [request, refresh]);
  const change = (patch: Partial<CoManagedTaskQueueRequest>) => setRequest(value => ({ ...value, ...patch, page: 1 }));
  const unknown = t('coManaged.ticket.restricted');
  return <div className="mx-auto max-w-7xl space-y-5 p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">{t('coManaged.projects.queue.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t(`coManaged.projects.queue.${canOversight ? request.view : 'customer'}Description`)}</p></div>
      <Button id="co-task-queue-refresh" variant="outline" onClick={() => setRefresh(value => value + 1)}>{t('coManaged.provisioning.refresh')}</Button></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {canOversight && <CustomSelect id="co-task-queue-view" label={t('coManaged.queue.view')} value={request.view}
        options={['working', 'oversight'].map(value => ({ value, label: t(`coManaged.queue.${value}`) }))} onValueChange={value => change({ view: value as 'working' | 'oversight', workspaceTenant: undefined })} />}
      <CustomSelect id="co-task-queue-workspace" label={t('coManaged.queue.workspace')} value={request.workspaceTenant ?? 'all'} disabled={!result}
        options={[{ value: 'all', label: t('coManaged.queue.allWorkspaces') }, ...(result?.workspaces ?? []).map(value => ({ value: value.tenant, label: value.name }))]}
        onValueChange={value => change({ workspaceTenant: value === 'all' ? undefined : value })} />
      <CustomSelect id="co-task-queue-assignment" label={t('coManaged.projects.queue.assignment')} value={request.assignment!}
        options={['all', 'mine', 'my_teams'].map(value => ({ value, label: t(`coManaged.projects.queue.${value}`) }))} onValueChange={value => change({ assignment: value as CoManagedTaskQueueRequest['assignment'] })} />
      <CustomSelect id="co-task-queue-state" label={t('coManaged.queue.state')} value={request.state!}
        options={['open', 'closed', 'all'].map(value => ({ value, label: t(`coManaged.queue.${value}`) }))} onValueChange={value => change({ state: value as CoManagedTaskQueueRequest['state'] })} />
      <CustomSelect id="co-task-queue-sort" label={t('coManaged.queue.sort')} value={request.sort!}
        options={['updated', 'due', 'name', 'project'].map(value => ({ value, label: t(`coManaged.projects.queue.sort.${value}`) }))} onValueChange={value => change({ sort: value as CoManagedTaskQueueRequest['sort'] })} />
      <CustomSelect id="co-task-queue-direction" label={t('coManaged.queue.direction')} value={request.direction!}
        options={['asc', 'desc'].map(value => ({ value, label: t(`coManaged.queue.${value}`) }))} onValueChange={value => change({ direction: value as 'asc' | 'desc' })} />
    </div>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); change({ search }); }}>
      <div className="min-w-64 flex-1"><Label htmlFor="co-task-queue-search">{t('coManaged.queue.search')}</Label><Input id="co-task-queue-search" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} /></div>
      <Button id="co-task-queue-search-submit" type="submit">{t('coManaged.queue.search')}</Button>
    </form>
    {error ? <p role="alert" className="text-destructive">{t('coManaged.projects.queue.loadError')}</p> : !result ? <p role="status">{t('coManaged.loading')}</p> : <>
      <p role="status" className="text-sm text-muted-foreground">{t('coManaged.projects.queue.counts', { total: result.totalCount, open: result.openCount, closed: result.closedCount })}</p>
      {!result.items.length ? <p>{t('coManaged.projects.queue.empty')}</p> : <div className="overflow-x-auto rounded-lg border border-[rgb(var(--color-border-200))]">
        <Table><TableHeader><TableRow>{['task', 'project', 'workspace', 'state', 'assignee', 'due'].map(field => <TableHead key={field}>{t(`coManaged.projects.queue.columns.${field}`)}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{result.items.map((item, index) => {
            const href = item.relationshipId ? `/msp/co-management/tasks/${item.tenant}/${item.relationshipId}/${item.taskId}` : item.projectId ? `/msp/projects/${item.projectId}/tasks/${item.taskId}` : null;
            return <TableRow key={`${item.tenant}:${item.relationshipId ?? 'native'}:${item.taskId}`}>
              <TableCell>{href ? <Link id={`co-task-queue-open-${index}`} className="text-primary underline" href={href}>{item.fields.task_name ?? unknown}</Link> : item.fields.task_name ?? unknown}</TableCell>
              <TableCell>{[item.fields.project_name, item.fields.phase_name].filter(Boolean).join(' · ') || unknown}</TableCell>
              <TableCell>{item.workspaceName ?? unknown}</TableCell><TableCell>{item.fields.status_name ?? unknown}</TableCell><TableCell>{item.fields.assignee_name ?? unknown}</TableCell>
              <TableCell>{item.fields.due_date ? formatDate(new Date(item.fields.due_date)) : unknown}</TableCell>
            </TableRow>;
          })}</TableBody></Table>
      </div>}
      <div className="flex items-center justify-between gap-3"><Button id="co-task-queue-previous" variant="outline" disabled={result.page <= 1} onClick={() => setRequest(value => ({ ...value, page: result.page - 1 }))}>{t('coManaged.provisioning.previous')}</Button>
        <p>{t('coManaged.queue.page', { page: result.page })}</p><Button id="co-task-queue-next" variant="outline" disabled={result.page * result.pageSize >= result.totalCount}
          onClick={() => setRequest(value => ({ ...value, page: result.page + 1 }))}>{t('coManaged.provisioning.next')}</Button></div>
    </>}
  </div>;
}
