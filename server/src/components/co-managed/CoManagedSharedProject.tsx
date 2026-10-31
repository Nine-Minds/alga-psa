'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import Link from 'next/link';
import type { IProjectTask } from '@alga-psa/types';
import ProjectPage from '@alga-psa/projects/components/ProjectPage';
import { ProjectDataSourceProvider } from '@alga-psa/projects/context/ProjectDataSourceContext';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  editCoManagedProjectTaskAction, getCoManagedProjectTaskSnapshotAction, getCoManagedSharedProjectScreenAction,
} from '@/lib/actions/coManagedProjectTaskActions';
import { loadCoManagedSharedProjectDataSource, type LoadedCoManagedSharedProjectDataSource } from '@/lib/co-managed/sharedProjectDataSource';
import { newCoManagedOperationId } from './coManagedOperationId';
import CoManagedProjectTaskAssignment from './CoManagedProjectTaskAssignment';
import CoManagedProjectTaskHistory from './CoManagedProjectTaskHistory';

const BACK_HREF = '/msp/co-management/tasks';

/** Assignment and history for the drawer's task. Re-renders when the data source reports a refresh or an edit receipt. */
function TaskAside({ handle, task, customerTenant, relationshipId, userId }: {
  handle: LoadedCoManagedSharedProjectDataSource; task: IProjectTask; customerTenant: string; relationshipId: string; userId: string;
}) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [historyKey, bumpHistory] = useReducer((n: number) => n + 1, 0);
  useEffect(() => handle.subscribe(() => { rerender(); bumpHistory(); }), [handle]);
  const baseline = handle.baselineOf(task.task_id);
  return <div id="co-managed-task-aside" className="space-y-6">
    <CoManagedProjectTaskAssignment customerTenant={customerTenant} relationshipId={relationshipId} taskId={task.task_id} userId={userId}
      revision={baseline?.revision ?? null} assigneeName={baseline?.assigneeName ?? null} isAssigned={baseline?.isAssigned ?? false}
      onChanged={() => { void handle.refresh(); }} />
    <CoManagedProjectTaskHistory customerTenant={customerTenant} relationshipId={relationshipId} taskId={task.task_id} reloadKey={historyKey} statusNames={handle.statusNames()} />
  </div>;
}

/**
 * The native project screen over a customer's shared project. The screen is not forked: an app-layer data source
 * (see sharedProjectDataSource) is injected through the provider, so every read is answered from the authorized shared
 * read and every write is either the admitted task edit or a loud failure.
 */
export default function CoManagedSharedProject({ customerTenant, relationshipId, projectId, userId }: {
  customerTenant: string; relationshipId: string; projectId: string; userId: string;
}) {
  const { t } = useTranslation('msp/licensing');
  const [state, setState] = useState<{ status: 'loading' } | { status: 'missing' } | { status: 'ready'; handle: LoadedCoManagedSharedProjectDataSource }>({ status: 'loading' });
  const handleRef = useRef<LoadedCoManagedSharedProjectDataSource | null>(null);

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    loadCoManagedSharedProjectDataSource({
      customerTenant, relationshipId, projectId, backHref: BACK_HREF,
      load: async () => (await getCoManagedSharedProjectScreenAction(customerTenant, relationshipId, projectId)) ?? null,
      edit: (taskId, request) => editCoManagedProjectTaskAction(customerTenant, relationshipId, taskId, request),
      snapshot: taskId => getCoManagedProjectTaskSnapshotAction(customerTenant, relationshipId, taskId).then(result => result ?? null),
      newOperationId: newCoManagedOperationId,
      slots: { taskAside: task => handleRef.current
        ? <TaskAside handle={handleRef.current} task={task} customerTenant={customerTenant} relationshipId={relationshipId} userId={userId} /> : null },
    }).then(
      handle => { if (!live) return; handleRef.current = handle; setState(handle ? { status: 'ready', handle } : { status: 'missing' }); },
      () => { if (live) setState({ status: 'missing' }); },
    );
    return () => { live = false; };
  }, [customerTenant, relationshipId, projectId, userId]);

  // The params promise is created once per bound project so ProjectPage's load effect does not restart.
  const paramsRef = useRef<{ projectId: string; params: Promise<{ id: string }> } | null>(null);
  if (!paramsRef.current || paramsRef.current.projectId !== projectId) paramsRef.current = { projectId, params: Promise.resolve({ id: projectId }) };

  if (state.status === 'loading') return <p id="co-managed-shared-project-loading" role="status" className="p-6 text-sm">{t('coManaged.loading')}</p>;
  if (state.status === 'missing') {
    return <div id="co-managed-shared-project-missing" className="min-w-0 space-y-3 p-6">
      <Alert variant="destructive"><AlertDescription>
        {t('coManaged.sharedTasks.projectNotFound', { defaultValue: 'This project is not available. It may no longer be shared with you.' })}</AlertDescription></Alert>
      <Link id="co-managed-shared-project-back" href={BACK_HREF} className="text-sm text-[rgb(var(--color-primary-700))] hover:underline">
        {t('coManaged.sharedTasks.back', { defaultValue: 'Back to Shared Tasks' })}</Link>
    </div>;
  }
  return <div id="co-managed-shared-project">
    <ProjectDataSourceProvider dataSource={state.handle.source}>
      <ProjectPage params={paramsRef.current.params} />
    </ProjectDataSourceProvider>
  </div>;
}
