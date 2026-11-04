'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoManagedSharedResource, CoManagedTicketAssignee, CoManagedTicketAssignmentRequest } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getSharedTicketAssignmentAction, listSharedTicketAssigneesAction, assignSharedTicketAction } from '@/lib/actions/coManagedTicketAssignmentActions';
import { newCoManagedOperationId } from './coManagedOperationId';

/** What the reader answers, widened to one shape: a restricted read carries only the capabilities (no revision, no assignment). */
type State = { resource: CoManagedSharedResource; canEdit: boolean; canAssign: boolean; revision?: number; hasAssignment?: boolean;
  mspAssignment?: { name: string; organizationName: string } | null };
type Choices = Awaited<ReturnType<typeof listSharedTicketAssigneesAction>>;
const NO_CHOICES: Choices = { options: [], nextAfterId: null };

/**
 * MSP assignment row for the Co-managed section. Everyone who can read the
 * ticket sees the current MSP assignee; only the sponsor side with edit
 * authority gets the "Change" control, which opens the picker in a Dialog.
 */
export default function CoManagedAssignmentField({ resource, refreshKey, onSaved, onUnavailable }: {
  resource: CoManagedSharedResource; refreshKey: number; onSaved: () => void; onUnavailable: () => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const target = useRef({ ...resource });
  const callbacks = useRef({ onSaved, onUnavailable });
  callbacks.current = { onSaved, onUnavailable };
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [reloads, setReloads] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true; let cancelled = false;
    void getSharedTicketAssignmentAction(target.current)
      .then(value => { if (!cancelled) setState(value); })
      .catch(() => { if (!cancelled) callbacks.current.onUnavailable(); });
    return () => { cancelled = true; mounted.current = false; };
  }, [refreshKey, reloads]);

  if (!state) return <div id="co-ticket-assignment-loading" role="status" aria-label={t('coManaged.ticket.loading')} className="h-8 animate-pulse rounded-md bg-[rgb(var(--color-border-100))]" />;
  const assignment = state.mspAssignment;
  const known = state.revision !== undefined;
  const summary = !known ? t('hasAssignment' in state ? 'coManaged.ticket.assignment.needsHandoff' : 'coManaged.ticket.restricted')
    : assignment ? `${assignment.organizationName} · ${assignment.name}`
    : t(state.hasAssignment ? 'coManaged.ticket.assignment.unavailable' : 'coManaged.projects.assignment.unassigned');
  return <div id="co-ticket-assignment" className="flex items-start justify-between gap-2 text-sm">
    <span className="flex-shrink-0 text-[rgb(var(--color-text-500))]">{t('coManaged.projects.assignment.title')}</span>
    {/* The value wraps (never truncates): an organization and a person name can both be long. */}
    <span id="co-ticket-assignment-value" className="min-w-0 flex-1 break-words text-right font-medium text-[rgb(var(--color-text-800))]">{summary}</span>
    {known && state.canEdit && (state.canAssign || state.hasAssignment) && <Button id="co-ticket-assignment-change" variant="ghost" size="sm" className="flex-shrink-0"
      onClick={() => setOpen(true)}>{t('coManaged.section.change')}</Button>}
    {open && <AssignmentDialog resource={target.current} state={state} onClose={() => { setOpen(false); setReloads(value => value + 1); }}
      onSaved={() => { setOpen(false); callbacks.current.onSaved(); }}
      onUnavailable={() => { setOpen(false); callbacks.current.onUnavailable(); }}
      onReadOnly={() => setState(value => value ? { ...value, canEdit: false, canAssign: false } : null)} />}
  </div>;
}

