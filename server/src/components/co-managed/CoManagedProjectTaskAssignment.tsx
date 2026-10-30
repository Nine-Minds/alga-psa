'use client';

import { useRef, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { assignCoManagedProjectTaskAction } from '@/lib/actions/coManagedProjectTaskActions';
import { newCoManagedOperationId } from './coManagedOperationId';

/**
 * MSP-side assignment. The assignee lives on the MSP's own reference row, never on the customer's task.
 * `revision` is null until a reference exists; assigning to oneself is what creates it.
 */
export default function CoManagedProjectTaskAssignment({ customerTenant, relationshipId, taskId, userId, revision, assigneeName, onChanged }: {
  customerTenant: string; relationshipId: string; taskId: string; userId: string;
  revision: number | null; assigneeName?: string | null; onChanged?: (assigneeName?: string) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [name, setName] = useState<string | null>(assigneeName ?? null);
  const shown = name ?? assigneeName ?? null;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<'conflict' | 'failed' | null>(null);
  // One attempt keeps one operation id: a retry after a lost response replays the original outcome.
  const attempt = useRef<{ operationId: string; revision: number | null } | null>(null);

  const assign = async () => {
    if (!attempt.current || attempt.current.revision !== revision) attempt.current = { operationId: newCoManagedOperationId(), revision };
    const { operationId } = attempt.current;
    setBusy(true); setFailure(null);
    try {
      const result = await assignCoManagedProjectTaskAction(customerTenant, relationshipId, taskId, { operationId, expectedRevision: revision, assignee: { kind: 'user', id: userId } });
      attempt.current = null;
      if (result.success) { setName(result.receipt.assigneeName); onChanged?.(result.receipt.assigneeName); }
      else if (result.error === 'CONFLICT') { setFailure('conflict'); onChanged?.(); }
      else setFailure('failed');
    } catch { setFailure('failed'); } finally { setBusy(false); }
  };

  return <section id="co-managed-task-assignment" className="space-y-2">
    <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">{t('coManaged.sharedTasks.assignment', { defaultValue: 'Assignment' })}</h2>
    <p id="co-managed-task-assignee">{shown
      ? t('coManaged.sharedTasks.assignedTo', { defaultValue: 'Assigned to {{name}}', name: shown })
      : t('coManaged.sharedTasks.unassigned', { defaultValue: 'Not assigned' })}</p>
    {failure === 'conflict' && <Alert variant="destructive"><AlertDescription id="co-managed-task-assignment-conflict">
      {t('coManaged.sharedTasks.assignConflict', { defaultValue: 'This task was assigned or changed by someone else. It has been reloaded; try again if you still need to.' })}</AlertDescription></Alert>}
    {failure === 'failed' && <Alert variant="destructive"><AlertDescription id="co-managed-task-assignment-error">
      {t('coManaged.sharedTasks.assignFailed', { defaultValue: 'This task could not be assigned.' })}</AlertDescription></Alert>}
    <Button id="co-managed-task-assign-me" size="sm" disabled={busy} onClick={() => void assign()}>
      {t('coManaged.sharedTasks.assignMe', { defaultValue: 'Assign to me' })}</Button>
  </section>;
}
