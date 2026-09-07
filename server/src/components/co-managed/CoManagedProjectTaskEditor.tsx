'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoManagedSharedResource, CoManagedTaskEditorState, CoManagedTaskEditPatch, CoManagedTaskEditRequest } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getSharedProjectTaskEditorAction, getSharedProjectTaskStatusesAction, editSharedProjectTaskAction } from '@/lib/actions/coManagedProjectTaskActions';

import CoManagedProjectTaskAssignment from './CoManagedProjectTaskAssignment';
import CoManagedProjectTaskConversation from './CoManagedProjectTaskConversation';
import CoManagedProjectTaskHistory from './CoManagedProjectTaskHistory';

function localTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export default function CoManagedProjectTaskEditor({ resource }: { resource: CoManagedSharedResource }) {
  return <TaskEditor key={JSON.stringify(resource)} resource={resource} />;
}
function TaskEditor({ resource }: { resource: CoManagedSharedResource }) {
  const { t } = useTranslation('msp/licensing');
  const [state, setState] = useState<CoManagedTaskEditorState | null>(null), [draft, setDraft] = useState<CoManagedTaskEditPatch>({});
  const [choices, setChoices] = useState<{ id: string; name: string }[]>([]), [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0), [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<CoManagedTaskEditRequest | null>(null);
  const generation = useRef(0);
  const [collaborationRefresh, setCollaborationRefresh] = useState(0);
  const assignmentChanged = useCallback(() => setCollaborationRefresh(value => value + 1), []);
  const historyUnavailable = useCallback(() => { setState(null); setError('loadError'); }, []);
  useEffect(() => {
    const current = ++generation.current; setState(null); setChoices([]); setError(null); setNext(null);
    void getSharedProjectTaskEditorAction(resource).then(async result => {
      if (generation.current !== current) return;
      setState(result); setDraft(result.values);
      if (result.selectedStatus) setChoices([result.selectedStatus]);
      if (result.editableFields.includes('project_status_mapping_id')) {
        const page = await getSharedProjectTaskStatusesAction(resource);
        if (generation.current === current) { setChoices(previous => [...new Map([...previous, ...page.options].map(option => [option.id, option])).values()]); setNext(page.nextAfterId); }
      }
    }).catch(() => { if (generation.current === current) { setState(null); setError('loadError'); } });
    return () => { generation.current++; };
  }, [resource, refresh]);
  async function more() {
    if (!next || busy) return; const current = generation.current; setBusy(true);
    try { const page = await getSharedProjectTaskStatusesAction(resource, next); if (current === generation.current) { setChoices(value => [...value, ...page.options]); setNext(page.nextAfterId); } }
    catch { if (current === generation.current) { setState(null); setError('loadError'); } }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function save() {
    if (!state || busy) return;
    const expected: CoManagedTaskEditPatch = {}, patch: CoManagedTaskEditPatch = {};
    for (const field of state.editableFields) if (draft[field] !== state.values[field]) { expected[field] = state.values[field]; patch[field] = draft[field]; }
    const request = pending ?? { operationId: crypto.randomUUID(), expected, patch };
    if (!Object.keys(request.patch).length) return;
    const current = generation.current; setPending(request); setBusy(true); setError(null);
    try {
      const result = await editSharedProjectTaskAction(resource, request);
      if (current !== generation.current) return;
      if (result.ok) { setPending(null); setState(null); setRefresh(value => value + 1); }
      else { setError(result.code); if (result.code !== 'unknownOutcome') setPending(null); if (result.code === 'forbidden' || result.code === 'readOnly') setState(null); }
    } catch { if (current === generation.current) setError('unknownOutcome'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  const conflict = error === 'conflict' || error === 'operationConflict';
  const changed = state?.editableFields.some(field => draft[field] !== state.values[field]) ?? false;
  const disabled = busy || pending !== null || conflict;
  return <section className="space-y-5">
    <h1 className="text-2xl font-semibold">{t('coManaged.projects.task')}</h1>
    {state && <p className="text-muted-foreground">{[state.organizationName, state.projectName, state.phaseName].filter(Boolean).join(' · ')}</p>}
    {error && <p role="alert" className="text-destructive">{t(error === 'loadError' ? 'coManaged.projects.loadError' : `coManaged.projects.errors.${error}`)}</p>}
    {!state ? (!error && <p role="status">{t('coManaged.loading')}</p>) : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      {'task_name' in state.values && <div className="space-y-2"><Label htmlFor="co-project-task-name">{t('coManaged.projects.name')}</Label>
        <Input id="co-project-task-name" required maxLength={255} value={draft.task_name ?? ''} disabled={disabled || !state.editableFields.includes('task_name')} onChange={event => setDraft(value => ({ ...value, task_name: event.target.value }))} /></div>}
      {'project_status_mapping_id' in state.values && <div className="space-y-2"><CustomSelect id="co-project-task-status" label={t('coManaged.editor.fields.status_id')}
        value={draft.project_status_mapping_id ?? ''} options={choices.map(option => ({ value: option.id, label: option.name }))}
        disabled={disabled || !state.editableFields.includes('project_status_mapping_id')} onValueChange={value => setDraft(previous => ({ ...previous, project_status_mapping_id: value }))} />
        {next && <Button id="co-project-task-more-statuses" type="button" variant="ghost" disabled={disabled} onClick={() => void more()}>{t('coManaged.projects.moreStatuses')}</Button>}</div>}
      {'due_date' in state.values && <div className="space-y-2"><Label htmlFor="co-project-task-due">{t('coManaged.editor.fields.due_date')}</Label>
        <Input id="co-project-task-due" type="datetime-local" value={localTime(draft.due_date)} disabled={disabled || !state.editableFields.includes('due_date')}
          onChange={event => { const value = event.target.value; if (value && !Number.isFinite(new Date(value).getTime())) return; setDraft(previous => ({ ...previous, due_date: value ? new Date(value).toISOString() : null })); }} /></div>}
      {state.editableFields.length > 0 && <Button id="co-project-task-save" type="submit" disabled={busy || conflict || (!pending && !changed)}>{t(pending ? 'coManaged.policy.retry' : 'coManaged.policy.save')}</Button>}
    </form>}
    {pending && <Button id="co-project-task-discard" variant="outline" disabled={busy} onClick={() => { setPending(null); setState(null); setRefresh(value => value + 1); }}>{t('coManaged.projects.discard')}</Button>}
    <Button id="co-project-task-reload" variant="outline" disabled={busy || pending !== null} onClick={() => { setState(null); setRefresh(value => value + 1); }}>{t('coManaged.policy.reload')}</Button>
    {state && <CoManagedProjectTaskAssignment key={`assignment-${collaborationRefresh}`} resource={resource} onUnavailable={historyUnavailable} onChanged={assignmentChanged} />}
    {state && <CoManagedProjectTaskConversation resource={resource} onUnavailable={historyUnavailable} />}
    {state && <CoManagedProjectTaskHistory key={`history-${collaborationRefresh}`} resource={resource} onUnavailable={historyUnavailable} />}
  </section>;
}
