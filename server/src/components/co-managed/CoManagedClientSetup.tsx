'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedProvisioningOptions, getCoManagedBillingState } from '@/lib/actions/coManagedActions';
import { provisionCoManagedWorkspaceAction } from '@enterprise/lib/actions/coManagedProvisioningActions';
import { provisioningRejectionMessage } from './coManagedProvisioningMessage';
import { newCoManagedOperationId } from './coManagedOperationId';
import { useRecoverableRequest } from './useRecoverableRequest';

type Draft = {
  workspaceName: string;
  administratorName: string;
  administratorEmail: string;
  seats: number;
  visibilityMode: 'board_scope' | 'escalation_only';
  escalationBoardId: string;
};

/** Client-fixed setup: the local client cannot be changed here, the workspace
 * name is prefilled from the client record, and an uncertain submission keeps
 * its original operation ID so a retry can only recover that operation. */
export default function CoManagedClientSetup({ clientId, clientName, idPrefix, onProvisioned, onDirtyChange }: {
  clientId: string;
  clientName: string;
  idPrefix: string;
  onProvisioned: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [capacity, setCapacity] = useState<Awaited<ReturnType<typeof getCoManagedBillingState>> | null>(null);
  const [boards, setBoards] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState<Draft>(() => ({ workspaceName: clientName, administratorName: '', administratorEmail: '',
    seats: 1, visibilityMode: 'board_scope', escalationBoardId: '' }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef<string>(newCoManagedOperationId());
  const recovery = useRecoverableRequest<Draft, Draft & { clientId: string; operationId: string }>(form);
  const firstRender = useRef(true);

  // Any edit marks the tab dirty so the focus/tab dismissal guard protects it.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    onDirtyChange?.(true);
  }, [form, onDirtyChange]);

  // A rejection usually means the pool changed under this form; re-read it so
  // the seat hint matches what the server just enforced.
  const reloadCapacity = async () => {
    try { setCapacity(await getCoManagedBillingState()); } catch { /* the rejection message already explains */ }
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getCoManagedProvisioningOptions('', clientId), getCoManagedBillingState()]).then(([result, billing]) => {
      if (!cancelled) { setBoards(result.boards); setCapacity(billing); }
    })
      .catch(() => { if (!cancelled) setError(t('coManaged.provisioning.loadError')); });
    return () => { cancelled = true; };
  }, [clientId, t]);

  const valid = form.workspaceName.trim().length > 0 && form.administratorName.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.administratorEmail) &&
    form.escalationBoardId.length > 0 && Number.isInteger(form.seats) && form.seats >= 1 && capacity?.isPro && capacity.canGrow && form.seats <= capacity.available;

  // canGrow is also false for a full pool; only a verified, fully allocated pool
  // is "no seats left" rather than an eligibility problem.
  const poolFull = Boolean(capacity?.isPro && !capacity.isReadOnly && capacity.capacity > 0 && capacity.allocated === capacity.capacity);

  const submit = async () => {
    if (!recovery.retrying && !valid) return;
    setBusy(true); setError(null);
    try {
      let result: Awaited<ReturnType<typeof provisionCoManagedWorkspaceAction>>;
      // A lost response leaves the form editable and keeps the operation ID: unchanged details are retried as the
      // identical request, and changed details get an explained conflict instead of a second workspace.
      try { result = await recovery.send(() => ({ ...form, clientId, operationId: operationId.current }), provisionCoManagedWorkspaceAction); }
      catch { setError(t('coManaged.provisioning.submitError')); return; }
      if ('rejected' in result) {
        // An acknowledged rejection is correctable; the operation ID is retained.
        setError(provisioningRejectionMessage(result.errorCode, t));
        await reloadCapacity();
        return;
      }
      operationId.current = newCoManagedOperationId();
      onDirtyChange?.(false);
      if (!result.enqueued) setError(t('coManaged.provisioning.workerUnavailable'));
      await onProvisioned();
    }
    finally { setBusy(false); }
  };

  return (
    <Card id={`${idPrefix}-setup`} aria-labelledby={`${idPrefix}-setup-title`}>
      <CardHeader>
        <CardTitle id={`${idPrefix}-setup-title`}>{t('coManaged.provisioning.create', { defaultValue: 'Enable co-managed IT' })}</CardTitle>
        <CardDescription>{t('coManaged.client.setupHint', {
          defaultValue: 'Enable co-managed IT from this client to reserve customer technicians and invite an administrator.' }) }</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <fieldset disabled={busy} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-workspace-name`}>{t('coManaged.provisioning.workspace', { defaultValue: 'Workspace name' })}</Label>
            <Input id={`${idPrefix}-workspace-name`} required maxLength={200} value={form.workspaceName}
              onChange={(event) => setForm({ ...form, workspaceName: event.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-admin-name`}>{t('coManaged.provisioning.administratorName', { defaultValue: 'Administrator name' })}</Label>
              <Input id={`${idPrefix}-admin-name`} required maxLength={200} value={form.administratorName}
                onChange={(event) => setForm({ ...form, administratorName: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-admin-email`}>{t('coManaged.provisioning.email', { defaultValue: 'Administrator email' })}</Label>
              <Input id={`${idPrefix}-admin-email`} required type="email" maxLength={254} value={form.administratorEmail}
                onChange={(event) => setForm({ ...form, administratorEmail: event.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-seats`}>{t('coManaged.provisioning.seats', { defaultValue: 'Technician seats' })}</Label>
            <Input id={`${idPrefix}-seats`} required type="number" min={1} max={capacity?.available ?? 0} step={1} value={form.seats}
              onChange={(event) => setForm({ ...form, seats: Number(event.target.value) })} />
          </div>
          {capacity && <p role="status" className="text-sm text-muted-foreground">{poolFull
            ? t('coManaged.provisioning.noSeatsAvailable', { count: capacity.capacity,
              defaultValue: 'No seats are available: all {{count}} purchased seats are allocated. Add seats to the pool or reduce another workspace\'s allocation.' })
            : !capacity.isPro || !capacity.canGrow
              ? t('coManaged.provisioning.ineligible', { defaultValue: 'An active Pro license and verified co-managed capacity are required to create a workspace.' })
              : t('coManaged.provisioning.capacity', { count: capacity.available })}</p>}
          <CustomSelect id={`${idPrefix}-visibility`} label={t('coManaged.provisioning.visibility', { defaultValue: 'Visibility' })}
            value={form.visibilityMode}
            options={(['board_scope', 'escalation_only'] as const).map((mode) => ({ value: mode, label: t(`coManaged.provisioning.${mode}`) }))}
            onValueChange={(value) => setForm({ ...form, visibilityMode: value as Draft['visibilityMode'] })} />
          <CustomSelect id={`${idPrefix}-escalation-board`} label={t('coManaged.provisioning.destination', { defaultValue: 'Escalation board' })}
            required value={form.escalationBoardId} options={boards.map((board) => ({ value: board.id, label: board.name }))}
            onValueChange={(escalationBoardId) => setForm({ ...form, escalationBoardId })} />
        </fieldset>
        {recovery.retrying && <p>{t('coManaged.provisioning.recoverRequest', { defaultValue: 'The request was submitted. Retry recovers the same operation.' })}</p>}
        <Button id={`${idPrefix}-setup-submit`} type="submit" disabled={busy || (!recovery.retrying && !valid)}>
          {t(recovery.retrying ? 'coManaged.provisioning.retry' : 'coManaged.provisioning.submit',
            { defaultValue: recovery.retrying ? 'Retry' : 'Submit' })}
        </Button>
      </form>
      </CardContent>
    </Card>
  );
}
