'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { ColumnDefinition, IUser } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import TicketSelect, { type TicketOption } from '@alga-psa/projects/components/TicketSelect';
import {
  explainCoManagedSeatTicketAccessAction,
  searchCoManagedSeatAccessTicketsAction,
  type CoManagedSeatTechnicianListing,
} from '@/lib/actions/coManagedSeatActions';

type Explanation = { code: string; kind: string; messageKey: string; params: { resource?: string; action?: string; requiredAction?: string } };
type Outcome = { allowed: boolean; explanations: Explanation[] } | { error: 'failed' | 'unavailable' };

const fullName = (user: IUser) => [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.username || user.email;

/**
 * Seat technicians of the MSP, apart from its staff: each row names the client the seat is for, and "Effective
 * access" explains whether the technician can read a chosen ticket. The decision and its reasons are the
 * authorization simulator's; this only shows them.
 */
export default function SeatTechnicianUsers({ users, listings }: {
  users: IUser[];
  listings: Record<string, CoManagedSeatTechnicianListing>;
}) {
  const { t } = useTranslation('msp/settings');
  const [explaining, setExplaining] = useState<IUser | null>(null);

  const columns: ColumnDefinition<IUser>[] = [
    { title: t('users.seatTechnicians.columns.name', { defaultValue: 'Name' }), dataIndex: 'first_name', sortable: false, render: (_value, user) => fullName(user) },
    { title: t('users.seatTechnicians.columns.email', { defaultValue: 'Email' }), dataIndex: 'email', sortable: false },
    { title: t('users.seatTechnicians.columns.client', { defaultValue: 'Client' }), dataIndex: 'user_id', id: 'client', sortable: false,
      render: (_value, user) => listings[user.user_id]?.clientName
        ?? t('users.seatTechnicians.clientUnavailable', { defaultValue: 'Client not available' }) },
    { title: t('users.seatTechnicians.columns.status', { defaultValue: 'Status' }), dataIndex: 'user_id', id: 'status', sortable: false,
      render: (_value, user) => listings[user.user_id]?.state === 'invited'
        ? t('users.seatTechnicians.state.invited', { defaultValue: 'Invitation pending' })
        : t('users.seatTechnicians.state.active', { defaultValue: 'Active' }) },
    { title: t('users.seatTechnicians.columns.actions', { defaultValue: 'Actions' }), dataIndex: 'user_id', id: 'actions', sortable: false, minWidth: '160px',
      render: (_value, user) => (
        <Button id={`seat-technician-effective-access-${user.user_id}`} size="sm" variant="outline" className="whitespace-nowrap"
          onClick={() => setExplaining(user)}>
          {t('users.seatTechnicians.effectiveAccess', { defaultValue: 'Effective access' })}
        </Button>
      ) },
  ];

  return (
    <section id="seat-technician-users" className="mt-8 space-y-3">
      <div>
        <h3 className="text-lg font-semibold">{t('users.seatTechnicians.title', { defaultValue: 'Seat technicians' })}</h3>
        <p className="text-sm text-muted-foreground">
          {t('users.seatTechnicians.description', { defaultValue: 'People who work in your PSA through a client\'s co-managed seat. They do not count toward your licensed users.' })}
        </p>
      </div>
      {/* Paged like the staff list. LEVERAGE: friction datatable-pagination-false — DataTable still pages at
          pageSize with pagination={false} and only hides the pager, so an unpaged table silently drops rows past 10. */}
      <DataTable id="seat-technician-users-table" data={users} columns={columns} />
      {explaining && <EffectiveAccessDialog user={explaining} onClose={() => setExplaining(null)} />}
    </section>
  );
}

function EffectiveAccessDialog({ user, onClose }: { user: IUser; onClose: () => void }) {
  const { t } = useTranslation('msp/settings');
  const { t: tAdmin } = useTranslation('msp/admin');
  const [options, setOptions] = useState<TicketOption[]>([]);
  const [search, setSearch] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [checking, setChecking] = useState(false);
  const generation = useRef(0);
  const name = fullName(user);

  // The picker lists recent tickets and narrows by number or title as the administrator types.
  useEffect(() => {
    const current = ++generation.current;
    const timer = setTimeout(() => {
      void searchCoManagedSeatAccessTicketsAction({ search }).then(
        (found) => { if (generation.current === current) setOptions(found.map((ticket) => ({ value: ticket.id, label: ticket.label }))); },
        () => { if (generation.current === current) setOptions([]); },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const choose = async (next: string) => {
    setTicketId(next);
    setOutcome(null);
    if (!next) return;
    setChecking(true);
    const current = ++generation.current;
    try {
      const result = await explainCoManagedSeatTicketAccessAction({ userId: user.user_id, ticketId: next });
      if (generation.current === current) setOutcome(result.ok ? { allowed: result.allowed, explanations: result.explanations } : { error: 'unavailable' });
    } catch {
      if (generation.current === current) setOutcome({ error: 'failed' });
    } finally {
      if (generation.current === current) setChecking(false);
    }
  };

  // LEVERAGE: pattern denial-explanation-rendering — the simulator's explanation keys are localized here as in PolicyManagement; a shared renderer beside explainDenialReasons would serve both.
  const localize = (kind: 'resourceTypes' | 'actions', value?: string) =>
    value ? tAdmin(`policyManagement.${kind}.${value}`, { defaultValue: value }).toLowerCase() : '';
  const sentence = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

  return (
    <Dialog id="seat-technician-effective-access-dialog" isOpen onClose={onClose} allowOverflow
      title={t('users.seatTechnicians.dialog.title', { defaultValue: 'Effective access for {{name}}', name })}
      footer={<div className="flex justify-end"><Button id="seat-technician-effective-access-close" variant="outline" onClick={onClose}>
        {t('users.seatTechnicians.dialog.close', { defaultValue: 'Close' })}</Button></div>}>
      <DialogContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('users.seatTechnicians.dialog.help', { defaultValue: 'Choose a ticket to see whether this seat technician can read it, and why.' })}
          </p>
          <TicketSelect
            label={t('users.seatTechnicians.dialog.ticket', { defaultValue: 'Ticket' })}
            options={options}
            value={ticketId}
            onValueChange={(next) => void choose(next)}
            searchValue={search}
            onSearchChange={setSearch}
            placeholder={t('users.seatTechnicians.dialog.ticketPlaceholder', { defaultValue: 'Select a ticket...' })}
          />
          <div id="seat-technician-effective-access-result" aria-live="polite">
            {checking && <p className="text-sm text-muted-foreground">{t('users.seatTechnicians.dialog.checking', { defaultValue: 'Checking access...' })}</p>}
            {!checking && outcome && 'error' in outcome && (
              <Alert variant="destructive"><AlertDescription id="seat-technician-effective-access-error">
                {outcome.error === 'unavailable'
                  ? t('users.seatTechnicians.dialog.unavailable', { defaultValue: 'Effective access cannot be checked for this ticket in this edition or setup.' })
                  : t('users.seatTechnicians.dialog.error', { defaultValue: 'Could not check access. Try again.' })}
              </AlertDescription></Alert>
            )}
            {!checking && outcome && 'allowed' in outcome && outcome.allowed && (
              <Alert variant="success"><AlertDescription id="seat-technician-effective-access-allowed">
                {t('users.seatTechnicians.dialog.allowed', { defaultValue: '{{name}} can read this ticket.', name })}
              </AlertDescription></Alert>
            )}
            {!checking && outcome && 'allowed' in outcome && !outcome.allowed && (
              <div className="space-y-2">
                <Alert variant="destructive"><AlertDescription id="seat-technician-effective-access-denied">
                  {t('users.seatTechnicians.dialog.denied', { defaultValue: '{{name}} cannot read this ticket.', name })}
                </AlertDescription></Alert>
                <ul id="seat-technician-effective-access-reasons" className="list-disc space-y-1 pl-5 text-sm">
                  {outcome.explanations.map((explanation) => (
                    <li key={explanation.code} id={`seat-technician-effective-access-reason-${explanation.kind}`}>
                      {sentence(tAdmin(explanation.messageKey, {
                        resource: localize('resourceTypes', explanation.params.resource),
                        action: localize('actions', explanation.params.action),
                        requiredAction: localize('actions', explanation.params.requiredAction),
                      }))}
                    </li>
                  ))}
                  {outcome.explanations.length === 0 && (
                    <li>{t('users.seatTechnicians.dialog.noReasons', { defaultValue: 'No further detail was reported.' })}</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
