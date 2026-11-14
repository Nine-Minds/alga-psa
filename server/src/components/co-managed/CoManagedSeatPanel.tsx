'use client';

import { useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import type { CoManagedSeatArrangementPanel, CoManagedSeatTechnicianRow } from '@alga-psa/co-managed';
import {
  changeCoManagedSeatAllocationAction, inviteCoManagedSeatTechnicianAction, resendCoManagedSeatInvitationAction,
  revokeCoManagedSeatInvitationAction,
} from '@/lib/actions/coManagedSeatActions';
import CoManagedSeatAccess from './CoManagedSeatAccess';
import { coManagedSeatMessage } from './coManagedSeatMessage';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A client's seat arrangement: seats used and allocated, the allocation, technicians and their
 * invitations, board scope, shared projects and handoff defaults. Editing needs `canManage`
 * (admitted and permitted); otherwise it is read-only.
 *
 * Revoking an accepted technician is not offered here: that command does not exist yet. Only a
 * pending invitation can be withdrawn.
 */
export default function CoManagedSeatPanel({ panel, canManage, idPrefix, onChanged }: {
  panel: CoManagedSeatArrangementPanel;
  canManage: boolean;
  idPrefix: string;
  onChanged: () => Promise<void> | void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [seats, setSeats] = useState(panel.seats);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [withdrawing, setWithdrawing] = useState<CoManagedSeatTechnicianRow | null>(null);

  const run = async (work: () => Promise<{ rejected: true; errorCode: string } | { ok: string }>) => {
    setBusy(true); setMessage(null);
    try {
      const result = await work();
      if ('rejected' in result) { setMessage({ tone: 'error', text: coManagedSeatMessage(result.errorCode, t) }); return; }
      setMessage({ tone: 'ok', text: result.ok });
      await onChanged();
    } catch { setMessage({ tone: 'error', text: coManagedSeatMessage(null, t) }); }
    finally { setBusy(false); }
  };

  const delivery = (delivered: boolean) => delivered
    ? t('coManaged.seat.technicians.sent', { defaultValue: 'Invitation sent.' })
    : t('coManaged.seat.technicians.notSent', { defaultValue: 'The seat is held, but the email did not send. Resend it.' });

  const columns: ColumnDefinition<CoManagedSeatTechnicianRow>[] = [
    { title: t('coManaged.seat.technicians.name', { defaultValue: 'Name' }), dataIndex: 'name', sortable: false },
    { title: t('coManaged.seat.technicians.email', { defaultValue: 'Email' }), dataIndex: 'email', sortable: false },
    { title: t('coManaged.seat.technicians.status', { defaultValue: 'Status' }), dataIndex: 'state', sortable: false,
      render: (_value, row) => row.state === 'active'
        ? t('coManaged.seat.technicians.active', { defaultValue: 'Active' })
        : row.expired ? t('coManaged.seat.technicians.expired', { defaultValue: 'Invitation expired' })
          : t('coManaged.seat.technicians.invited', { defaultValue: 'Invited' }) },
    ...(canManage ? [{ title: t('coManaged.overview.actions', { defaultValue: 'Actions' }), dataIndex: 'assignmentId', id: 'actions', sortable: false,
      // Two buttons side by side: without a floor the table squeezed them to "esen" and "ithdra".
      minWidth: '200px',
      render: (_value: unknown, row: CoManagedSeatTechnicianRow) => row.state === 'invited' ? (
        <div className="flex gap-2 whitespace-nowrap">
          <Button id={`${idPrefix}-resend-${row.assignmentId}`} size="sm" variant="outline" disabled={busy}
            onClick={() => void run(async () => {
              const result = await resendCoManagedSeatInvitationAction({ assignmentId: row.assignmentId });
              return 'rejected' in result ? result : { ok: delivery(result.delivered) };
            })}>{t('coManaged.seat.technicians.resend', { defaultValue: 'Resend' })}</Button>
          <Button id={`${idPrefix}-withdraw-${row.assignmentId}`} size="sm" variant="outline" disabled={busy}
            onClick={() => setWithdrawing(row)}>{t('coManaged.seat.technicians.withdraw', { defaultValue: 'Withdraw' })}</Button>
        </div>
      ) : null } satisfies ColumnDefinition<CoManagedSeatTechnicianRow>] : []),
  ];

  return (
    <div id={`${idPrefix}-seat-panel`} className="space-y-4">
      <Card>
        <CardHeader><CardTitle>{t('coManaged.seat.panel.title', { defaultValue: 'Seat arrangement' })}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {message && <Alert variant={message.tone === 'error' ? 'destructive' : 'default'}><AlertDescription id={`${idPrefix}-seat-message`} role="status">{message.text}</AlertDescription></Alert>}
          <p id={`${idPrefix}-seat-usage`} className="text-sm">
            {t('coManaged.seat.panel.usage', { defaultValue: '{{used}} of {{count}} seats used', used: panel.usedSeats, count: panel.seats })}
          </p>
          {canManage && (
            <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result = await changeCoManagedSeatAllocationAction({ arrangementId: panel.arrangementId, seats, expectedSeats: panel.seats });
                return 'rejected' in result ? result : { ok: t('coManaged.seat.saved', { defaultValue: 'Saved.' }) };
              });
            }}>
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-seat-allocation`}>{t('coManaged.seat.panel.allocation', { defaultValue: 'Seats allocated' })}</Label>
                <Input id={`${idPrefix}-seat-allocation`} type="number" min={1} step={1} value={seats} disabled={busy}
                  onChange={(event) => setSeats(Number(event.target.value))} />
              </div>
              <Button id={`${idPrefix}-seat-resize`} type="submit" disabled={busy || !Number.isInteger(seats) || seats < 1 || seats === panel.seats}>
                {t('coManaged.seat.panel.changeSeats', { defaultValue: 'Change seats' })}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('coManaged.seat.technicians.title', { defaultValue: 'Technicians' })}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {panel.technicians.length === 0
            ? <p className="text-sm text-muted-foreground">{t('coManaged.seat.technicians.none', { defaultValue: 'No technicians yet.' })}</p>
            : <DataTable id={`${idPrefix}-technicians`} data={panel.technicians} columns={columns} pagination={false} />}
          {canManage && (
            <form id={`${idPrefix}-invite`} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result = await inviteCoManagedSeatTechnicianAction({ arrangementId: panel.arrangementId, name, email });
                if ('rejected' in result) return result;
                setName(''); setEmail('');
                return { ok: delivery(result.delivered) };
              });
            }}>
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-invite-name`}>{t('coManaged.seat.technicians.name', { defaultValue: 'Name' })}</Label>
                <Input id={`${idPrefix}-invite-name`} maxLength={200} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-invite-email`}>{t('coManaged.seat.technicians.email', { defaultValue: 'Email' })}</Label>
                <Input id={`${idPrefix}-invite-email`} type="email" maxLength={254} value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} />
              </div>
              <Button id={`${idPrefix}-invite-submit`} type="submit" disabled={busy || !name.trim() || !EMAIL.test(email.trim()) || panel.usedSeats >= panel.seats}>
                {t('coManaged.seat.technicians.invite', { defaultValue: 'Invite technician' })}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {canManage
        ? <Card><CardHeader><CardTitle>{t('coManaged.seat.access.title', { defaultValue: 'Access and handoff' })}</CardTitle></CardHeader>
          <CardContent><CoManagedSeatAccess panel={panel} idPrefix={idPrefix} onChanged={onChanged} /></CardContent></Card>
        : null}

      <ConfirmationDialog id={`${idPrefix}-withdraw-dialog`} isOpen={withdrawing !== null} onClose={() => setWithdrawing(null)}
        title={t('coManaged.seat.technicians.withdrawTitle', { defaultValue: 'Withdraw invitation' })}
        message={t('coManaged.seat.technicians.withdrawMessage', { defaultValue: 'Withdraw the invitation for {{email}}? The seat goes back to this arrangement.', email: withdrawing?.email ?? '' })}
        confirmLabel={t('coManaged.seat.technicians.withdraw', { defaultValue: 'Withdraw' })}
        onConfirm={async () => {
          const target = withdrawing;
          setWithdrawing(null);
          if (target) await run(async () => {
            const result = await revokeCoManagedSeatInvitationAction({ assignmentId: target.assignmentId });
            return 'rejected' in result ? result : { ok: t('coManaged.seat.technicians.withdrawn', { defaultValue: 'Invitation withdrawn.' }) };
          });
        }} />
    </div>
  );
}
