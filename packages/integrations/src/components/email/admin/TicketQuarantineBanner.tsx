'use client';

/**
 * Staff-only banner for the MSP ticket detail view: "N inbound emails to this
 * ticket were quarantined", linking to the queue filtered to this ticket.
 *
 * MSP-only by construction: it is rendered solely from the MSP ticket page
 * (server/src/app/msp/tickets/[id]/page.tsx), and the backing action rejects
 * client-portal users and non-internal users (internal + ticket:read required). It is not
 * imported by anything under the client portal.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getOpenQuarantineCountForTicket } from '../../../actions/email-actions/inboundQuarantineActions';

export function TicketQuarantineBanner({ ticketId }: { ticketId: string }) {
  const { t } = useTranslation('msp/email-providers');
  const [count, setCount] = useState(0);
  const [canOpenQueue, setCanOpenQueue] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getOpenQuarantineCountForTicket(ticketId)
      .then((result) => {
        if (cancelled || isActionPermissionError(result) || isActionMessageError(result)) return;
        const ok = result as { count: number; canOpenQueue: boolean };
        setCount(ok.count);
        setCanOpenQueue(ok.canOpenQueue);
      })
      .catch(() => undefined); // advisory banner: never break the ticket view
    return () => { cancelled = true; };
  }, [ticketId]);

  if (count <= 0) return null;

  return (
    <Alert id="ticket-inbound-quarantine-banner" variant="warning" className="mb-3">
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span>
          {t('quarantine.banner', {
            count,
            defaultValue: '{{count}} inbound emails to this ticket were quarantined',
          })}
        </span>
        {canOpenQueue ? (
          <Link
            href={`/msp/settings/email/quarantine?ticketId=${encodeURIComponent(ticketId)}`}
            className="font-medium underline"
          >
            {t('quarantine.bannerLink', { defaultValue: 'Review quarantined email' })}
          </Link>
        ) : (
          <span>{t('quarantine.bannerAskAdmin', { defaultValue: 'Ask an email administrator to review them.' })}</span>
        )}
      </AlertDescription>
    </Alert>
  );
}

export default TicketQuarantineBanner;
