'use client';

import { useMemo } from 'react';
import { useCapability } from '@alga-psa/ui/hooks/useCapability';
import { composeTicketDataSource, type TicketDataSource } from '../lib/ticketDataSource';
import { seatConversationConfig, type SeatTicketViewer } from '../lib/seatTicketConversation';

export interface SeatTicketFacts {
  viewer: SeatTicketViewer;
  arrangement: boolean;
  clientTechnicians: string[];
}

/**
 * The seat facts of a ticket, and the audience composer they bring, held behind `co-managed-seat`.
 * With the capability closed (or the ticket outside a live arrangement) there is no seat ticket and no
 * composed data source: the ticket screen is the ordinary one, whatever the server payload carried.
 *
 * On a client's live seat arrangement the composer offers audiences in place of the Internal toggle:
 * MSP staff choose among Requester, Shared IT and Private (default Private); a seat technician among
 * Requester and Shared IT only, defaulting to Shared IT (the narrower of the two, so an unattended default
 * never reaches the requester). A source that already names audiences (a shared ticket, a co-managed
 * workspace) keeps its own.
 */
export function useSeatTicket(
  facts: SeatTicketFacts | null | undefined,
  dataSource: TicketDataSource,
  privateLabel: string,
) {
  const { enabled } = useCapability('co-managed-seat');
  const seatTicket = facts?.arrangement && enabled ? facts : null;
  const seatDataSource = useMemo(() => {
    if (!seatTicket || dataSource.conversation.audiences) return null;
    return composeTicketDataSource(dataSource, {
      conversation: seatConversationConfig(seatTicket.viewer, privateLabel),
    });
  }, [dataSource, seatTicket, privateLabel]);
  return { seatTicket, seatDataSource };
}