function AssignmentDialog({ resource, state, onClose, onSaved, onUnavailable, onReadOnly }: {
  resource: CoManagedSharedResource; state: State; onClose: () => void; onSaved: () => void; onUnavailable: () => void; onReadOnly: () => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [kind, setKind] = useState<'user' | 'team'>('user');
  const [selected, setSelected] = useState('');
  const [choices, setChoices] = useState<Choices>(NO_CHOICES);
  const [loadingChoices, setLoadingChoices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<CoManagedTicketAssignmentRequest | null>(null);
  const mounted = useRef(false), inFlight = useRef(false), choiceGeneration = useRef(0);
  const callbacks = useRef({ onSaved, onUnavailable, onReadOnly });
  callbacks.current = { onSaved, onUnavailable, onReadOnly };

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; choiceGeneration.current++; }; }, []);
  useEffect(() => {
    const generation = ++choiceGeneration.current;
    setChoices(NO_CHOICES);
    if (!state.canAssign) { setLoadingChoices(false); return; }
    setLoadingChoices(true);
    void listSharedTicketAssigneesAction(resource, kind).then(value => {
      if (mounted.current && generation === choiceGeneration.current) setChoices(value);
    }).catch(() => { if (mounted.current && generation === choiceGeneration.current) callbacks.current.onUnavailable(); })
      .finally(() => { if (mounted.current && generation === choiceGeneration.current) setLoadingChoices(false); });
    return () => { choiceGeneration.current++; };
  }, [state.canAssign, kind, resource]);

  async function more() {
    if (!choices.nextAfterId || busy || loadingChoices) return;
    const generation = choiceGeneration.current; setLoadingChoices(true);
    try {
      const page = await listSharedTicketAssigneesAction(resource, kind, choices.nextAfterId);
      if (mounted.current && generation === choiceGeneration.current) setChoices(current => ({ options: [...current.options, ...page.options], nextAfterId: page.nextAfterId }));
    } catch { if (mounted.current && generation === choiceGeneration.current) callbacks.current.onUnavailable(); }
    finally { if (mounted.current && generation === choiceGeneration.current) setLoadingChoices(false); }
  }

  async function save(assignee: CoManagedTicketAssignee | null) {
    if (!state.canEdit || state.revision === undefined || inFlight.current) return;
    // A retry after an unknown outcome replays the same operation, never a new one.
    const request = pending ?? { operationId: newCoManagedOperationId(), expectedRevision: state.revision, assignee };
    inFlight.current = true; setPending(request); setBusy(true); setError(null);
    try {
      const result = await assignSharedTicketAction(resource, request);
      if (!mounted.current) return;
      if (result.ok) { setPending(null); callbacks.current.onSaved(); }
      else {
        setError(result.code);
        if (result.code !== 'unknownOutcome') setPending(null);
        if (result.code === 'forbidden') callbacks.current.onUnavailable();
        if (result.code === 'readOnly') callbacks.current.onReadOnly();
      }
    } catch { if (mounted.current) setError('unknownOutcome'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  const blocked = busy || loadingChoices || !!pending || error === 'conflict' || error === 'operationConflict';
  const choice = choices.options.find(option => option.id === selected);
  const unchanged = false; // the reader discloses names only, never the assignee's identity, so there is no current id to compare
  return <Dialog id="co-ticket-assignment-dialog" isOpen title={t('coManaged.projects.assignment.title')} onClose={() => { if (!inFlight.current) onClose(); }} hideCloseButton={busy}
    footer={<div className="flex flex-wrap justify-end gap-2">
      {state.hasAssignment && <Button id="co-ticket-assignment-clear" variant="outline" disabled={blocked} onClick={() => void save(null)}>{t('coManaged.projects.assignment.clear')}</Button>}
      <Button id="co-ticket-assignment-cancel" variant="outline" disabled={busy} onClick={onClose}>{t('coManaged.ticket.cancel')}</Button>
      {pending ? <Button id="co-ticket-assignment-retry" disabled={busy} onClick={() => void save(pending.assignee)}>{t('coManaged.ticket.retry')}</Button>
        : state.canAssign && <Button id="co-ticket-assignment-save" disabled={blocked || !choice || unchanged}
          onClick={() => { if (choice) void save({ tenant: choice.tenant, kind: choice.kind, id: choice.id }); }}>{t('coManaged.projects.assignment.assign')}</Button>}
    </div>}>
    <DialogContent><div className="space-y-3">
      {state.canAssign && <>
        <CustomSelect id="co-ticket-assignment-kind" label={t('coManaged.projects.assignment.kind')} value={kind} disabled={blocked}
          options={(['user', 'team'] as const).map(value => ({ value, label: t(`coManaged.projects.assignment.${value}`) }))}
          onValueChange={value => { setKind(value as 'user' | 'team'); setSelected(''); }} />
        <CustomSelect id="co-ticket-assignment-person" label={t('coManaged.projects.assignment.assignee')} value={selected} disabled={blocked}
          options={choices.options.map(option => ({ value: option.id, label: `${option.name} · ${option.organizationName}` }))} onValueChange={setSelected} />
        {choices.nextAfterId && <Button id="co-ticket-assignment-more" variant="ghost" size="sm" disabled={blocked} onClick={() => void more()}>{t('coManaged.projects.assignment.more')}</Button>}
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{t(`coManaged.editor.errors.${error}`)}</p>}
    </div></DialogContent>
  </Dialog>;
}
