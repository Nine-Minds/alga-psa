'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  editCoManagedProjectTaskAction, getCoManagedProjectTaskSnapshotAction, listCoManagedProjectTaskStatusOptionsAction,
} from '@/lib/actions/coManagedProjectTaskActions';
import { newCoManagedOperationId } from './coManagedOperationId';
import CoManagedProjectTaskAssignment from './CoManagedProjectTaskAssignment';
import CoManagedProjectTaskHistory from './CoManagedProjectTaskHistory';

type Snapshot = NonNullable<Awaited<ReturnType<typeof getCoManagedProjectTaskSnapshotAction>>>;
type Patch = Snapshot['values'];
type Status = 'idle' | 'saving' | 'saved' | 'conflict' | 'rejected';

/**
 * A shared task as a co-managed technician edits it: name, status and due date, guarded by the revision and
 * the task's updated-at token loaded here. A task is editable only once the MSP holds a reference to it
 * (assigning it creates one); without one the loader answers "not found" and this explains how to start.
 */
export default function CoManagedProjectTaskEditor({ customerTenant, relationshipId, taskId, userId }: {
  customerTenant: string; relationshipId: string; taskId: string; userId: string;
}) {
  const { t } = useTranslation('msp/licensing');
  const [loaded, setLoaded] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [statuses, setStatuses] = useState<Array<{ statusMappingId: string; name: string }>>([]);
  const [name, setName] = useState('');
  const [statusId, setStatusId] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [assigned, setAssigned] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const attempt = useRef<{ operationId: string; signature: string } | null>(null);

  const apply = useCallback((next: Snapshot) => {
    setSnapshot(next); setName(next.values.task_name ?? ''); setStatusId(next.values.project_status_mapping_id ?? ''); setDue(next.values.due_date ?? null);
  }, []);
  const reload = useCallback(async () => {
    try {
      const next = await getCoManagedProjectTaskSnapshotAction(customerTenant, relationshipId, taskId);
      if (next) apply(next); else setSnapshot(null);
      if (next) setStatuses((await listCoManagedProjectTaskStatusOptionsAction(customerTenant, relationshipId, taskId)) ?? []);
    } catch { setSnapshot(null); }
    setLoaded(true); setHistoryKey(key => key + 1);
  }, [customerTenant, relationshipId, taskId, apply]);
  useEffect(() => { void reload(); }, [reload]);

  const patch: Patch = {};
  if (snapshot) {
    if (name !== (snapshot.values.task_name ?? '')) patch.task_name = name;
    if (statusId && statusId !== (snapshot.values.project_status_mapping_id ?? '')) patch.project_status_mapping_id = statusId;
    if ((due ?? null) !== (snapshot.values.due_date ?? null)) patch.due_date = due;
  }
  const dirty = Object.keys(patch).length > 0;

  const save = async () => {
    if (!snapshot || !dirty) return;
    const signature = JSON.stringify([snapshot.revision, snapshot.taskUpdatedAt, patch]);
    if (!attempt.current || attempt.current.signature !== signature) attempt.current = { operationId: newCoManagedOperationId(), signature };
    setStatus('saving');
    try {
      const result = await editCoManagedProjectTaskAction(customerTenant, relationshipId, taskId, {
        operationId: attempt.current.operationId, expectedRevision: snapshot.revision, expectedTaskUpdatedAt: snapshot.taskUpdatedAt, patch });
      attempt.current = null;
      if (result.success) {
        const next = { revision: result.receipt.revision, taskUpdatedAt: result.receipt.taskUpdatedAt, values: { ...snapshot.values, ...patch }, assignee: snapshot.assignee };
        setSnapshot(next); setStatus('saved'); setHistoryKey(key => key + 1);
      } else setStatus(result.error === 'CONFLICT' ? 'conflict' : 'rejected');
      if (!result.success && result.error === 'CONFLICT') conflictSnapshot.current = result.snapshot;
    } catch { setStatus('rejected'); }
  };
  const conflictSnapshot = useRef<Snapshot | undefined>(undefined);
  const reloadLatest = async () => {
    const fresh = conflictSnapshot.current;
    conflictSnapshot.current = undefined;
    if (fresh) { apply(fresh); setHistoryKey(key => key + 1); } else await reload();
    setStatus('idle');
  };

  const assignment = <CoManagedProjectTaskAssignment customerTenant={customerTenant} relationshipId={relationshipId} taskId={taskId} userId={userId}
    revision={snapshot?.revision ?? null} assigneeName={assigned ?? snapshot?.assignee?.name ?? null}
    onChanged={name => { if (name) setAssigned(name); void reload(); }} />;
  const statusNames = Object.fromEntries(statuses.map(option => [option.statusMappingId, option.name]));

  return <div id="co-managed-task-editor" className="min-w-0 space-y-6">
    <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">{t('coManaged.sharedTasks.taskHeading', { defaultValue: 'Shared task' })}</h1>
    {!loaded && <p role="status">{t('coManaged.loading')}</p>}
    {loaded && !snapshot && <>
      <Alert><AlertDescription id="co-managed-task-no-reference">
        {t('coManaged.sharedTasks.noReference', { defaultValue: 'You can edit this task once it is assigned to you or your team. If you cannot assign it, it is not available to you.' })}</AlertDescription></Alert>
      {assignment}
    </>}
    {snapshot && <>
      <section className="space-y-3">
        <Input id="co-managed-task-name" label={t('coManaged.sharedTasks.fieldName', { defaultValue: 'Name' })} value={name} onChange={event => setName(event.target.value)}
          disabled={snapshot.values.task_name === undefined || status === 'saving'} />
        {snapshot.values.project_status_mapping_id !== undefined && <CustomSelect id="co-managed-task-status" label={t('coManaged.sharedTasks.fieldStatus', { defaultValue: 'Status' })}
          value={statusId} options={statuses.map(option => ({ value: option.statusMappingId, label: option.name }))} onValueChange={setStatusId} disabled={status === 'saving'} />}
        {snapshot.values.due_date !== undefined && <DatePicker id="co-managed-task-due" label={t('coManaged.sharedTasks.fieldDue', { defaultValue: 'Due date' })}
          value={due ? new Date(due) : undefined} onChange={date => setDue(date ? date.toISOString() : null)} clearable disabled={status === 'saving'} />}
        {status === 'conflict' && <Alert variant="destructive"><AlertDescription id="co-managed-task-conflict">
          <p>{t('coManaged.sharedTasks.conflict', { defaultValue: 'This task changed since you opened it, so your edit was not saved.' })}</p>
          <Button id="co-managed-task-reload" variant="outline" size="sm" className="mt-2" onClick={() => void reloadLatest()}>
            {t('coManaged.sharedTasks.reloadLatest', { defaultValue: 'Reload latest' })}</Button></AlertDescription></Alert>}
        {status === 'rejected' && <Alert variant="destructive"><AlertDescription id="co-managed-task-rejected">
          {t('coManaged.sharedTasks.rejected', { defaultValue: 'This task could not be saved.' })}</AlertDescription></Alert>}
        {status === 'saved' && <p id="co-managed-task-saved" role="status">{t('coManaged.sharedTasks.saved', { defaultValue: 'Saved.' })}</p>}
        <Button id="co-managed-task-save" disabled={!dirty || status === 'saving' || status === 'conflict'} onClick={() => void save()}>
          {t('coManaged.sharedTasks.save', { defaultValue: 'Save' })}</Button>
      </section>
      {assignment}
    </>}
    {loaded && <CoManagedProjectTaskHistory customerTenant={customerTenant} relationshipId={relationshipId} taskId={taskId} reloadKey={historyKey} statusNames={statusNames} />}
  </div>;
}
