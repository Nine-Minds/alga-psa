'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CoManagedProvisioningRequest } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@alga-psa/ui/components/Table';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCoManagedProvisioningOptions, getCoManagedProvisioningStatus, changeCoManagedWorkspaceSeats } from '@/lib/actions/coManagedActions';
import { provisionCoManagedWorkspaceAction, retryCoManagedProvisioningAction } from '@enterprise/lib/actions/coManagedProvisioningActions';

type Request = Omit<CoManagedProvisioningRequest, 'sponsorTenant' | 'requestedBy'>;
const emptyForm = (): Omit<Request, 'operationId'> => ({ clientId: '', workspaceName: '', seats: 1,
  administrator: { firstName: '', lastName: '', email: '' }, visibilityMode: 'board_scope', escalationBoardId: '' });

export default function CoManagedProvisioningPanel({ available, canGrow, initialClientId, onChanged }: {
  available: number; canGrow: boolean; initialClientId?: string; onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation('msp/licensing');
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getCoManagedProvisioningStatus>> | null>(null);
  const [options, setOptions] = useState<Awaited<ReturnType<typeof getCoManagedProvisioningOptions>> | null>(null);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Request | null>(null);
  const [allocation, setAllocation] = useState<{ operationId: string; seats: number; workspaceName: string } | null>(null);
  const [allocatedSeats, setAllocatedSeats] = useState(1);
  const autoOpened = useRef(false);
  const operationId = useRef<string | null>(null);
  const reload = useCallback(async () => { setStatus(await getCoManagedProvisioningStatus(page)); }, [page]);
  useEffect(() => { void reload().catch(() => setError(t('coManaged.provisioning.loadError'))); }, [reload, t]);
  const openForm = useCallback(() => {
    if (!operationId.current) {
      setForm({ ...emptyForm(), clientId: initialClientId || '' }); setSubmitted(null); setError(null); setSearch('');
      operationId.current = crypto.randomUUID();
    }
    setOpen(true);
  }, [initialClientId]);
  useEffect(() => {
    if (initialClientId && status?.canCreate && canGrow && !autoOpened.current) { autoOpened.current = true; openForm(); }
  }, [initialClientId, status?.canCreate, canGrow, openForm]);
  useEffect(() => {
    if (!open || submitted) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void getCoManagedProvisioningOptions(search, form.clientId || undefined).then(result => {
        if (!cancelled) setOptions(result);
      }).catch(() => { if (!cancelled) setError(t('coManaged.provisioning.loadError')); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, search, form.clientId, submitted, t]);
  const refresh = async () => {
    setBusy(true); setError(null);
    try { await reload(); await onChanged(); }
    catch { setError(t('coManaged.provisioning.loadError')); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    const request = submitted || { ...form, operationId: operationId.current || (operationId.current = crypto.randomUUID()) };
    // Freeze the request across an ambiguous network failure. Retrying can only
    // recover this exact operation, never create a second customer workspace.
    setSubmitted(request); setBusy(true); setError(null);
    try {
      const result = await provisionCoManagedWorkspaceAction(request);
      if ('rejected' in result) {
        // A domain rejection is an acknowledged response. The form can be
        // corrected, but keeps its operation ID so no prior success duplicates.
        setSubmitted(null); setError(t('coManaged.provisioning.rejected')); return;
      }
      setOpen(false); setSubmitted(null); operationId.current = null;
      if (!result.enqueued) setError(t('coManaged.provisioning.workerUnavailable'));
      await reload(); await onChanged();
    } catch { setError(t('coManaged.provisioning.submitError')); }
    finally { setBusy(false); }
  };
  const retry = async (operationId: string) => {
    setBusy(true); setError(null);
    try {
      if (!(await retryCoManagedProvisioningAction(operationId)).enqueued) setError(t('coManaged.provisioning.workerUnavailable'));
      await reload();
    } catch { setError(t('coManaged.provisioning.retryError')); }
    finally { setBusy(false); }
  };
  const resize = async () => {
    if (!allocation) return;
    setBusy(true); setError(null);
    try {
      await changeCoManagedWorkspaceSeats({ operationId: allocation.operationId, seats: allocatedSeats, expectedSeats: allocation.seats });
      setAllocation(null); await reload(); await onChanged();
    } catch { setError(t('coManaged.provisioning.resizeError')); }
    finally { setBusy(false); }
  };
  const valid = form.clientId && form.workspaceName.trim() && form.administrator.firstName.trim() && form.administrator.lastName.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.administrator.email) && form.escalationBoardId && Number.isInteger(form.seats) && form.seats >= 1 && form.seats <= available;
  return <Card><CardHeader><CardTitle>{t('coManaged.provisioning.title')}</CardTitle></CardHeader><CardContent className="space-y-4">
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!status && !error && <p role="status">{t('coManaged.loading')}</p>}
    <div className="flex flex-wrap gap-3">
      {status?.canCreate && <Button id="co-managed-create-workspace" disabled={busy || !canGrow || available < 1} onClick={openForm}>
        {t('coManaged.provisioning.create')}
      </Button>}
      <Button id="co-managed-refresh-workspaces" variant="outline" disabled={busy} onClick={() => void refresh()}>{t('coManaged.provisioning.refresh')}</Button>
    </div>
    {status?.items.length === 0 && <p>{t('coManaged.provisioning.empty')}</p>}
    {status && status.items.length > 0 && <div className="overflow-x-auto"><Table>
      <TableHeader><TableRow>{['workspace', 'administrator', 'seats', 'status', 'actions'].map(key =>
        <TableHead key={key}>{t(`coManaged.provisioning.${key}`)}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{status.items.map(item => <TableRow key={item.operationId}>
        <TableCell>{item.workspaceName}</TableCell><TableCell>{item.administratorEmail}</TableCell><TableCell>{item.seats}</TableCell>
        <TableCell>{t(`coManaged.provisioning.states.${item.state}`)}
          {item.state === 'pending_acceptance' && <p className="text-muted-foreground">{t(item.invitationExpired ? 'coManaged.provisioning.invitationExpired' : item.invitationSent
            ? 'coManaged.provisioning.invitationSent' : item.deliveryFailed ? 'coManaged.provisioning.deliveryFailed' : 'coManaged.provisioning.invitationPending')}</p>}
        </TableCell>
        <TableCell><div className="flex gap-2">
          {status.canManage && item.state === 'active' && <Button id={`co-managed-policy-${item.operationId}`} variant="outline" asChild><Link href={`/msp/co-management?operationId=${encodeURIComponent(item.operationId)}`}>{t('coManaged.policy.manage')}</Link></Button>}
          {status.canManage && item.canChangeSeats && <Button id={`co-managed-resize-${item.operationId}`} variant="outline" disabled={busy}
            onClick={() => { setAllocation(item); setAllocatedSeats(item.seats); setError(null); }}>{t('coManaged.provisioning.resize')}</Button>}
          {status.canManage && item.canRetry && <Button id={`co-managed-retry-${item.operationId}`} variant="outline" disabled={busy}
            onClick={() => void retry(item.operationId)}>{t(item.invitationExpired ? 'coManaged.provisioning.resendInvitation' : 'coManaged.provisioning.retry')}</Button>}
        </div></TableCell>
      </TableRow>)}</TableBody>
    </Table></div>}
    {(page > 0 || status?.hasMore) && <div className="flex gap-3">
      <Button id="co-managed-previous-workspaces" variant="outline" disabled={busy || page === 0} onClick={() => setPage(page - 1)}>{t('coManaged.provisioning.previous')}</Button>
      <Button id="co-managed-next-workspaces" variant="outline" disabled={busy || !status?.hasMore} onClick={() => setPage(page + 1)}>{t('coManaged.provisioning.next')}</Button>
    </div>}
    <Dialog id="co-managed-provision-workspace" isOpen={open} onClose={() => { if (!busy) setOpen(false); }} title={t('coManaged.provisioning.create')}>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <p>{t('coManaged.provisioning.description')}</p>
        <fieldset disabled={busy || Boolean(submitted)} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="co-managed-client-search">{t('coManaged.provisioning.searchClients')}</Label>
            <Input id="co-managed-client-search" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} /></div>
          <CustomSelect id="co-managed-client" label={t('coManaged.provisioning.client')} required value={form.clientId}
            disabled={busy || Boolean(submitted)} options={(options?.clients || []).map(client => ({ value: client.id, label: client.name }))}
            onValueChange={clientId => setForm(current => ({ ...current, clientId,
              workspaceName: current.workspaceName || options?.clients.find(client => client.id === clientId)?.name || '' }))} />
          <div className="space-y-2"><Label htmlFor="co-managed-workspace-name">{t('coManaged.provisioning.workspace')}</Label>
            <Input id="co-managed-workspace-name" required maxLength={200} value={form.workspaceName}
              onChange={event => setForm({ ...form, workspaceName: event.target.value })} /></div>
          <div className="grid gap-3 sm:grid-cols-2">{(['firstName', 'lastName', 'email'] as const).map(field => <div className="space-y-2" key={field}>
            <Label htmlFor={`co-managed-admin-${field}`}>{t(`coManaged.provisioning.${field}`)}</Label>
            <Input id={`co-managed-admin-${field}`} required type={field === 'email' ? 'email' : 'text'} maxLength={field === 'email' ? 254 : 100}
              value={form.administrator[field]} onChange={event => setForm({ ...form, administrator: { ...form.administrator, [field]: event.target.value } })} />
          </div>)}</div>
          <div className="space-y-2"><Label htmlFor="co-managed-workspace-seats">{t('coManaged.provisioning.seats')}</Label>
            <Input id="co-managed-workspace-seats" required type="number" min={1} max={available} step={1} value={form.seats}
              onChange={event => setForm({ ...form, seats: Number(event.target.value) })} />
            <p className="text-sm text-muted-foreground">{t('coManaged.provisioning.capacity', { count: available })}</p></div>
          <CustomSelect id="co-managed-visibility" label={t('coManaged.provisioning.visibility')} value={form.visibilityMode} disabled={busy || Boolean(submitted)}
            options={(['board_scope', 'escalation_only'] as const).map(mode => ({ value: mode, label: t(`coManaged.provisioning.${mode}`) }))}
            onValueChange={value => setForm({ ...form, visibilityMode: value as Request['visibilityMode'] })} />
          <CustomSelect id="co-managed-escalation-board" label={t('coManaged.provisioning.destination')} required value={form.escalationBoardId}
            disabled={busy || Boolean(submitted)} options={(options?.boards || []).map(board => ({ value: board.id, label: board.name }))}
            onValueChange={escalationBoardId => setForm({ ...form, escalationBoardId })} />
        </fieldset>
        {submitted && <p>{t('coManaged.provisioning.recoverRequest')}</p>}
        <Button id="co-managed-submit-workspace" type="submit" disabled={busy || (!submitted && (!valid || !canGrow))}>
          {t(submitted ? 'coManaged.provisioning.retry' : 'coManaged.provisioning.submit')}
        </Button>
      </form>
    </Dialog>
    <Dialog id="co-managed-resize-allocation" isOpen={Boolean(allocation)} onClose={() => { if (!busy) setAllocation(null); }} title={t('coManaged.provisioning.resize')}>
      {allocation && <div className="space-y-4">
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <p>{allocation.workspaceName}</p><p>{t('coManaged.provisioning.resizeDescription')}</p>
        <Label htmlFor="co-managed-allocation-seats">{t('coManaged.provisioning.seats')}</Label>
        <Input id="co-managed-allocation-seats" type="number" min={1} max={allocation.seats + (canGrow ? available : 0)} step={1}
          value={allocatedSeats} disabled={busy} onChange={event => setAllocatedSeats(Number(event.target.value))} />
        <Button id="co-managed-save-allocation" disabled={busy || !Number.isInteger(allocatedSeats) || allocatedSeats < 1 ||
          allocatedSeats > allocation.seats + (canGrow ? available : 0)} onClick={() => void resize()}>{t('coManaged.provisioning.saveAllocation')}</Button>
      </div>}
    </Dialog>
  </CardContent></Card>;
}
