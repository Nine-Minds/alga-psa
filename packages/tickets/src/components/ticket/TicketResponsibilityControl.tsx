'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IUser } from '@alga-psa/types';
import { useTicketDataSource } from './TicketDataSourceContext';
import { seatResponsibilityLabel } from '../../lib/seatResponsibilityLabel';
import type { TicketResponsibilityState } from '../../lib/ticketResponsibility';
import { ticketResponsibilityVisibility } from '../../lib/ticketResponsibilityVisibility';

interface TicketResponsibilityControlProps {
  ticketId: string;
  /** From the server. Absent: the ticket's client has no live arrangement or the seat shape is not released. */
  state?: TicketResponsibilityState | null;
  /** Called with the refreshed state after a handoff, so the screen's chip follows. */
  onChange?: (state: TicketResponsibilityState) => void;
}

/**
 * Who is responsible for the ticket (Client IT or MSP) and, while the MSP holds it, the action that
 * hands it to client IT with a required shared note and an optional named seat technician.
 */
export default function TicketResponsibilityControl({ ticketId, state: initialState, onChange }: TicketResponsibilityControlProps) {
  const { t } = useTranslation('features/tickets');
  const { responsibility } = useTicketDataSource();
  const [state, setState] = useState<TicketResponsibilityState | null>(initialState ?? null);
  // The screen re-fetches (refresh, live update after the seat technician hands the ticket back): follow the
  // prop whenever what it says changes. Between prop updates only the action's own result overrides it.
  const technicianKey = (initialState?.technicians ?? []).map((technician) => technician.user_id).join(',');
  useEffect(() => {
    setState(initialState ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the content of the prop, not its identity
  }, [initialState?.revision, initialState?.responsibility, technicianKey, initialState == null]);
  const [isOpen, setIsOpen] = useState(false);
  const [note, setNote] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One key per opening of the dialog: a retry of the same submission returns the original receipt.
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());

  // A data source without the group (a ticket of another tenant) has no responsibility to show.
  const visibility = ticketResponsibilityVisibility(responsibility ? state : null);

  // The picker lists the arrangement's seat technicians by name; an id is only the value it returns.
  const technicianUsers = useMemo(() => (state?.technicians ?? []).map((technician) => ({
    user_id: technician.user_id,
    first_name: technician.display_name,
    last_name: '',
    user_type: 'internal',
  }) as unknown as IUser), [state?.technicians]);

  const open = useCallback(() => {
    setNote('');
    setTechnicianId('');
    setOperationId(crypto.randomUUID());
    setIsOpen(true);
  }, []);

  const submit = useCallback(async () => {
    if (!responsibility || !state || !note.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await responsibility.handTicketToClientIt({
        ticketId, expectedRevision: state.revision, note, technicianUserId: technicianId || null, operationId,
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      setState(result.state);
      onChange?.(result.state);
      setIsOpen(false);
      toast.success(t('seatResponsibility.handedToClientIt', 'Handed to client IT'));
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, note, onChange, operationId, responsibility, state, t, technicianId, ticketId]);

  if (!state || !visibility.chip) return null;

  return (
    <>
      <span className="inline-flex items-center gap-2 flex-shrink-0" id="ticket-responsibility">
        <Badge
          id="ticket-responsibility-chip"
          variant={state.responsibility === 'client_it' ? 'info' : 'default-muted'}
          size="sm"
          title={t('seatResponsibility.chipTitle', 'Who is responsible for this ticket')}
        >
          {t('seatResponsibility.label', 'Responsible')}: {seatResponsibilityLabel(t, state.responsibility)}
        </Badge>
        {visibility.handoff && (
          <Button id="ticket-hand-to-client-it" type="button" variant="outline" size="xs" onClick={open}>
            {t('seatResponsibility.handToClientIt', 'Hand to client IT')}
          </Button>
        )}
      </span>
      <Dialog
        id="ticket-hand-to-client-it-dialog"
        isOpen={isOpen}
        onClose={() => !isSubmitting && setIsOpen(false)}
        title={t('seatResponsibility.handToClientIt', 'Hand to client IT')}
        className="max-w-lg"
        footer={(
          <div className="flex justify-end gap-2">
            <Button id="ticket-hand-to-client-it-cancel" type="button" variant="outline" disabled={isSubmitting} onClick={() => setIsOpen(false)}>
              {t('actions.cancel', 'Cancel')}
            </Button>
            <Button id="ticket-hand-to-client-it-confirm" type="button" disabled={!note.trim() || isSubmitting} onClick={() => void submit()}>
              {isSubmitting ? t('seatResponsibility.handing', 'Handing over…') : t('seatResponsibility.handToClientIt', 'Hand to client IT')}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-[rgb(var(--color-text-600))]">
              {t('seatResponsibility.handPrompt', "Client IT becomes responsible for this ticket and your SLA timers pause until it comes back. The note is shared with the client's technicians.")}
            </p>
            <TextArea
              id="ticket-hand-to-client-it-note"
              label={t('seatResponsibility.noteLabel', 'Shared note for client IT')}
              required
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={5}
              maxLength={10000}
            />
            <UserPicker
              id="ticket-hand-to-client-it-technician"
              label={t('seatResponsibility.technicianLabel', 'Technician (optional)')}
              value={technicianId}
              onValueChange={setTechnicianId}
              users={technicianUsers}
              placeholder={t('seatResponsibility.technicianPlaceholder', 'Any technician of this client')}
              unassignedLabel={t('seatResponsibility.technicianNone', 'Leave the assignee as it is')}
              buttonWidth="full"
              modal
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
