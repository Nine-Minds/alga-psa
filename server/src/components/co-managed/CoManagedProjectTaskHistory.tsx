'use client';

import { useEffect, useState } from 'react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { listCoManagedProjectTaskHistoryAction } from '@/lib/actions/coManagedProjectTaskActions';

type Entries = NonNullable<Awaited<ReturnType<typeof listCoManagedProjectTaskHistoryAction>>>;

const isChange = (value: unknown): value is { from?: unknown; to?: unknown; name?: unknown } => Boolean(value) && typeof value === 'object' && ('from' in (value as object) || 'to' in (value as object));

/** Change history of one shared task, newest first, with qualified authors ("Name (Organization)"). */
export default function CoManagedProjectTaskHistory({ customerTenant, relationshipId, taskId, reloadKey = 0, statusNames = {} }: {
  customerTenant: string; relationshipId: string; taskId: string; reloadKey?: number;
  /** Status display names by mapping id, so a status change reads as a name and never as an id. */
  statusNames?: Record<string, string>;
}) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  const [entries, setEntries] = useState<Entries | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    void listCoManagedProjectTaskHistoryAction(customerTenant, relationshipId, taskId).then(
      result => { if (live) { setEntries(result ?? []); setError(false); } }, () => { if (live) setError(true); });
    return () => { live = false; };
  }, [customerTenant, relationshipId, taskId, reloadKey]);

  const label = (field: string) => field === 'task_name' ? t('coManaged.sharedTasks.fieldName', { defaultValue: 'Name' })
    : field === 'project_status_mapping_id' ? t('coManaged.sharedTasks.fieldStatus', { defaultValue: 'Status' })
    : field === 'due_date' ? t('coManaged.sharedTasks.fieldDue', { defaultValue: 'Due date' })
    : field === 'msp_assignee' ? t('coManaged.sharedTasks.fieldAssignee', { defaultValue: 'Assignee' }) : field.replace(/_/g, ' ');
  const none = t('coManaged.sharedTasks.none', { defaultValue: 'none' });
  const show = (field: string, value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return none;
    if (field === 'project_status_mapping_id') return typeof value === 'string' ? statusNames[value] ?? null : null;
    if (field === 'due_date' && typeof value === 'string' && Number.isFinite(Date.parse(value))) return formatDate(new Date(value), { dateStyle: 'medium' });
    return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  };
  const describe = (field: string, change: unknown): string => {
    if (field === 'msp_assignee' && change && typeof change === 'object' && typeof (change as { name?: unknown }).name === 'string') return t('coManaged.sharedTasks.changeAssigned', { defaultValue: 'Assignee set to {{name}}', name: (change as { name: string }).name });
    if (!isChange(change)) return label(field);
    const from = show(field, change.from), to = show(field, change.to);
    return from !== null && to !== null ? t('coManaged.sharedTasks.changeFromTo', { defaultValue: '{{field}}: {{from}} → {{to}}', field: label(field), from, to })
      : t('coManaged.sharedTasks.changeUpdated', { defaultValue: '{{field}} updated', field: label(field) });
  };

  return <section id="co-managed-task-history" className="space-y-2">
    <h2 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">{t('coManaged.sharedTasks.history', { defaultValue: 'History' })}</h2>
    {error && <p id="co-managed-task-history-error">{t('coManaged.sharedTasks.historyError', { defaultValue: 'Could not load the history.' })}</p>}
    {entries && entries.length === 0 && <p id="co-managed-task-history-empty">{t('coManaged.sharedTasks.historyEmpty', { defaultValue: 'No changes have been made from Shared Tasks yet.' })}</p>}
    {entries && entries.length > 0 && <ul className="space-y-2">{entries.map(entry => <li key={entry.auditId} className="rounded border border-[rgb(var(--color-border-200))] p-2 text-sm">
      <div className="font-medium">{entry.authorName}{entry.organizationName ? ` (${entry.organizationName})` : ''}
        <span className="ml-2 font-normal text-[rgb(var(--color-text-500))]">{formatDate(new Date(entry.at), { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
      <ul>{Object.entries(entry.changes).map(([field, change]) => <li key={field}>{describe(field, change)}</li>)}</ul>
    </li>)}</ul>}
  </section>;
}
