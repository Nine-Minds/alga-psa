'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import { listCoManagedAssignedTasksAction, listCoManagedSharedProjectsAction } from '@/lib/actions/coManagedProjectTaskActions';

type TaskPage = NonNullable<Awaited<ReturnType<typeof listCoManagedAssignedTasksAction>>>;
type ProjectPage = NonNullable<Awaited<ReturnType<typeof listCoManagedSharedProjectsAction>>>;
type TaskRow = TaskPage['rows'][number];
type ProjectRow = ProjectPage['rows'][number];
type Assigned = 'me' | 'my_teams' | 'any';
const PAGE_SIZE = 25;
const part = encodeURIComponent;

/**
 * Shared Tasks: the tasks of customers' projects this technician (or their teams) works on, and the
 * projects customers have shared. Every row is re-admitted server-side on each load; names only.
 */
export default function CoManagedProjectTaskQueue() {
  const { t } = useTranslation('msp/licensing');
  const [assigned, setAssigned] = useState<Assigned>('me');
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [taskNext, setTaskNext] = useState<TaskPage['next']>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [projectNext, setProjectNext] = useState<ProjectPage['next']>(null);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  const loadTasks = useCallback((after?: TaskPage['next']) => {
    const current = ++generation.current;
    return listCoManagedAssignedTasksAction({ assigned, limit: PAGE_SIZE, ...(after ? { after } : {}) }).then(
      page => {
        if (generation.current !== current) return;
        setTasks(previous => [...(after && previous ? previous : []), ...(page?.rows ?? [])]);
        setTaskNext(page?.next ?? null); setError(false);
      },
      () => { if (generation.current === current) setError(true); });
  }, [assigned]);

  useEffect(() => { setTasks(null); void loadTasks(); return () => { generation.current += 1; }; }, [loadTasks]);
  useEffect(() => {
    let live = true;
    void listCoManagedSharedProjectsAction({ limit: PAGE_SIZE }).then(
      page => { if (live) { setProjects(page?.rows ?? []); setProjectNext(page?.next ?? null); } },
      () => { if (live) setError(true); });
    return () => { live = false; };
  }, []);
  const moreProjects = () => {
    if (!projectNext) return;
    void listCoManagedSharedProjectsAction({ limit: PAGE_SIZE, after: projectNext }).then(
      page => { setProjects(previous => [...(previous ?? []), ...(page?.rows ?? [])]); setProjectNext(page?.next ?? null); },
      () => setError(true));
  };

  const dash = (value: string) => value || '—';
  const taskColumns: ColumnDefinition<TaskRow>[] = [
    { title: t('coManaged.sharedTasks.task', { defaultValue: 'Task' }), dataIndex: 'taskName', sortable: false,
      render: (_v, row) => <Link id={`co-managed-task-${row.taskId}`} href={`/msp/co-management/tasks/${part(row.customerTenant)}/${part(row.relationshipId)}/${part(row.taskId)}`}
        className="font-semibold text-[rgb(var(--color-primary-700))] hover:underline">{dash(row.taskName)}</Link> },
    { title: t('coManaged.sharedTasks.project', { defaultValue: 'Project' }), dataIndex: 'projectName', sortable: false, render: (_v, row) => dash(row.projectName) },
    { title: t('coManaged.sharedTasks.organization', { defaultValue: 'Organization' }), dataIndex: 'organizationName', sortable: false, render: (_v, row) => dash(row.organizationName) },
    { title: t('coManaged.sharedTasks.assignee', { defaultValue: 'Assigned to' }), dataIndex: 'assigneeName', sortable: false,
      render: (_v, row) => row.assignedToMe ? t('coManaged.sharedTasks.you', { defaultValue: '{{name}} (you)', name: row.assigneeName }) : dash(row.assigneeName) },
  ];
  const projectColumns: ColumnDefinition<ProjectRow>[] = [
    { title: t('coManaged.sharedTasks.project', { defaultValue: 'Project' }), dataIndex: 'projectName', sortable: false,
      render: (_v, row) => <Link id={`co-managed-project-${row.projectId}`} href={`/msp/co-management/projects/${part(row.customerTenant)}/${part(row.relationshipId)}/${part(row.projectId)}`}
        className="font-semibold text-[rgb(var(--color-primary-700))] hover:underline">{dash(row.projectName)}</Link> },
    { title: t('coManaged.sharedTasks.organization', { defaultValue: 'Organization' }), dataIndex: 'organizationName', sortable: false, render: (_v, row) => dash(row.organizationName) },
    { title: t('coManaged.sharedTasks.access', { defaultValue: 'Access' }), dataIndex: 'canCollaborate', sortable: false,
      render: (_v, row) => row.canCollaborate ? t('coManaged.sharedTasks.collaborate', { defaultValue: 'Collaborate' }) : t('coManaged.sharedTasks.viewOnly', { defaultValue: 'View only' }) },
  ];
  const filterOptions = [
    { value: 'me', label: t('coManaged.sharedTasks.filterMe', { defaultValue: 'Assigned to me' }) },
    { value: 'my_teams', label: t('coManaged.sharedTasks.filterTeams', { defaultValue: 'Assigned to my teams' }) },
    { value: 'any', label: t('coManaged.sharedTasks.filterAny', { defaultValue: 'All shared tasks' }) },
  ];

  return <div id="co-managed-shared-tasks" className="min-w-0 space-y-6">
    <header>
      <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">{t('coManaged.sharedTasks.heading', { defaultValue: 'Shared Tasks' })}</h1>
      <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
        {t('coManaged.sharedTasks.description', { defaultValue: 'Tasks on projects your co-managed customers have shared with you.' })}</p>
    </header>
    {error && <Alert variant="destructive"><AlertDescription id="co-managed-shared-tasks-error">
      {t('coManaged.sharedTasks.loadError', { defaultValue: 'Could not load shared tasks.' })}</AlertDescription></Alert>}
    <section className="space-y-3">
      <div className="max-w-xs">
        <CustomSelect id="co-managed-shared-tasks-filter" label={t('coManaged.sharedTasks.filter', { defaultValue: 'Show' })} value={assigned}
          options={filterOptions} onValueChange={value => setAssigned(value as Assigned)} />
      </div>
      {!tasks && !error && <p role="status">{t('coManaged.loading')}</p>}
      {tasks && tasks.length === 0 && <p id="co-managed-shared-tasks-empty">{t('coManaged.sharedTasks.empty', { defaultValue: 'No shared tasks match right now.' })}</p>}
      {tasks && tasks.length > 0 && <DataTable id="co-managed-shared-tasks-table" data={tasks} columns={taskColumns} pagination={false} />}
      {taskNext && <Button id="co-managed-shared-tasks-more" variant="outline" size="sm" onClick={() => void loadTasks(taskNext)}>
        {t('coManaged.sharedTasks.loadMore', { defaultValue: 'Load more' })}</Button>}
    </section>
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-[rgb(var(--color-text-900))]">{t('coManaged.sharedTasks.projects', { defaultValue: 'Shared projects' })}</h2>
      {projects && projects.length === 0 && <p id="co-managed-shared-projects-empty">{t('coManaged.sharedTasks.noProjects', { defaultValue: 'No projects are shared with you right now.' })}</p>}
      {projects && projects.length > 0 && <DataTable id="co-managed-shared-projects-table" data={projects} columns={projectColumns} pagination={false} />}
      {projectNext && <Button id="co-managed-shared-projects-more" variant="outline" size="sm" onClick={moreProjects}>
        {t('coManaged.sharedTasks.loadMore', { defaultValue: 'Load more' })}</Button>}
    </section>
  </div>;
}
