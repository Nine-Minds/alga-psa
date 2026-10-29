'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  executeCoManagedDelegatedCommandAction, getCoManagedDelegatedScreenAction, revokeCoManagedDelegatedGrantAction,
  saveCoManagedDelegatedGrantAction, searchCoManagedDelegatedOptionsAction,
} from '@/lib/actions/coManagedDelegatedActions';
import { newCoManagedOperationId } from './coManagedOperationId';

type Screen = Extract<Awaited<ReturnType<typeof getCoManagedDelegatedScreenAction>>, { ok: true }>['screen'];
type Grant = Screen['grants'][number];
type Operation = 'board_settings' | 'user_profile';
type Option = { id: string; name: string; kind?: 'user' | 'team' };

const FIELDS: Record<Operation, { key: string; label: string; type: 'text' | 'boolean' }[]> = {
  board_settings: [{ key: 'board_name', label: 'Board name', type: 'text' }, { key: 'description', label: 'Description', type: 'text' },
    { key: 'enable_live_ticket_timer', label: 'Live ticket timer', type: 'boolean' }],
  user_profile: [{ key: 'first_name', label: 'First name', type: 'text' }, { key: 'last_name', label: 'Last name', type: 'text' },
    { key: 'timezone', label: 'Time zone', type: 'text' }],
};

/**
 * Delegated administration for one relationship. The customer approves (and revokes) which
 * assigned technician may edit which board display settings or user profile; the MSP technician
 * then edits only what was approved. Every refusal other than a named outcome is shown as
 * "no longer available", exactly as the server answers it.
 */
