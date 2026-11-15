'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IUser } from '@alga-psa/types';
import {
  bulkHandTicketsToClientIt,
  bulkHandTicketsToMsp,
  getBulkHandoffTechnicians,
} from '../actions/ticketResponsibilityActions';
import type { BulkHandoffFailure, BulkHandoffTicket } from '../lib/bulkHandoff';
import { summarizeBulkHandoff } from '../lib/bulkHandoff';
import type { TicketHandoffDirection } from '../lib/ticketResponsibility';

export type { BulkHandoffTicket };

interface BulkHandoffDialogProps {
  id: string;
  isOpen: boolean;
  direction: TicketHandoffDirection;
  tickets: BulkHandoffTicket[];
  onClose: () => void;
  /** Some or all tickets were handed over: refresh the list (and with it the responsibility chips). */
  onHandedOver: (handedOverTicketIds: string[], failedTicketIds: string[]) => void;
}

/**
 * Hand the selected tickets to client IT (MSP staff) or to the MSP (a seat technician): one required shared note for
 * every ticket and, going to client IT, an optional named technician. Each ticket is checked and handed over on its
 * own by the server; the dialog names every ticket that was refused, by number or title, with the reason.
 */
export default function BulkHandoffDialog({ id, isOpen, direction, tickets, onClose, onHandedOver }: BulkHandoffDialogProps) {
  const { t } = useTranslation('features/tickets');
  const [note, setNote] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [technicians, setTechnicians] = useState<Array<{ user_id: string; display_name: string }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failures, setFailures] = useState<Array<{ ticketId: string } & BulkHandoffFailure>>([]);
  // One key per opening of the dialog: submitting the same selection again (a lost response) replays each ticket's receipt.
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const ticketIds = useMemo(() => tickets.map((ticket) => ticket.ticket_id), [tickets]);
  const ticketIdKey = ticketIds.join(',');
  const toClientIt = direction === 'client_it';

  useEffect(() => {
    if (!isOpen) return;
    setNote('');
    setTechnicianId('');
    setFailures([]);
    setSubmissionId(crypto.randomUUID());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on opening only; the selection may shrink while open
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !toClientIt || ticketIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await getBulkHandoffTechnicians(ticketIds);
        if (cancelled) return;
        setTechnicians(isActionMessageError(result) || isActionPermissionError(result) ? [] : result.technicians);
      } catch {
        if (!cancelled) setTechnicians([]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the selection's content
  }, [isOpen, toClientIt, ticketIdKey]);

  // The picker lists technicians by name; an id is only the value it returns.
  const technicianUsers = useMemo(() => technicians.map((technician) => ({
    user_id: technician.user_id,
    first_name: technician.display_name,
    last_name: '',
    user_type: 'internal',
  }) as unknown as IUser), [technicians]);

  const labelOf = useCallback((ticketId: string) => {
    const ticket = tickets.find((candidate) => candidate.ticket_id === ticketId);
    // Never an id: a ticket the list does not know is named generically.
    return ticket?.ticket_number || ticket?.title || t('bulk.handoff.unknownTicket', 'Ticket');
  }, [t, tickets]);

  const submit = useCallback(async () => {
    if (!note.trim() || isSubmitting || tickets.length === 0) return;
    setIsSubmitting(true);
    setFailures([]);
    try {
      // A ticket whose row state was never loaded (selected off the page) has no revision to name: it is not submitted.
      const loaded = tickets.filter((ticket) => typeof ticket.seat_responsibility_revision === 'number');
      const unloaded = tickets.filter((ticket) => typeof ticket.seat_responsibility_revision !== 'number');
      const localFailures = unloaded.map((ticket) => ({
        ticketId: ticket.ticket_id,
        message: t('bulk.handoff.rowNotLoaded', "This ticket's current state is not loaded. Open its page of the list and try again."),
      }));
      const input = {
        tickets: loaded.map((ticket) => ({ ticketId: ticket.ticket_id, expectedRevision: ticket.seat_responsibility_revision as number })),
        note,
        technicianUserId: toClientIt ? technicianId || null : null,
        submissionId,
      };
      const result = loaded.length === 0
        ? { results: [] }
        : await (toClientIt ? bulkHandTicketsToClientIt(input) : bulkHandTicketsToMsp(input));
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      const summary = summarizeBulkHandoff(result.results);
      const failed = [...summary.failed, ...localFailures];
      if (summary.succeeded.length > 0) {
        toast.success(t('bulk.handoff.success', {
          count: summary.succeeded.length,
          defaultValue: summary.succeeded.length === 1 ? '{{count}} ticket handed over' : '{{count}} tickets handed over',
        }));
      }
      if (failed.length > 0) {
        setFailures(failed);
        toast.error(t('bulk.handoff.partialFailure', 'Some tickets could not be handed over'));
      }
      onHandedOver(summary.succeeded, failed.map((failure) => failure.ticketId));
      if (failed.length === 0) onClose();
    } catch (error) {
      toast.error(getErrorMessage(error) || t('bulk.handoff.failure', 'Failed to hand over the selected tickets'));
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, note, onClose, onHandedOver, submissionId, t, technicianId, tickets, toClientIt]);

  const title = toClientIt
    ? t('seatResponsibility.handToClientIt', 'Hand to client IT')
    : t('seatResponsibility.handToMsp', 'Hand to MSP');

  return (
    <Dialog
      id={`${id}-bulk-handoff-dialog`}
      isOpen={isOpen}
      onClose={() => !isSubmitting && onClose()}
      title={title}
      className="max-w-lg"
      footer={(
        <div className="flex justify-end gap-2">
          <Button id={`${id}-bulk-handoff-cancel`} type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>
            {t('actions.cancel', 'Cancel')}
          </Button>
          <Button id={`${id}-bulk-handoff-confirm`} type="button" disabled={!note.trim() || isSubmitting || tickets.length === 0} onClick={() => void submit()}>
            {isSubmitting ? t('seatResponsibility.handing', 'Handing over…') : title}
          </Button>
        </div>
      )}
    >
      <DialogContent>
        <div className="space-y-4">
          {failures.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <p className="font-medium">{t('bulk.handoff.failedItemsHeading', 'The following tickets could not be handed over:')}</p>
                <ul className="mt-2 space-y-1">
                  {failures.map((failure) => (
                    <li key={failure.ticketId}>
                      <span className="font-medium">{labelOf(failure.ticketId)}</span>: {failure.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            {toClientIt
              ? t('bulk.handoff.promptToClientIt', {
                count: tickets.length,
                defaultValue: tickets.length === 1
                  ? "Client IT becomes responsible for this ticket. The note is shared with the client's technicians. A ticket that cannot be handed over is left as it is."
                  : "Client IT becomes responsible for each of these {{count}} tickets. The note is shared with the client's technicians. A ticket that cannot be handed over is left as it is.",
              })
              : t('bulk.handoff.promptToMsp', {
                count: tickets.length,
                defaultValue: tickets.length === 1
                  ? 'The MSP becomes responsible for this ticket. The note is shared with the MSP. A ticket that cannot be handed over is left as it is.'
                  : 'The MSP becomes responsible for each of these {{count}} tickets. The note is shared with the MSP. A ticket that cannot be handed over is left as it is.',
              })}
          </p>
          <TextArea
            id={`${id}-bulk-handoff-note`}
            label={toClientIt ? t('seatResponsibility.noteLabel', 'Shared note for client IT') : t('seatResponsibility.noteLabelMsp', 'Shared note for the MSP')}
            required
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={5}
            maxLength={10000}
          />
          {toClientIt && (
            <UserPicker
              id={`${id}-bulk-handoff-technician`}
              label={t('seatResponsibility.technicianLabel', 'Technician (optional)')}
              value={technicianId}
              onValueChange={setTechnicianId}
              users={technicianUsers}
              placeholder={t('seatResponsibility.technicianPlaceholder', 'Any technician of this client')}
              unassignedLabel={t('seatResponsibility.technicianNone', 'Leave the assignee as it is')}
              buttonWidth="full"
              modal
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
