'use client';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CoManagedDelegatedOperation, CoManagedDelegatedCommand } from '@alga-psa/co-managed';
import { getCoManagedDelegatedAdministration, searchCoManagedDelegatedAdministration, grantCoManagedDelegatedAdministration,
  revokeCoManagedDelegatedAdministration, runCoManagedDelegatedAdministration } from '@/lib/actions/coManagedDelegatedAdministrationActions';

type Option = { id: string; name: string; kind?: 'user' | 'team' };
type Grant = { grantId: string; operation: CoManagedDelegatedOperation; label?: string; principalName?: string; available: boolean;
  values?: Record<string,unknown>; version?: string };
type Screen = { side: 'customer' | 'sponsor'; workspaceName: string; sponsorName: string; revision: number; canWrite: boolean; grants: Grant[] } |
  { side: 'directory'; workspaces: { operationId: string; name: string }[] };
const operations: CoManagedDelegatedOperation[] = ['board_settings','user_profile','invitation_resend'];

export default function CoManagedDelegatedAdministration({ operationId }: { operationId?: string }) {
  const { data: session } = useSession();
  return <Administration key={`${session?.session_id}:${session?.user?.tenant}:${session?.user?.id}:${operationId}`} operationId={operationId} />;
}
function Picker({ kind, disabled, onSelect }: { kind: 'principal' | CoManagedDelegatedOperation; disabled: boolean; onSelect: (value: Option | null) => void }) {
  const { t } = useTranslation('features/co-management-delegation');
  const [search,setSearch] = useState(''), [page,setPage] = useState(0), [options,setOptions] = useState<Option[]>([]);
  const [more,setMore] = useState(false), [loading,setLoading] = useState(true), [error,setError] = useState(false), [value,setValue] = useState('');
  useEffect(() => {
    let current = true; setLoading(true); setOptions([]); setValue(''); onSelect(null);
    const timer = setTimeout(() => { void searchCoManagedDelegatedAdministration({ kind,search,page }).then(result => {
      if (current) { setOptions(result.options); setMore(result.hasMore); setError(false); }
    }).catch(() => { if (current) { setOptions([]); setMore(false); setError(true); } }).finally(() => { if (current) setLoading(false); }); },200);
    return () => { current = false; clearTimeout(timer); };
  },[kind,search,page,onSelect]);
  const prefix = `co-delegation-picker-${kind}`;
  return <div className="space-y-2">
    <Label htmlFor={`${prefix}-search`}>{t(kind === 'principal' ? 'principal' : 'target')}</Label>
    <Input id={`${prefix}-search`} value={search} disabled={disabled} placeholder={t('search')} onChange={event => { setSearch(event.target.value); setPage(0); }} />
    <CustomSelect id={`${prefix}-choice`} label={t(kind === 'principal' ? 'principal' : 'target')} value={value} disabled={disabled || loading}
      options={options.map(option => ({ value: `${option.kind ?? ''}:${option.id}`, label: option.name }))}
      onValueChange={selected => { setValue(selected); onSelect(options.find(option => `${option.kind ?? ''}:${option.id}` === selected) ?? null); }} />
    {error && <p role="alert">{t('loadError')}</p>}
    <div className="flex gap-2"><Button id={`${prefix}-previous`} variant="outline" disabled={disabled || loading || !page} onClick={() => setPage(page-1)}>{t('previous')}</Button>
      <Button id={`${prefix}-next`} variant="outline" disabled={disabled || loading || !more} onClick={() => setPage(page+1)}>{t('next')}</Button></div>
  </div>;
}
function Approval({ revision, disabled, onSaved }: { revision: number; disabled: boolean; onSaved: () => Promise<void> }) {
  const { t } = useTranslation('features/co-management-delegation');
  const [operation,setOperation] = useState<CoManagedDelegatedOperation>('board_settings'), [principal,setPrincipal] = useState<Option | null>(null), [target,setTarget] = useState<Option | null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(false);
  const pending = useRef<Parameters<typeof grantCoManagedDelegatedAdministration>[0] | null>(null);
  const [uncertain,setUncertain] = useState(false);
  const save = async () => {
    if (!principal?.kind || !target) return;
    pending.current ??= { revision, grant: { grantId: crypto.randomUUID(), operation, targetId: target.id, principalType: principal.kind, principalId: principal.id } };
    setBusy(true); setError(false);
    try { await grantCoManagedDelegatedAdministration(pending.current); await onSaved(); }
    catch { setError(true); setUncertain(true); } finally { setBusy(false); }
  };
  return <Card><CardHeader><CardTitle>{t('approveTitle')}</CardTitle></CardHeader><CardContent className="space-y-4">
    <p>{t('approvalHint')}</p>
    <CustomSelect id="co-delegation-operation" label={t('operation')} value={operation} disabled={disabled || busy || uncertain}
      options={operations.map(value => ({ value,label:t(`operations.${value}`) }))} onValueChange={value => setOperation(value as CoManagedDelegatedOperation)} />
    <Picker kind="principal" disabled={disabled || busy || uncertain} onSelect={setPrincipal} />
    <Picker key={operation} kind={operation} disabled={disabled || busy || uncertain} onSelect={setTarget} />
    {principal && target && <p>{t('approvalSummary',{ principal: principal.name,target: target.name,operation:t(`operations.${operation}`) })}</p>}
    {error && <p role="alert" className="text-destructive">{t('saveError')}</p>}
    <Button id="co-delegation-approve" disabled={disabled || busy || !principal || !target} onClick={() => void save()}>{t(uncertain ? 'retry' : 'approve')}</Button>
  </CardContent></Card>;
}
function GrantedOperation({ grant, operationId, disabled, revision, customer, onSaved }: { grant: Grant; operationId?: string; disabled: boolean; revision: number; customer: boolean; onSaved: () => Promise<void> }) {
  const { t } = useTranslation('features/co-management-delegation');
  const [values,setValues] = useState(grant.values ?? {}), [busy,setBusy] = useState(false), [error,setError] = useState(false), [uncertain,setUncertain] = useState(false);
  const pending = useRef<CoManagedDelegatedCommand | null>(null);
  const save = async () => {
    setBusy(true); setError(false);
    try {
      if (customer) await revokeCoManagedDelegatedAdministration({ revision,grantId:grant.grantId });
      else {
        if (!operationId || !grant.version) return;
        pending.current ??= { operationId:crypto.randomUUID(),grantId:grant.grantId,expectedVersion:grant.version,
          ...(grant.operation === 'invitation_resend' ? {} : { patch:Object.fromEntries(Object.entries(values).filter(([field,value]) => value !== grant.values?.[field])) }) };
        await runCoManagedDelegatedAdministration({ operationId,command:pending.current });
      }
      await onSaved();
    } catch { setError(true); setUncertain(true); } finally { setBusy(false); }
  };
  return <Card><CardHeader><CardTitle>{grant.label || t('unavailable')}</CardTitle></CardHeader><CardContent className="space-y-3">
    <p>{t(`operations.${grant.operation}`)}{grant.principalName ? ` · ${grant.principalName}` : ''}</p>
    {!grant.available && <p>{t('unavailableHint')}</p>}
    {!customer && grant.available && grant.operation === 'invitation_resend' && <>
      <p>{t('invitationHint')}</p><p>{t('invitationTerms',{ email:values.email,role:values.role,expires:values.expires_at })}</p>
    </>}
    {!customer && grant.available && grant.operation !== 'invitation_resend' && Object.entries(values).map(([field,value]) => <div key={field}>
      {field === 'enable_live_ticket_timer' ? <Checkbox id={`co-delegation-${grant.grantId}-${field}`} label={t(`fields.${field}`)} checked={Boolean(value)} disabled={disabled || busy || uncertain}
        onChange={event => setValues(current => ({ ...current,[field]:event.target.checked }))} /> : <>
        <Label htmlFor={`co-delegation-${grant.grantId}-${field}`}>{t(`fields.${field}`)}</Label>
        <Input id={`co-delegation-${grant.grantId}-${field}`} value={String(value ?? '')} disabled={disabled || busy || uncertain}
          onChange={event => setValues(current => ({ ...current,[field]:event.target.value }))} />
      </>}
    </div>)}
    {error && <p role="alert" className="text-destructive">{t('saveError')}</p>}
    <Button id={`co-delegation-${grant.grantId}-apply`} variant={customer ? 'outline' : 'default'} disabled={busy || !customer && (disabled || !grant.available || !uncertain && grant.operation !== 'invitation_resend' && !Object.entries(values).some(([field,value]) => value !== grant.values?.[field]))} onClick={() => void save()}>
      {t(uncertain ? 'retry' : customer ? 'revoke' : grant.operation === 'invitation_resend' ? 'resend' : 'save')}</Button>
  </CardContent></Card>;
}
function Administration({ operationId }: { operationId?: string }) {
  const { t } = useTranslation('features/co-management-delegation');
  const [screen,setScreen] = useState<Screen | null>(null), [error,setError] = useState(false), [generation,setGeneration] = useState(0);
  const sequence = useRef(0), mounted = useRef(true);
  const refresh = useCallback(async () => {
    const current = ++sequence.current; setScreen(null); setError(false);
    try { const result = await getCoManagedDelegatedAdministration(operationId); if (mounted.current && current === sequence.current) { setScreen(result); setGeneration(value => value+1); } }
    catch { if (mounted.current && current === sequence.current) { setScreen(null); setError(true); } }
  },[operationId]);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; sequence.current++; }; },[refresh]);
  return <div className="mx-auto max-w-4xl space-y-5 p-6">
    <h1 className="text-3xl font-bold">{t('title')}</h1><p>{t('description')}</p>
    <Button id="co-delegation-refresh" variant="outline" onClick={() => void refresh()}>{t('refresh')}</Button>
    {error && <p role="alert" className="text-destructive">{t('loadError')}</p>}
    {!screen && !error && <p role="status">{t('loading')}</p>}
    {screen?.side === 'directory' && <>{!screen.workspaces.length && <p>{t('noWorkspaces')}</p>}
      {screen.workspaces.map(workspace => <Card key={workspace.operationId}><CardContent className="p-4"><Link id={`co-delegation-workspace-${workspace.operationId}`} className="text-primary underline"
        href={`/msp/co-management/administration?operationId=${encodeURIComponent(workspace.operationId)}`}>{workspace.name}</Link></CardContent></Card>)}</>}
    {screen && screen.side !== 'directory' && <>
      <div role="status" className="rounded-md border border-primary bg-primary/5 p-4 font-medium">{t('banner',{ customer:screen.workspaceName,sponsor:screen.sponsorName })}</div>
      {!screen.canWrite && <p>{t('readOnly')}</p>}
      {screen.side === 'customer' && <Approval key={`approve-${generation}`} revision={screen.revision} disabled={!screen.canWrite} onSaved={refresh} />}
      {!screen.grants.length && <p>{t('noGrants')}</p>}
      {screen.grants.map(grant => <GrantedOperation key={`${generation}-${grant.grantId}`} grant={grant} customer={screen.side === 'customer'} operationId={operationId}
        revision={screen.revision} disabled={!screen.canWrite} onSaved={refresh} />)}
    </>}
  </div>;
}