export default function CoManagedDelegatedAdministration({ relationshipId, onChanged, refreshSignal = 0 }: {
  relationshipId: string;
  /** Called after an approve, revoke or edit succeeded, so siblings holding the relationship revision can refetch. */
  onChanged?: () => void;
  /** Changes when a sibling wrote; the screen refetches in place so the next approve/revoke uses the current revision. */
  refreshSignal?: number;
}) {
  const { t } = useTranslation('msp/licensing');
  const [screen, setScreen] = useState<Screen | null>(null);
  // The refusal is held as a server error code and translated at render, so fetching never depends on the translation function.
  const [refusal, setRefusal] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [editing, setEditing] = useState<Grant | null>(null);

  const refusalText = (code: string) => ({
    NOT_AVAILABLE: t('coManaged.delegation.notAvailable', { defaultValue: 'This is no longer available.' }),
    CHANGED: t('coManaged.delegation.changed', { defaultValue: 'This changed. Refresh and try again.' }),
    CO_MANAGED_DELEGATION_REVOKED: t('coManaged.delegation.revoked', { defaultValue: 'The customer revoked this approval.' }),
    CO_MANAGED_DELEGATION_TARGET_CHANGED: t('coManaged.delegation.targetChanged', { defaultValue: 'The record changed. Refresh and try again.' }),
  } as Record<string, string>)[code] ?? code;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setScreen(null);
    const result = await getCoManagedDelegatedScreenAction(relationshipId).catch(() => null);
    // A refusal from a failed save must survive the reload that follows it: only a dialog opening or a successful save clears the message.
    if (result?.ok) setScreen(result.screen); else setRefusal(result?.errorCode ?? 'NOT_AVAILABLE');
  }, [relationshipId]);
  useEffect(() => { void load(); }, [load]);
  const handled = useRef(refreshSignal);
  useEffect(() => { if (handled.current !== refreshSignal) { handled.current = refreshSignal; void load(true); } }, [refreshSignal, load]);

  const revoke = async (grant: Grant) => {
    if (!screen) return;
    const result = await revokeCoManagedDelegatedGrantAction(relationshipId, screen.revision, grant.grantId).catch(() => null);
    setRefusal(result?.ok ? null : result?.errorCode ?? 'NOT_AVAILABLE');
    if (result?.ok) onChanged?.();
    await load();
  };

  const operationName = (op: Operation) => op === 'board_settings'
    ? t('coManaged.delegation.boardSettings', { defaultValue: 'Board display settings' })
    : t('coManaged.delegation.userProfile', { defaultValue: 'User profile' });

  const columns: ColumnDefinition<Grant>[] = [
    { title: t('coManaged.delegation.technician', { defaultValue: 'Technician' }), dataIndex: 'principalName', sortable: false,
      render: (_v, row) => 'principalName' in row ? row.principalName : '—' },
    { title: t('coManaged.delegation.operation', { defaultValue: 'Can edit' }), dataIndex: 'operation', sortable: false,
      render: (_v, row) => operationName(row.operation as Operation) },
    { title: t('coManaged.delegation.target', { defaultValue: 'Record' }), dataIndex: 'targetId', id: 'label', sortable: false,
      render: (_v, row) => row.available && 'label' in row ? row.label : t('coManaged.delegation.unavailable', { defaultValue: 'No longer available' }) },
    { title: t('coManaged.delegation.actions', { defaultValue: 'Actions' }), dataIndex: 'grantId', id: 'actions', sortable: false,
      render: (_v, row) => screen?.side === 'customer'
        ? <Button id={`co-managed-delegation-revoke-${row.grantId}`} variant="outline" size="sm" onClick={() => void revoke(row)}>
            {t('coManaged.delegation.revoke', { defaultValue: 'Revoke' })}</Button>
        : <div className="flex flex-col items-start gap-1">
            <Button id={`co-managed-delegation-edit-${row.grantId}`} variant="outline" size="sm"
              disabled={!row.available || !screen?.canWrite || !('canEdit' in row && row.canEdit)} onClick={() => { setRefusal(null); setEditing(row); }}>
              {t('coManaged.delegation.edit', { defaultValue: 'Edit' })}</Button>
            {row.available && screen?.canWrite && !('canEdit' in row && row.canEdit) && <span id={`co-managed-delegation-edit-unavailable-${row.grantId}`} className="text-xs text-[rgb(var(--color-text-500))]">
              {t('coManaged.delegation.noPermission', { defaultValue: 'Your role does not include permission to make this change in your workspace.' })}</span>}
          </div> },
  ];

  return <div id="co-managed-delegated-administration" className="space-y-4">
    {refusal && <Alert variant="destructive"><AlertDescription id="co-managed-delegation-message">{refusalText(refusal)}</AlertDescription></Alert>}
    {!screen && !refusal && <p role="status">{t('coManaged.loading')}</p>}
    {screen && <>
      <div className="flex items-center justify-between">
        <p className="text-sm">{screen.side === 'customer'
          ? t('coManaged.delegation.customerIntro', { sponsor: screen.sponsorName, defaultValue: 'Choose what technicians from {{sponsor}} may edit in your workspace.' })
          : t('coManaged.delegation.sponsorIntro', { customer: screen.workspaceName, defaultValue: '{{customer}} has approved you to edit the records below.' })}</p>
        {screen.side === 'customer' && <Button id="co-managed-delegation-approve" disabled={!screen.canWrite} onClick={() => { setRefusal(null); setApproving(true); }}>
          {t('coManaged.delegation.approve', { defaultValue: 'Approve access' })}</Button>}
      </div>
      {screen.grants.length
        ? <DataTable id="co-managed-delegation-grants" data={screen.grants} columns={columns} pagination={false} />
        : <p id="co-managed-delegation-empty">{t('coManaged.delegation.empty', { defaultValue: 'No delegated access has been approved.' })}</p>}
    </>}
    {screen && approving && <ApproveDialog relationshipId={relationshipId} revision={screen.revision} operationName={operationName}
      onClose={() => setApproving(false)} onDone={async (error) => { setApproving(false); setRefusal(error ?? null); if (!error) onChanged?.(); await load(); }} />}
    {editing && <EditDialog relationshipId={relationshipId} grant={editing} operationName={operationName}
      onClose={() => setEditing(null)} onDone={async (error) => { setEditing(null); setRefusal(error ?? null); await load(); }} />}
  </div>;
}

