'use client';

import Link from 'next/link';
import { CoManagedDelegatedAdministrationLink } from './CoManagedDelegatedAdministrationLink';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoManagedCustomerScope, CoManagedStaffAssignment } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedPolicyScreen, searchCoManagedPolicyOptions, saveCustomerCoManagedScope, saveSponsorCoManagedAssignments,
  type CoManagedPolicyOption, type CoManagedPolicyOptionKind } from '@/lib/actions/coManagedPolicyActions';

type Screen = Awaited<ReturnType<typeof getCoManagedPolicyScreen>>;
type Entry = { id: string; collaborate: boolean };
type Submission = { side: Screen['side']; revision: number; scope: CoManagedCustomerScope; assignments: CoManagedStaffAssignment[] };

function PolicyEntries({ kind, operationId, entries, labels, disabled, canExpand, onChange, onLabel }: {
  kind: CoManagedPolicyOptionKind; operationId?: string; entries: Entry[]; labels: CoManagedPolicyOption[];
  disabled: boolean; canExpand: boolean; onChange: (entries: Entry[]) => void; onLabel: (option: CoManagedPolicyOption) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [choices, setChoices] = useState<{ options: CoManagedPolicyOption[]; hasMore: boolean }>({ options: [], hasMore: false });
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!canExpand || disabled) return;
    let cancelled = false;
    setLoading(true); setError(false);
    const timer = setTimeout(() => {
      void searchCoManagedPolicyOptions({ kind, operationId, search, page }).then(result => {
        if (!cancelled) setChoices(result);
      }).catch(() => { if (!cancelled) setError(true); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [kind, operationId, search, page, canExpand, disabled]);
  return <section aria-labelledby={`co-policy-${kind}-title`} className="space-y-3 rounded-lg border p-4">
    <h2 id={`co-policy-${kind}-title`} className="text-lg font-semibold">{t(`coManaged.policy.kinds.${kind}`)}</h2>
    {entries.length === 0 && <p className="text-sm text-muted-foreground">{t('coManaged.policy.none')}</p>}
    <div className="max-h-80 space-y-3 overflow-y-auto">{entries.map(entry => {
      const label = labels.find(item => item.id === entry.id);
      return <div key={entry.id} className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 break-words text-sm">{label?.name || t('coManaged.policy.unavailable')}
          {label?.inactive && <span className="ml-2 text-muted-foreground">{t('coManaged.policy.inactive')}</span>}</span>
        <CustomSelect id={`co-policy-${kind}-access-${entry.id}`} label={t('coManaged.policy.accessFor', { name: label?.name || t('coManaged.policy.unavailable') })} value={entry.collaborate ? 'collaborate' : 'view'}
          disabled={disabled} options={[{ value: 'view', label: t('coManaged.policy.view') },
            ...((canExpand && !label?.inactive) || entry.collaborate ? [{ value: 'collaborate', label: t('coManaged.policy.collaborate') }] : [])]}
          onValueChange={value => onChange(entries.map(item => item.id === entry.id ? { ...item, collaborate: value === 'collaborate' } : item))} />
        <Button id={`co-policy-${kind}-remove-${entry.id}`} variant="outline" disabled={disabled}
          onClick={() => onChange(entries.filter(item => item.id !== entry.id))}>{t('coManaged.policy.remove')}</Button>
      </div>;
    })}</div>
    {canExpand && <div className="space-y-2 border-t pt-3">
      <Label htmlFor={`co-policy-${kind}-search`}>{t('coManaged.policy.search')}</Label>
      <Input id={`co-policy-${kind}-search`} maxLength={200} value={search} disabled={disabled}
        onChange={event => { setSearch(event.target.value); setPage(0); setSelected(''); }} />
      <div className="flex flex-wrap items-end gap-2">
        <CustomSelect id={`co-policy-${kind}-select`} label={t('coManaged.policy.select')} value={selected} disabled={disabled || loading}
          options={choices.options.filter(option => !entries.some(entry => entry.id === option.id)).map(option => ({ value: option.id, label: option.name }))}
          onValueChange={setSelected} />
        <Button id={`co-policy-${kind}-add`} variant="outline" disabled={disabled || loading || !selected} onClick={() => {
          const option = choices.options.find(item => item.id === selected);
          if (!option || entries.some(entry => entry.id === selected)) return;
          onLabel(option); onChange([...entries, { id: selected, collaborate: false }]); setSelected('');
        }}>{t('coManaged.policy.add')}</Button>
      </div>
      {error && <p role="alert" className="text-destructive">{t('coManaged.policy.optionsError')}</p>}
      {(page > 0 || choices.hasMore) && <div className="flex gap-2">
        <Button id={`co-policy-${kind}-previous`} variant="ghost" disabled={disabled || loading || page === 0} onClick={() => { setPage(page - 1); setSelected(''); }}>{t('coManaged.provisioning.previous')}</Button>
        <Button id={`co-policy-${kind}-next`} variant="ghost" disabled={disabled || loading || !choices.hasMore} onClick={() => { setPage(page + 1); setSelected(''); }}>{t('coManaged.provisioning.next')}</Button>
      </div>}
    </div>}
  </section>;
}

export default function CoManagedPolicyPanel({ operationId }: { operationId?: string }) {
  const { t } = useTranslation('msp/licensing');
  const [state, setState] = useState<Screen | null>(null);
  const [scope, setScope] = useState<CoManagedCustomerScope>({ visibilityMode: 'board_scope', boards: [], projects: [] });
  const [assignments, setAssignments] = useState<CoManagedStaffAssignment[]>([]);
  const [submitted, setSubmitted] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'loadError' | 'saveError' | null>(null);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const apply = useCallback((next: Screen) => {
    setState(next); setScope({ visibilityMode: next.policy.visibilityMode, boards: next.policy.boards, projects: next.policy.projects });
    setAssignments(next.policy.assignments); setSubmitted(null);
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    setState(null); setError(null); setSubmitted(null); setSaved(false); setBusy(false);
    void getCoManagedPolicyScreen(operationId).then(next => { if (current === generation.current) apply(next); })
      .catch(() => { if (current === generation.current) setError('loadError'); });
    return () => { ++generation.current; };
  }, [operationId, apply]);
  const reload = async () => {
    const current = ++generation.current;
    setBusy(true); setError(null); setSaved(false);
    try {
      const next = await getCoManagedPolicyScreen(operationId);
      if (current === generation.current) apply(next);
    } catch { if (current === generation.current) setError('loadError'); }
    finally { if (current === generation.current) setBusy(false); }
  };
  const save = async () => {
    if (!state || busy) return;
    const current = ++generation.current;
    const request = submitted || { side: state.side, revision: state.policy.revision, scope, assignments };
    setSubmitted(request); setBusy(true); setError(null); setSaved(false);
    try {
      if (request.side === 'customer') await saveCustomerCoManagedScope({ revision: request.revision, scope: request.scope });
      else if (operationId) await saveSponsorCoManagedAssignments({ operationId, revision: request.revision, assignments: request.assignments });
      else throw new Error('Missing sponsoring operation');
      if (current !== generation.current) return;
      const next = await getCoManagedPolicyScreen(operationId);
      if (current === generation.current) { apply(next); setSaved(true); }
    } catch { if (current === generation.current) setError('saveError'); }
    finally { if (current === generation.current) setBusy(false); }
  };
  const disabled = busy || Boolean(submitted);
  return <div className="mx-auto max-w-4xl space-y-6 p-6">
    <h1 className="text-3xl font-bold">{t('coManaged.policy.title')}</h1>
    {error && <p role="alert" className="text-destructive">{t(`coManaged.policy.${error}`)}</p>}
    {saved && <p role="status">{t('coManaged.policy.saved')}</p>}
    {!state && !error && <p role="status">{t('coManaged.loading')}</p>}
    {state && <Card><CardHeader><CardTitle>{state.counterpartName || t('coManaged.policy.title')}</CardTitle></CardHeader>
      <CardContent key={operationId || 'home'} className="space-y-5">
        <p>{t(`coManaged.policy.${state.side}Description`)}</p>
        <CoManagedDelegatedAdministrationLink operationId={operationId} />
        {!state.canExpand && <p role="status">{t('coManaged.policy.readOnly')}</p>}
        {state.side === 'customer' ? <>
          <Link href="/msp/co-management/ticket-access" className="text-primary underline">{t('coManaged.grants.title')}</Link>
          <CustomSelect id="co-policy-visibility" label={t('coManaged.provisioning.visibility')} value={scope.visibilityMode} disabled={disabled}
            options={[...(state.canExpand || scope.visibilityMode === 'board_scope' ? [{ value: 'board_scope', label: t('coManaged.provisioning.board_scope') }] : []),
              { value: 'escalation_only', label: t('coManaged.provisioning.escalation_only') }]}
            onValueChange={mode => setScope(current => ({ ...current, visibilityMode: mode as CoManagedCustomerScope['visibilityMode'], boards: mode === 'escalation_only' ? [] : current.boards }))} />
          <p className="text-sm text-muted-foreground">{t('coManaged.policy.visibilityHint')}</p>
          {(['board', 'project'] as const).filter(kind => kind === 'project' || scope.visibilityMode === 'board_scope').map(kind => {
            const key = kind === 'board' ? 'boards' : 'projects';
            return <PolicyEntries key={kind} kind={kind} entries={scope[key].map(grant => ({ id: grant.id, collaborate: grant.canCollaborate }))}
              labels={state.labels[kind]} disabled={disabled} canExpand={state.canExpand}
              onLabel={option => setState(current => current ? { ...current, labels: { ...current.labels, [kind]: [...current.labels[kind], option] } } : current)}
              onChange={entries => setScope(current => ({ ...current, [key]: entries.map(entry => ({ id: entry.id, canCollaborate: entry.collaborate })) }))} />;
          })}
        </> : <>
          {operationId && <Link id="co-policy-sla" href={`/msp/co-management/sla?operationId=${encodeURIComponent(operationId)}`} className="text-primary underline">{t('coManaged.sla.title')}</Link>}
          <div className="space-y-2 text-sm"><h2 className="font-semibold">{t('coManaged.policy.approvedScope')}</h2>
            <p>{t(state.policy.visibilityMode === 'board_scope' ? 'coManaged.provisioning.board_scope' : 'coManaged.provisioning.escalation_only')}</p>
            {(['board', 'project'] as const).map(kind => <div key={kind}><h3 className="font-medium">{t(`coManaged.policy.kinds.${kind}`)}</h3>
              {(kind === 'board' ? state.policy.boards : state.policy.projects).map(grant => <p key={grant.id}>
                {kind === 'project' ? <Link id={`co-policy-open-project-${grant.id}`} className="text-primary underline"
                  href={`/msp/co-management/projects/${state.target.customerTenant}/${state.target.relationshipId}/${grant.id}`}>
                  {state.labels[kind].find(label => label.id === grant.id)?.name || t('coManaged.policy.unavailable')}</Link>
                  : state.labels[kind].find(label => label.id === grant.id)?.name || t('coManaged.policy.unavailable')}: {t(grant.canCollaborate ? 'coManaged.policy.collaborate' : 'coManaged.policy.view')}
              </p>)}</div>)}
          </div>
          {(['user', 'team'] as const).map(kind => <PolicyEntries key={kind} kind={kind} operationId={operationId}
            entries={assignments.filter(item => item.kind === kind).map(item => ({ id: item.principalId, collaborate: item.role === 'technician' }))}
            labels={state.labels[kind]} disabled={disabled} canExpand={state.canExpand}
            onLabel={option => setState(current => current ? { ...current, labels: { ...current.labels, [kind]: [...current.labels[kind], option] } } : current)}
            onChange={entries => setAssignments(current => [...current.filter(item => item.kind !== kind), ...entries.map(entry => ({ kind, principalId: entry.id, role: entry.collaborate ? 'technician' as const : 'viewer' as const }))])} />)}
        </>}
      </CardContent>
    </Card>}
    <div className="flex gap-3">
      {state && <Button id="co-policy-save" disabled={busy} onClick={() => void save()}>{t(submitted ? 'coManaged.policy.retry' : 'coManaged.policy.save')}</Button>}
      <Button id="co-policy-reload" variant="outline" disabled={busy} onClick={() => void reload()}>{t('coManaged.policy.reload')}</Button>
    </div>
  </div>;
}
