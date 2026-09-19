'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoManagedSharedResource, CoManagedTicketEditField, CoManagedTicketEditPatch, CoManagedTicketEditRequest, CoManagedTicketEditorState } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getSharedTicketEditorAction, searchSharedTicketEditOptionsAction, saveSharedTicketEditAction, type SharedTicketEditResult } from '@/lib/actions/coManagedTicketEditActions';

type EditError = Extract<SharedTicketEditResult, { ok: false }>['code'];
const fieldOrder: CoManagedTicketEditField[] = ['title', 'status_id', 'priority_id', 'due_date', 'response_state', 'url'];

function ReferencePicker({ resource, field, value, selected, disabled, onChange }: {
  resource: CoManagedSharedResource; field: 'status_id' | 'priority_id'; value: string | null;
  selected?: { id: string; name: string }; disabled: boolean;
  onChange: (value: string | null, option?: { id: string; name: string }) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [choices, setChoices] = useState<Awaited<ReturnType<typeof searchSharedTicketEditOptionsAction>>>({ options: [], nextAfterId: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const cursor = cursors.at(-1);
  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    setLoading(true); setError(false); setChoices({ options: [], nextAfterId: null });
    const timer = setTimeout(() => {
      void searchSharedTicketEditOptionsAction(resource, { field, search, afterId: cursor }).then(result => {
        if (!cancelled) setChoices(result);
      }).catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [resource, field, search, cursor, disabled, retry]);
  const options = choices.options.map(option => ({ value: option.id, label: option.name }));
  if (selected && !options.some(option => option.value === selected.id)) options.unshift({ value: selected.id, label: selected.name });
  if (field === 'priority_id') options.unshift({ value: '__none', label: t('coManaged.editor.none') });
  return <div className="space-y-2">
    {!disabled && <><Label htmlFor={`co-edit-${field.replaceAll('_', '-')}-search`}>{t('coManaged.editor.searchOptions', { field: t(`coManaged.editor.fields.${field}`) })}</Label>
      <Input id={`co-edit-${field.replaceAll('_', '-')}-search`} value={search} maxLength={200} onChange={event => { setSearch(event.target.value); setCursors([undefined]); }} /></>}
    <CustomSelect id={`co-edit-${field.replaceAll('_', '-')}`} label={t(`coManaged.editor.fields.${field}`)} value={value ?? (field === 'priority_id' ? '__none' : '')}
      disabled={disabled || loading || error} options={options} onValueChange={id => onChange(id === '__none' ? null : id, choices.options.find(option => option.id === id) ?? (selected?.id === id ? selected : undefined))} />
    {error && <div role="alert"><p>{t('coManaged.editor.optionsError')}</p><Button id={`co-edit-${field.replaceAll('_', '-')}-retry`} type="button" variant="outline"
      onClick={() => setRetry(value => value + 1)}>{t('coManaged.ticket.retry')}</Button></div>}
    {!disabled && (cursors.length > 1 || choices.nextAfterId !== null) && <div className="flex gap-2">
      <Button id={`co-edit-${field.replaceAll('_', '-')}-previous`} type="button" variant="ghost" disabled={loading || cursors.length === 1}
        onClick={() => setCursors(values => values.slice(0, -1))}>{t('coManaged.provisioning.previous')}</Button>
      <Button id={`co-edit-${field.replaceAll('_', '-')}-next`} type="button" variant="ghost" disabled={loading || !choices.nextAfterId}
        onClick={() => setCursors(values => [...values, choices.nextAfterId!])}>{t('coManaged.provisioning.next')}</Button>
    </div>}
  </div>;
}
function localDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function CoManagedTicketEditor({ resource, onSaved, onReload }: {
  resource: CoManagedSharedResource; onSaved: () => void; onReload: () => void;
}) {
  return <TicketEditor key={`${resource.tenant}:${resource.relationshipId}:${resource.id}`} resource={resource} onSaved={onSaved} onReload={onReload} />;
}
function TicketEditor({ resource, onSaved, onReload }: { resource: CoManagedSharedResource; onSaved: () => void; onReload: () => void }) {
  const { t } = useTranslation('msp/licensing');
  const target = useRef({ ...resource });
  const [state, setState] = useState<CoManagedTicketEditorState | null>(null);
  const [draft, setDraft] = useState<CoManagedTicketEditPatch>({});
  const [labels, setLabels] = useState<CoManagedTicketEditorState['selectedOptions']>({});
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EditError | null>(null);
  const mounted = useRef(false), inFlight = useRef(false);
  const submitted = useRef<CoManagedTicketEditRequest | null>(null);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void getSharedTicketEditorAction(target.current).then(result => {
      if (cancelled) return;
      setState(result); setDraft({ ...result.values }); setLabels({ ...result.selectedOptions });
    }).catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; mounted.current = false; };
  }, []);
  const uncertain = error === 'unknownOutcome';
  const reloadRequired = error === 'conflict' || error === 'operationConflict' || error === 'forbidden' || error === 'readOnly';
  const frozen = busy || uncertain || reloadRequired;
  const dirty = state?.editableFields.some(field => draft[field] !== state.values[field]) ?? false;
  async function save() {
    if (!state || inFlight.current || reloadRequired || (!submitted.current && !dirty)) return;
    if (!submitted.current) {
      const patch: Record<string, string | null> = {}, expected: Record<string, string | null> = {};
      for (const field of state.editableFields) if (draft[field] !== state.values[field]) {
        patch[field] = draft[field] ?? null; expected[field] = state.values[field] ?? null;
      }
      submitted.current = { operationId: crypto.randomUUID(), patch, expected } as CoManagedTicketEditRequest;
    }
    const request = submitted.current;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await saveSharedTicketEditAction(target.current, request);
      if (!mounted.current) return;
      if (result.ok) { onSaved(); return; }
      setError(result.code);
      if (result.code !== 'unknownOutcome') submitted.current = null;
      if (result.code === 'forbidden') { setState(null); setDraft({}); setLabels({}); }
    } catch { if (mounted.current) setError('unknownOutcome'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  if (loadError || error === 'forbidden') return <div role="alert" className="rounded-lg border p-4"><p>{t('coManaged.editor.loadError')}</p>
    <Button id="co-edit-reload" variant="outline" onClick={onReload}>{t('coManaged.ticket.reload')}</Button></div>;
  if (!state) return <p role="status">{t('coManaged.ticket.loading')}</p>;
  return <section aria-labelledby="co-edit-heading" className="space-y-3 rounded-lg border p-4">
    <h2 id="co-edit-heading" className="font-semibold">{t('coManaged.editor.title')}</h2>
    {!state.editableFields.length && <p className="text-sm text-muted-foreground">{t('coManaged.editor.readOnly')}</p>}
    {!Object.keys(state.values).length ? <p>{t('coManaged.ticket.restricted')}</p> : <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">{fieldOrder.filter(field => Object.prototype.hasOwnProperty.call(state.values, field)).map(field => {
        const disabled = frozen || !state.editableFields.includes(field);
        if (field === 'status_id' || field === 'priority_id') return <ReferencePicker key={field} resource={target.current} field={field} value={draft[field] ?? null}
          selected={labels[field]} disabled={disabled} onChange={(value, option) => {
            setDraft(current => ({ ...current, [field]: value })); setLabels(current => ({ ...current, [field]: option }));
          }} />;
        if (field === 'response_state') return <CustomSelect key={field} id="co-edit-response-state" label={t('coManaged.editor.fields.response_state')}
          value={draft.response_state ?? '__none'} disabled={disabled} options={['__none', 'awaiting_client', 'awaiting_internal'].map(value => ({ value,
            label: t(value === '__none' ? 'coManaged.editor.none' : `coManaged.editor.states.${value}`) }))}
          onValueChange={value => setDraft(current => ({ ...current, response_state: value === '__none' ? null : value as 'awaiting_client' | 'awaiting_internal' }))} />;
        return <div key={field} className={field === 'title' ? 'md:col-span-2' : ''}><Label htmlFor={`co-edit-${field.replaceAll('_', '-')}`}>{t(`coManaged.editor.fields.${field}`)}</Label>
          <Input id={`co-edit-${field.replaceAll('_', '-')}`} type={field === 'due_date' ? 'datetime-local' : 'text'} required={field === 'title'} maxLength={field === 'title' ? 255 : 2048}
            value={field === 'due_date' ? localDateTime(draft.due_date) : draft[field] ?? ''} disabled={disabled}
            onChange={event => {
              const value = event.target.value;
              if (field === 'due_date' && value && !Number.isFinite(new Date(value).getTime())) return;
              setDraft(current => ({ ...current, [field]: field === 'due_date' ? value ? new Date(value).toISOString() : null : field === 'url' && !value ? null : value }));
            }} /></div>;
      })}</div>
      {error && <p role="alert" className="text-destructive">{t(`coManaged.editor.errors.${error}`)}</p>}
      {state.editableFields.length > 0 && <div className="flex flex-wrap gap-2">
        <Button id="co-edit-save" type="submit" disabled={busy || reloadRequired || (!dirty && !uncertain)}>{t(busy ? 'coManaged.ticket.saving' : uncertain ? 'coManaged.ticket.retry' : 'coManaged.editor.save')}</Button>
        <Button id="co-edit-discard" type="button" variant="outline" disabled={busy} onClick={onReload}>{t('coManaged.editor.reload')}</Button>
      </div>}
    </form>}
  </section>;
}
