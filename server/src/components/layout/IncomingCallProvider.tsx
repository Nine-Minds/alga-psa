'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { isEnterprise } from '@alga-psa/core/features';
import { useInternalNotifications } from '@alga-psa/notifications/hooks/useInternalNotifications';
import { IncomingCallCard } from '@alga-psa/telephony/components';
import { buildCreateTicketHref } from '@alga-psa/tickets/lib/createTicketRoute';
import { buildCreateContactHref } from '@alga-psa/clients/lib/createContactRoute';
import type { IncomingCallPayload } from '@alga-psa/telephony/types';
import { answerThreecxCall } from '@alga-psa/integrations/actions/integrations/telephonyActions';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

function IncomingCallSurface({ tenant, userId }: { tenant: string; userId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useTranslation('msp/integrations');
  const { incomingCall, dismissIncomingCall } = useInternalNotifications({
    tenant,
    userId,
    limit: 1,
    enablePolling: false,
  });

  // The quick-add dialogs live behind the app-wide create routes, which mount
  // them inside the workspace provider tree this shell-level surface sits above.
  const openNewTicket = React.useCallback(
    (call: IncomingCallPayload) => {
      dismissIncomingCall();
      router.push(
        buildCreateTicketHref({
          client: call.client ?? undefined,
          contact: call.contact ? { id: call.contact.id, name: call.contact.name } : undefined,
        }),
      );
    },
    [dismissIncomingCall, router],
  );

  const openCreateContact = React.useCallback(
    (call: IncomingCallPayload) => {
      dismissIncomingCall();
      router.push(
        buildCreateContactHref({
          clientId: call.client?.id,
          phone: call.numberE164 ?? call.number ?? undefined,
        }),
      );
    },
    [dismissIncomingCall, router],
  );

  const answer = React.useCallback(
    async (call: IncomingCallPayload) => {
      // The PBX's Connected event closes the card; on failure it stays up.
      const result = await answerThreecxCall({ dn: call.dn, participantId: call.participantId }).catch(
        (error: unknown) => ({ success: false, message: error instanceof Error ? error.message : String(error) }),
      );
      if (!result.success) {
        toast({
          variant: 'destructive',
          title: t('telephony.incomingCall.answerFailed', { defaultValue: 'The PBX could not answer the call' }),
          description: result.message,
        });
      }
    },
    [t, toast],
  );

  const call = incomingCall?.event === 'ringing' ? incomingCall.call : null;
  if (!call) return null;

  return (
    <IncomingCallCard
      key={call.callId}
      call={call}
      onDismiss={dismissIncomingCall}
      onNewTicket={openNewTicket}
      onCreateContact={openCreateContact}
      onAnswer={answer}
    />
  );
}

/**
 * Mounts the 3CX incoming-call card for the signed-in agent. Enterprise-only:
 * CE never opens the notification socket for it.
 */
export function IncomingCallProvider({
  tenant,
  userId,
  children,
}: {
  tenant: string | null | undefined;
  userId: string | null | undefined;
  children: React.ReactNode;
}) {

  return (
    <>
      {children}
      {isEnterprise && tenant && userId && <IncomingCallSurface tenant={tenant} userId={userId} />}
    </>
  );
}

export default IncomingCallProvider;