function ApproveDialog({ relationshipId, revision, operationName, onClose, onDone }: {
  relationshipId: string; revision: number; operationName: (op: Operation) => string; onClose: () => void; onDone: (error?: string) => Promise<void>;
}) {
  const { t } = useTranslation('msp/licensing');
  const [operation, setOperation] = useState<Operation>('board_settings');
  const [principals, setPrincipals] = useState<Option[]>([]);
  const [targets, setTargets] = useState<Option[]>([]);
  const [principal, setPrincipal] = useState('');
  const [target, setTarget] = useState('');
  useEffect(() => { void searchCoManagedDelegatedOptionsAction(relationshipId, { kind: 'principal' }).then(r => setPrincipals(r.ok ? r.options : []), () => setPrincipals([])); }, [relationshipId]);
  useEffect(() => { setTarget(''); void searchCoManagedDelegatedOptionsAction(relationshipId, { kind: operation }).then(r => setTargets(r.ok ? r.options : []), () => setTargets([])); }, [relationshipId, operation]);
  const chosen = principals.find(p => `${p.kind}:${p.id}` === principal);
  const save = async () => {
    if (!chosen?.kind) return;
    const result = await saveCoManagedDelegatedGrantAction(relationshipId, revision,
      { grantId: newCoManagedOperationId(), principalType: chosen.kind, principalId: chosen.id, operation, targetId: target }).catch(() => null);
    await onDone(result?.ok ? undefined : result?.errorCode ?? 'NOT_AVAILABLE');
  };
  return <Dialog id="co-managed-delegation-approve-dialog" isOpen onClose={onClose} title={t('coManaged.delegation.approveTitle', { defaultValue: 'Approve delegated access' })}
    footer={<div className="flex justify-end gap-2">
      <Button id="co-managed-delegation-approve-cancel" variant="outline" onClick={onClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
      <Button id="co-managed-delegation-approve-save" disabled={!chosen || !target} onClick={() => void save()}>{t('coManaged.delegation.approve', { defaultValue: 'Approve access' })}</Button>
    </div>}>
    <div className="space-y-3">
      <CustomSelect id="co-managed-delegation-operation" label={t('coManaged.delegation.operation', { defaultValue: 'Can edit' })} value={operation}
        options={(['board_settings', 'user_profile'] as const).map(op => ({ value: op, label: operationName(op) }))} onValueChange={v => setOperation(v as Operation)} />
      <CustomSelect id="co-managed-delegation-principal" label={t('coManaged.delegation.technician', { defaultValue: 'Technician' })} value={principal}
        options={principals.map(p => ({ value: `${p.kind}:${p.id}`, label: p.name }))} onValueChange={setPrincipal} />
      <CustomSelect id="co-managed-delegation-target" label={t('coManaged.delegation.target', { defaultValue: 'Record' })} value={target}
        options={targets.map(p => ({ value: p.id, label: p.name }))} onValueChange={setTarget} />
    </div>
  </Dialog>;
}

function EditDialog({ relationshipId, grant, operationName, onClose, onDone }: {
  relationshipId: string; grant: Grant; operationName: (op: Operation) => string; onClose: () => void; onDone: (error?: string) => Promise<void>;
}) {
  const { t } = useTranslation('msp/licensing');
  const original = ('values' in grant ? grant.values : {}) as Record<string, unknown>;
  const fields = FIELDS[grant.operation as Operation] ?? [];
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...original });
  const patch = Object.fromEntries(fields.filter(f => draft[f.key] !== original[f.key]).map(f => [f.key, draft[f.key]]));
  const save = async () => {
    const result = await executeCoManagedDelegatedCommandAction(relationshipId, {
      operationId: newCoManagedOperationId(), grantId: grant.grantId, expectedVersion: 'version' in grant ? grant.version : '', patch }).catch(() => null);
    await onDone(result?.ok ? undefined : result?.errorCode ?? 'NOT_AVAILABLE');
  };
  return <Dialog id="co-managed-delegation-edit-dialog" isOpen onClose={onClose} title={operationName(grant.operation as Operation)} hasUnsavedChanges={Object.keys(patch).length > 0}
    footer={<div className="flex justify-end gap-2">
      <Button id="co-managed-delegation-edit-cancel" variant="outline" onClick={onClose}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
      <Button id="co-managed-delegation-edit-save" disabled={!Object.keys(patch).length} onClick={() => void save()}>{t('common.save', { defaultValue: 'Save' })}</Button>
    </div>}>
    <div className="space-y-3">
      {fields.map(field => field.type === 'boolean'
        ? <div key={field.key} className="flex items-center gap-2">
            <Switch id={`co-managed-delegation-field-${field.key}`} checked={Boolean(draft[field.key])} onCheckedChange={v => setDraft({ ...draft, [field.key]: v })} />
            <Label htmlFor={`co-managed-delegation-field-${field.key}`}>{t(`coManaged.delegation.fields.${field.key}`, { defaultValue: field.label })}</Label>
          </div>
        : <div key={field.key} className="space-y-1">
            <Label htmlFor={`co-managed-delegation-field-${field.key}`}>{t(`coManaged.delegation.fields.${field.key}`, { defaultValue: field.label })}</Label>
            <Input id={`co-managed-delegation-field-${field.key}`} value={String(draft[field.key] ?? '')} maxLength={field.key === 'description' ? 2000 : 200}
              onChange={event => setDraft({ ...draft, [field.key]: event.target.value })} />
          </div>)}
    </div>
  </Dialog>;
}
