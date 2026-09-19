'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoManagedSharedResource, CoManagedTicketAssignee, CoManagedTicketAssignmentRequest } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getSharedTicketAssignmentAction, listSharedTicketAssigneesAction, assignSharedTicketAction } from '@/lib/actions/coManagedTicketAssignmentActions';

type Props = { resource: CoManagedSharedResource; onSaved: () => void; onUnavailable: () => void; onReload: () => void };
type State = Awaited<ReturnType<typeof getSharedTicketAssignmentAction>>;
type Choices = Awaited<ReturnType<typeof listSharedTicketAssigneesAction>>;

export default function CoManagedTicketAssignment(props: Props) {
  return <Assignment key={`${props.resource.tenant}:${props.resource.relationshipId}:${props.resource.id}`} {...props} />;
}
function Assignment({ resource, onSaved, onUnavailable, onReload }: Props) {
  const { t } = useTranslation('msp/licensing');
  const target = useRef({ ...resource }), callbacks = useRef({ onSaved, onUnavailable, onReload });
  callbacks.current = { onSaved, onUnavailable, onReload };
  const [state, setState] = useState<State | null>(null), [loadError, setLoadError] = useState(false);
  const [kind, setKind] = useState<'user' | 'team'>('user'), [selected, setSelected] = useState('');
  const [choices, setChoices] = useState<Choices>({ options: [], nextAfterId: null });
  const [loadingChoices, setLoadingChoices] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [pending, setPending] = useState<CoManagedTicketAssignmentRequest | null>(null);
  const mounted = useRef(false), inFlight = useRef(false), choiceGeneration = useRef(0);
  function unavailable() {
    setState(null); setChoices({ options: [], nextAfterId: null }); setLoadError(true);
    callbacks.current.onUnavailable();
  }
  useEffect(() => {
    // LEVERAGE: pattern qualified-assignment-request-lifetime — ticket/task forms retain identities and discard responses after navigation.
    mounted.current = true; let cancelled = false;
    void getSharedTicketAssignmentAction(target.current).then(value => {
      if (cancelled) return;
      setState(value); setKind(value.mspAssignment?.kind ?? 'user'); setSelected(value.mspAssignment?.id ?? '');
    }).catch(() => { if (!cancelled) unavailable(); });
    return () => { cancelled = true; mounted.current = false; choiceGeneration.current++; };
  }, []);
  useEffect(() => {
    const generation = ++choiceGeneration.current;
    setChoices({ options: [], nextAfterId: null });
    if (!state?.canAssign) { setLoadingChoices(false); return; }
    setLoadingChoices(true);
    void listSharedTicketAssigneesAction(target.current, kind).then(value => {
      if (mounted.current && generation === choiceGeneration.current) setChoices(value);
    }).catch(() => { if (mounted.current && generation === choiceGeneration.current) unavailable(); })
      .finally(() => { if (mounted.current && generation === choiceGeneration.current) setLoadingChoices(false); });
    return () => { choiceGeneration.current++; };
  }, [state, kind]);
  async function more() {
    if (!choices.nextAfterId || busy || loadingChoices) return;
    const generation = choiceGeneration.current; setLoadingChoices(true);
    try {
      const page = await listSharedTicketAssigneesAction(target.current, kind, choices.nextAfterId);
      if (mounted.current && generation === choiceGeneration.current) setChoices(current => ({ options: [...current.options, ...page.options], nextAfterId: page.nextAfterId }));
    } catch { if (mounted.current && generation === choiceGeneration.current) unavailable(); }
    finally { if (mounted.current && generation === choiceGeneration.current) setLoadingChoices(false); }
  }
  async function save(assignee: CoManagedTicketAssignee | null) {
    if (!state?.canEdit || state.revision === undefined || inFlight.current) return;
    const request = pending ?? { operationId: crypto.randomUUID(), expectedRevision: state.revision, assignee };
    inFlight.current = true; setPending(request); setBusy(true); setError(null);
    try {
      const result = await assignSharedTicketAction(target.current, request);
      if (!mounted.current) return;
      if (result.ok) { setPending(null); callbacks.current.onSaved(); }
      else {
        setError(result.code);
        if (result.code !== 'unknownOutcome') setPending(null);
        if (result.code === 'forbidden') unavailable();
        if (result.code === 'readOnly') setState(value => value ? { ...value, canEdit: false, canAssign: false } : null);
      }
    } catch { if (mounted.current) setError('unknownOutcome'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  const disabled = busy || loadingChoices || !!pending || error === 'conflict' || error === 'operationConflict';
  const assignment = state?.mspAssignment, choice = choices.options.find(option => option.id === selected);
  return <section className="space-y-3 border-t border-[rgb(var(--color-border-200))] pt-5" aria-labelledby="co-ticket-assignment-title">
    <h2 id="co-ticket-assignment-title" className="text-lg font-semibold">{t('coManaged.projects.assignment.title')}</h2>
    {loadError ? <p role="alert" className="text-destructive">{t('coManaged.editor.loadError')}</p> : !state ? <p role="status">{t('coManaged.ticket.loading')}</p> : state.revision === undefined ?
      <p className="text-sm text-muted-foreground">{'hasAssignment' in state ? t('coManaged.ticket.assignment.needsHandoff') : t('coManaged.ticket.restricted')}</p> : <>
      <p className="text-sm text-muted-foreground">{assignment ? `${assignment.organizationName} · ${assignment.name}` : t(state.hasAssignment ? 'coManaged.ticket.assignment.unavailable' : 'coManaged.projects.assignment.unassigned')}</p>
      {state.canAssign && <div className="space-y-3">
        <CustomSelect id="co-ticket-assignment-kind" label={t('coManaged.projects.assignment.kind')} value={kind} disabled={disabled}
          options={(['user', 'team'] as const).map(value => ({ value, label: t(`coManaged.projects.assignment.${value}`) }))} onValueChange={value => { setKind(value as 'user' | 'team'); setSelected(''); }} />
        <CustomSelect id="co-ticket-assignment-person" label={t('coManaged.projects.assignment.assignee')} value={selected} disabled={disabled}
          options={choices.options.map(option => ({ value: option.id, label: `${option.name} · ${option.organizationName}` }))} onValueChange={setSelected} />
        {choices.nextAfterId && <Button id="co-ticket-assignment-more" variant="ghost" disabled={disabled} onClick={() => void more()}>{t('coManaged.projects.assignment.more')}</Button>}
        <Button id="co-ticket-assignment-save" disabled={disabled || !choice || assignment?.kind === kind && assignment.id === selected}
          onClick={() => { if (choice) void save({ tenant: choice.tenant, kind: choice.kind, id: choice.id }); }}>{t('coManaged.projects.assignment.assign')}</Button>
      </div>}
      {state.canEdit && state.hasAssignment && <Button id="co-ticket-assignment-clear" variant="outline" disabled={disabled} onClick={() => void save(null)}>{t('coManaged.projects.assignment.clear')}</Button>}
    </>}
    {error && !loadError && <p role="alert" className="text-destructive">{t(`coManaged.editor.errors.${error}`)}</p>}
    {pending && <Button id="co-ticket-assignment-retry" disabled={busy} onClick={() => void save(pending.assignee)}>{t('coManaged.ticket.retry')}</Button>}
    <Button id="co-ticket-assignment-reload" variant="ghost" disabled={busy} onClick={() => callbacks.current.onReload()}>{t(pending ? 'coManaged.editor.reload' : 'coManaged.ticket.reload')}</Button>
  </section>;
}
