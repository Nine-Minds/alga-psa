'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedProvisioningOptions } from '@/lib/actions/coManagedActions';
import { provisionCoManagedWorkspaceAction } from '@enterprise/lib/actions/coManagedProvisioningActions';

type Draft = {
  workspaceName: string;
  administrator: { firstName: string; lastName: string; email: string };
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
  const [boards, setBoards] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState<Draft>(() => ({ workspaceName: clientName, administrator: { firstName: '', lastName: '', email: '' },
    seats: 1, visibilityMode: 'board_scope', escalationBoardId: '' }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef<string>(crypto.randomUUID());
  const submitted = useRef<(Draft & { clientId: string; operationId: string }) | null>(null);
  const firstRender = useRef(true);

  // Any edit marks the tab dirty so the focus/tab dismissal guard protects it.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    onDirtyChange?.(true);
  }, [form, onDirtyChange]);

  useEffect(() => {
    let cancelled = false;
    void getCoManagedProvisioningOptions('', clientId).then(result => { if (!cancelled) setBoards(result.boards); })
      .catch(() => { if (!cancelled) setError(t('coManaged.provisioning.loadError')); });
    return () => { cancelled = true; };
  }, [clientId, t]);

  const valid = form.workspaceName.trim().length > 0 && form.administrator.firstName.trim().length > 0 &&
    form.administrator.lastName.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.administrator.email) &&
    form.escalationBoardId.length > 0 && Number.isInteger(form.seats) && form.seats >= 1;

  const submit = async () => {
    const request = submitted.current ?? { ...form, clientId, operationId: operationId.current };
    submitted.current = request; setBusy(true); setError(null);
    try {
      const result = await provisionCoManagedWorkspaceAction(request);
      if ('rejected' in result) {
        // An acknowledged rejection is correctable; the operation ID is retained.
        submitted.current = null;
        setError(t('coManaged.provisioning.rejected'));
        return;
      }
      submitted.current = null;
      operationId.current = crypto.randomUUID();
      onDirtyChange?.(false);
      if (!result.enqueued) setError(t('coManaged.provisioning.workerUnavailable'));
      await onProvisioned();
    } catch { setError(t('coManaged.provisioning.submitError')); }
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
        <fieldset disabled={busy || Boolean(submitted.current)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-workspace-name`}>{t('coManaged.provisioning.workspace', { defaultValue: 'Workspace name' })}</Label>
            <Input id={`${idPrefix}-workspace-name`} required maxLength={200} value={form.workspaceName}
              onChange={(event) => setForm({ ...form, workspaceName: event.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['firstName', 'lastName', 'email'] as const).map((field) => (
              <div className="space-y-2" key={field}>
                <Label htmlFor={`${idPrefix}-admin-${field}`}>{t(`coManaged.provisioning.${field}`)}</Label>
                <Input id={`${idPrefix}-admin-${field}`} required type={field === 'email' ? 'email' : 'text'} maxLength={field === 'email' ? 254 : 100}
                  value={form.administrator[field]}
                  onChange={(event) => setForm({ ...form, administrator: { ...form.administrator, [field]: event.target.value } })} />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-seats`}>{t('coManaged.provisioning.seats', { defaultValue: 'Technician seats' })}</Label>
            <Input id={`${idPrefix}-seats`} required type="number" min={1} step={1} value={form.seats}
              onChange={(event) => setForm({ ...form, seats: Number(event.target.value) })} />
          </div>
          <CustomSelect id={`${idPrefix}-visibility`} label={t('coManaged.provisioning.visibility', { defaultValue: 'Visibility' })}
            value={form.visibilityMode}
            options={(['board_scope', 'escalation_only'] as const).map((mode) => ({ value: mode, label: t(`coManaged.provisioning.${mode}`) }))}
            onValueChange={(value) => setForm({ ...form, visibilityMode: value as Draft['visibilityMode'] })} />
          <CustomSelect id={`${idPrefix}-escalation-board`} label={t('coManaged.provisioning.destination', { defaultValue: 'Escalation board' })}
            required value={form.escalationBoardId} options={boards.map((board) => ({ value: board.id, label: board.name }))}
            onValueChange={(escalationBoardId) => setForm({ ...form, escalationBoardId })} />
        </fieldset>
        {submitted.current && <p>{t('coManaged.provisioning.recoverRequest', { defaultValue: 'The request was submitted. Retry recovers the same operation.' })}</p>}
        <Button id={`${idPrefix}-setup-submit`} type="submit" disabled={busy || (!submitted.current && !valid)}>
          {t(submitted.current ? 'coManaged.provisioning.retry' : 'coManaged.provisioning.submit',
            { defaultValue: submitted.current ? 'Retry' : 'Submit' })}
        </Button>
      </form>
      </CardContent>
    </Card>
  );
}
