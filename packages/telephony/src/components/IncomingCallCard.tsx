'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { Phone, X } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IncomingCallPayload } from '../types/incomingCall';

export const INCOMING_CALL_AUTO_CLOSE_MS = 60_000;

export interface IncomingCallCardProps {
  call: IncomingCallPayload;
  onDismiss: () => void;
  onNewTicket: (call: IncomingCallPayload) => void;
  onCreateContact: (call: IncomingCallPayload) => void;
  autoCloseMs?: number;
}

/**
 * Floating, non-modal caller context shown while an extension rings. Rendered
 * above the toaster (which sits at z 999999) so an overlay never hides it.
 */
export function IncomingCallCard({
  call,
  onDismiss,
  onNewTicket,
  onCreateContact,
  autoCloseMs = INCOMING_CALL_AUTO_CLOSE_MS,
}: IncomingCallCardProps) {
  const { t } = useTranslation('msp/integrations');
  const { formatDate } = useFormatters();

  useEffect(() => {
    const timer = setTimeout(onDismiss, autoCloseMs);
    return () => clearTimeout(timer);
    // A new call (keyed by callId) restarts the countdown; a re-rendered handler must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.callId, autoCloseMs]);

  const contact = call.contact ?? null;
  const client = call.client ?? null;
  const tickets = call.tickets ?? [];
  const interactions = call.interactions ?? [];
  const callerName = call.callerName || contact?.name || null;

  return (
    <Card
      id="incoming-call-card"
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[1000000] w-[calc(100vw-2rem)] max-w-sm p-4 shadow-xl"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--color-primary-500))] text-white">
          <Phone className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-[rgb(var(--color-text-500))]">
            {t('telephony.incomingCall.title', { defaultValue: 'Incoming call' })}
          </p>
          <p id="incoming-call-caller-name" className="truncate text-base font-semibold text-[rgb(var(--color-text-900))]">
            {callerName ?? t('telephony.incomingCall.unknownCaller', { defaultValue: 'Unknown caller' })}
          </p>
          <p id="incoming-call-number" className="text-sm text-[rgb(var(--color-text-700))]">
            {call.number || call.numberE164 || t('telephony.incomingCall.noNumber', { defaultValue: 'No caller ID' })}
          </p>
          {client && (
            <p id="incoming-call-client-name" className="truncate text-sm text-[rgb(var(--color-text-700))]">
              {client.name}
            </p>
          )}
          <p id="incoming-call-extension" className="text-xs text-[rgb(var(--color-text-500))]">
            {t('telephony.incomingCall.extension', { defaultValue: 'Ringing extension {{dn}}', dn: call.dn })}
          </p>
        </div>
        <Button
          id="incoming-call-dismiss"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          aria-label={t('telephony.incomingCall.dismiss', { defaultValue: 'Dismiss' })}
          onClick={onDismiss}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {contact && (
        <div className="mt-3 space-y-3 border-t border-[rgb(var(--color-border-200))] pt-3 text-sm">
          {contact.email && (
            <p id="incoming-call-contact-email" className="truncate text-[rgb(var(--color-text-700))]">
              {contact.email}
            </p>
          )}
          {tickets.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-[rgb(var(--color-text-500))]">
                {t('telephony.incomingCall.openTickets', { defaultValue: 'Open tickets' })}
              </p>
              <ul id="incoming-call-tickets" className="space-y-1">
                {tickets.map((ticket) => (
                  <li key={ticket.id} className="truncate">
                    <Link
                      id={`incoming-call-ticket-${ticket.id}`}
                      href={`/msp/tickets/${ticket.id}`}
                      className="text-[rgb(var(--color-primary-600))] hover:underline"
                    >
                      #{ticket.number} {ticket.title}
                    </Link>
                    {ticket.status && (
                      <span className="ml-1 text-xs text-[rgb(var(--color-text-500))]">({ticket.status})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {interactions.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-[rgb(var(--color-text-500))]">
                {t('telephony.incomingCall.recentInteractions', { defaultValue: 'Recent interactions' })}
              </p>
              <ul id="incoming-call-interactions" className="space-y-1">
                {interactions.map((interaction) => (
                  <li
                    key={interaction.id}
                    id={`incoming-call-interaction-${interaction.id}`}
                    className="truncate text-[rgb(var(--color-text-700))]"
                  >
                    {interaction.type ? `${interaction.type}: ` : ''}
                    {interaction.title}
                    <span className="ml-1 text-xs text-[rgb(var(--color-text-500))]">
                      {formatDate(interaction.date, { dateStyle: 'medium' })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {contact ? (
          <>
            <Button id="incoming-call-open-contact" variant="outline" size="sm" asChild>
              <Link href={`/msp/contacts/${contact.id}`}>
                {t('telephony.incomingCall.openContact', { defaultValue: 'Open contact' })}
              </Link>
            </Button>
            {client && (
              <Button id="incoming-call-open-client" variant="outline" size="sm" asChild>
                <Link href={`/msp/clients/${client.id}`}>
                  {t('telephony.incomingCall.openClient', { defaultValue: 'Open client' })}
                </Link>
              </Button>
            )}
            <Button id="incoming-call-new-ticket" size="sm" onClick={() => onNewTicket(call)}>
              {t('telephony.incomingCall.newTicket', { defaultValue: 'New ticket' })}
            </Button>
          </>
        ) : (
          <>
            {client && (
              <Button id="incoming-call-open-client" variant="outline" size="sm" asChild>
                <Link href={`/msp/clients/${client.id}`}>
                  {t('telephony.incomingCall.openClient', { defaultValue: 'Open client' })}
                </Link>
              </Button>
            )}
            <Button id="incoming-call-create-contact" size="sm" onClick={() => onCreateContact(call)}>
              {t('telephony.incomingCall.createContact', { defaultValue: 'Create contact' })}
            </Button>
          </>
        )}
        <Button id="incoming-call-dismiss-action" variant="ghost" size="sm" onClick={onDismiss}>
          {t('telephony.incomingCall.dismiss', { defaultValue: 'Dismiss' })}
        </Button>
      </div>
    </Card>
  );
}

export default IncomingCallCard;
