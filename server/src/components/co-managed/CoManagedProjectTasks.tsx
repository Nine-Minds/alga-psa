'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import { listCoManagedSharedProjectTasksAction, searchCoManagedSharedProjectsAction } from '@/lib/actions/coManagedProjectTaskActions';

type TaskPage = NonNullable<Awaited<ReturnType<typeof listCoManagedSharedProjectTasksAction>>>;
type Row = TaskPage['rows'][number];
type Found = NonNullable<Awaited<ReturnType<typeof searchCoManagedSharedProjectsAction>>>;
const PAGE_SIZE = 50;
const part = encodeURIComponent;

/** One shared project: its tasks with their MSP assignees, and a search across the same relationship. */
export default function CoManagedProjectTasks({ customerTenant, relationshipId, projectId }: { customerTenant: string; relationshipId: string; projectId: string }) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [searched, setSearched] = useState(false);
  const generation = useRef(0);

  const load = useCallback((afterTaskId?: string) => {
    const current = ++generation.current;
    return listCoManagedSharedProjectTasksAction(customerTenant, relationshipId, projectId, { limit: PAGE_SIZE, ...(afterTaskId ? { afterTaskId } : {}) }).then(
      page => {
        if (generation.current !== current) return;
        setRows(previous => [...(afterTaskId && previous ? previous : []), ...(page?.rows ?? [])]);
        setNext(page?.nextAfterTaskId ?? null); setError(false);
      },
      () => { if (generation.current === current) setError(true); });
  }, [customerTenant, relationshipId, projectId]);
  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) { setFound(null); setSearched(false); return; }
    void searchCoManagedSharedProjectsAction(relationshipId, { query: query.trim(), limit: 20 }).then(
      result => { setFound(result); setSearched(true); }, () => setError(true));
  };

  const columns: ColumnDefinition<Row>[] = [
    { title: t('coManaged.sharedTasks.task', { defaultValue: 'Task' }), dataIndex: 'taskName', sortable: false,
      render: (_v, row) => <Link id={`co-managed-project-task-${row.taskId}`} href={`/msp/co-management/tasks/${part(customerTenant)}/${part(relationshipId)}/${part(row.taskId)}`}
        className="font-semibold text-[rgb(var(--color-primary-700))] hover:underline">{row.taskName || '—'}</Link> },
    { title: t('coManaged.sharedTasks.due', { defaultValue: 'Due' }), dataIndex: 'dueDate', sortable: false,
      render: (_v, row) => row.dueDate ? formatDate(new Date(row.dueDate), { dateStyle: 'medium' }) : '—' },
    { title: t('coManaged.sharedTasks.assignee', { defaultValue: 'Assigned to' }), dataIndex: 'reference', sortable: false,
      render: (_v, row) => row.reference ? row.reference.assigneeName || '—' : t('coManaged.sharedTasks.unassigned', { defaultValue: 'Not assigned' }) },
  ];

  return <div id="co-managed-project-tasks" className="min-w-0 space-y-4">
    <header>
      <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">{t('coManaged.sharedTasks.projectHeading', { defaultValue: 'Shared project tasks' })}</h1>
      <Link id="co-managed-project-tasks-back" href="/msp/co-management/tasks" className="text-sm text-[rgb(var(--color-primary-700))] hover:underline">
        {t('coManaged.sharedTasks.back', { defaultValue: 'Back to Shared Tasks' })}</Link>
    </header>
    {error && <Alert variant="destructive"><AlertDescription id="co-managed-project-tasks-error">
      {t('coManaged.sharedTasks.loadError', { defaultValue: 'Could not load shared tasks.' })}</AlertDescription></Alert>}
    <form onSubmit={search} className="flex items-end gap-2">
      <Input id="co-managed-project-search-input" aria-label={t('coManaged.sharedTasks.search', { defaultValue: 'Search shared projects' })}
        placeholder={t('coManaged.sharedTasks.search', { defaultValue: 'Search shared projects' })} value={query} onChange={event => setQuery(event.target.value)} />
      <Button id="co-managed-project-search-submit" type="submit" variant="outline" size="sm">{t('coManaged.sharedTasks.searchSubmit', { defaultValue: 'Search' })}</Button>
    </form>
    {searched && found && <section id="co-managed-project-search-results" className="space-y-2">
      <p className="text-sm text-[rgb(var(--color-text-500))]">{t('coManaged.sharedTasks.resultCount', { defaultValue: '{{count}} results', count: found.totalCount })}</p>
      {found.typeahead.length > 0 && <p className="text-sm">{t('coManaged.sharedTasks.suggestions', { defaultValue: 'Suggestions:' })}{' '}
        {found.typeahead.map((hit, index) => <span key={`${hit.type}-${hit.id}`} className="mr-2 font-medium">{hit.title}{index < found.typeahead.length - 1 ? ',' : ''}</span>)}</p>}
      {found.results.length === 0 ? <p id="co-managed-project-search-empty">{t('coManaged.sharedTasks.noResults', { defaultValue: 'Nothing matched your search.' })}</p>
        : <ul className="space-y-1">{found.results.map(hit => <li key={`${hit.type}-${hit.id}`}>
          <Link href={hit.url} className="text-[rgb(var(--color-primary-700))] hover:underline">{hit.title}</Link>
          {hit.subtitle && <span className="ml-2 text-sm text-[rgb(var(--color-text-500))]">{hit.subtitle}</span>}</li>)}</ul>}
    </section>}
    {!rows && !error && <p role="status">{t('coManaged.loading')}</p>}
    {rows && rows.length === 0 && <p id="co-managed-project-tasks-empty">{t('coManaged.sharedTasks.noTasks', { defaultValue: 'This project has no tasks you can see.' })}</p>}
    {rows && rows.length > 0 && <DataTable id="co-managed-project-tasks-table" data={rows} columns={columns} pagination={false} />}
    {next && <Button id="co-managed-project-tasks-more" variant="outline" size="sm" onClick={() => void load(next)}>
      {t('coManaged.sharedTasks.loadMore', { defaultValue: 'Load more' })}</Button>}
  </div>;
}
