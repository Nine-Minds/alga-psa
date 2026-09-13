'use client';
import { useEffect, useRef, useState } from 'react';
import type { CoManagedSharedResource, CoManagedTaskAssignee, CoManagedTaskAssigneeOption, CoManagedTaskAssignmentRequest } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getSharedProjectTaskAssignmentAction, listSharedProjectTaskAssigneesAction, assignSharedProjectTaskAction } from '@/lib/actions/coManagedProjectTaskActions';

export default function CoManagedProjectTaskAssignment({ resource, onUnavailable, onChanged }: {
  resource: CoManagedSharedResource; onUnavailable: () => void; onChanged: () => void;
}) {
  return <Assignment key={JSON.stringify(resource)} resource={resource} onUnavailable={onUnavailable} onChanged={onChanged} />;
}
function Assignment({ resource, onUnavailable, onChanged }: { resource: CoManagedSharedResource; onUnavailable: () => void; onChanged: () => void }) {
  const { t } = useTranslation('msp/licensing');
  const [state, setState] = useState<Awaited<ReturnType<typeof getSharedProjectTaskAssignmentAction>> | null>(null);
  const [kind, setKind] = useState<'user' | 'team'>('user'), [selected, setSelected] = useState('');
  const [options, setOptions] = useState<CoManagedTaskAssigneeOption[]>([]), [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [loadingChoices, setLoadingChoices] = useState(false), [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<CoManagedTaskAssignmentRequest | null>(null), [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    // LEVERAGE: pattern qualified-assignment-request-lifetime — ticket/task forms retain identities and discard responses after navigation.
    const current = ++generation.current; setState(null); setError(null);
    void getSharedProjectTaskAssignmentAction(resource).then(result => {
      if (current !== generation.current) return;
      setState(result); setKind(result.mspAssignment?.kind ?? 'user'); setSelected(result.mspAssignment?.id ?? '');
    }).catch(() => { if (current === generation.current) onUnavailable(); });
    return () => { generation.current++; };
  }, [resource, refresh, onUnavailable]);
  useEffect(() => {
    let active = true; setOptions([]); setNext(null);
    if (!state?.canAssign) { setLoadingChoices(false); return; }
    setLoadingChoices(true);
    void listSharedProjectTaskAssigneesAction(resource, kind).then(page => { if (active) { setOptions(page.options); setNext(page.nextAfterId); } })
      .catch(() => { if (active) onUnavailable(); }).finally(() => { if (active) setLoadingChoices(false); });
    return () => { active = false; };
  }, [state, resource, kind, onUnavailable]);
  async function more() {
    if (!next || busy) return; const current = generation.current; setBusy(true);
    try { const page = await listSharedProjectTaskAssigneesAction(resource, kind, next); if (current === generation.current) { setOptions(value => [...value, ...page.options]); setNext(page.nextAfterId); } }
    catch { if (current === generation.current) onUnavailable(); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function save(assignee: CoManagedTaskAssignee | null) {
    if (!state?.canEdit || state.revision === undefined || busy) return;
    const request = pending ?? { operationId: crypto.randomUUID(), expectedRevision: state.revision, assignee };
    const current = generation.current; setPending(request); setBusy(true); setError(null);
    try {
      const result = await assignSharedProjectTaskAction(resource, request); if (current !== generation.current) return;
      if (result.ok) { setPending(null); onChanged(); }
      else { setError(result.code); if (result.code !== 'unknownOutcome') setPending(null); if (result.code === 'forbidden' || result.code === 'readOnly') onUnavailable(); }
    } catch { if (current === generation.current) setError('unknownOutcome'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  const conflict = error === 'conflict' || error === 'operationConflict', disabled = busy || !!pending || conflict || loadingChoices;
  const choice = options.find(option => option.id === selected), current = state?.mspAssignment;
  return <section className="space-y-3 border-t border-[rgb(var(--color-border-200))] pt-5" aria-labelledby="co-task-assignment-title">
    <h2 id="co-task-assignment-title" className="text-lg font-semibold">{t('coManaged.projects.assignment.title')}</h2>
    {!state ? <p role="status">{t('coManaged.loading')}</p> : state.revision !== undefined && <>
      <p className="text-sm text-muted-foreground">{current ? `${current.organizationName} · ${current.name}` : t('coManaged.projects.assignment.unassigned')}</p>
      {state.canAssign && <div className="space-y-3">
        <CustomSelect id="co-task-assignment-kind" label={t('coManaged.projects.assignment.kind')} value={kind}
          options={(['user', 'team'] as const).map(value => ({ value, label: t(`coManaged.projects.assignment.${value}`) }))}
          disabled={disabled} onValueChange={value => { setKind(value as 'user' | 'team'); setSelected(''); }} />
        <CustomSelect id="co-task-assignment-person" label={t('coManaged.projects.assignment.assignee')} value={selected}
          options={options.map(option => ({ value: option.id, label: `${option.name} · ${option.organizationName}` }))}
          disabled={disabled} onValueChange={setSelected} />
        {next && <Button id="co-task-assignment-more" variant="ghost" disabled={disabled} onClick={() => void more()}>{t('coManaged.projects.assignment.more')}</Button>}
        <Button id="co-task-assignment-save" disabled={disabled || !choice || (current?.kind === kind && current?.id === selected)}
          onClick={() => { if (choice) void save({ tenant: choice.tenant, kind: choice.kind, id: choice.id }); }}>{t('coManaged.projects.assignment.assign')}</Button>
      </div>}
      {state.canEdit && current && <Button id="co-task-assignment-clear" variant="outline" disabled={disabled} onClick={() => void save(null)}>{t('coManaged.projects.assignment.clear')}</Button>}
    </>}
    {error && <p role="alert" className="text-destructive">{t(`coManaged.projects.errors.${error}`)}</p>}
    {pending && <Button id="co-task-assignment-retry" disabled={busy} onClick={() => void save(pending.assignee)}>{t('coManaged.policy.retry')}</Button>}
    <Button id="co-task-assignment-reload" variant="ghost" disabled={busy} onClick={() => { setPending(null); setState(null); setRefresh(value => value + 1); }}>
      {t(pending ? 'coManaged.projects.discard' : 'coManaged.policy.reload')}</Button>
  </section>;
}
