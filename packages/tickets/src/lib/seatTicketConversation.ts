import type { TicketConversationConfig } from './ticketDataSource';

/** Who is reading a ticket of a live seat arrangement: MSP staff, or the client's seat technician. */
export type SeatTicketViewer = 'msp' | 'client_it';

/**
 * The composer a viewer gets on a ticket whose client has a live seat arrangement, in place of the
 * Internal toggle.
 *
 * - MSP staff choose among Requester, Shared IT and Private, starting on Private.
 * - A seat technician chooses between Requester and Shared IT and is never offered Private. It
 *   starts on Shared IT: the narrower of the two, so a comment posted without a second look reaches
 *   the MSP rather than the requester. (Server-side visibility and write rules are enforced
 *   independently of this list; see `shared/lib/commentAudience.ts`.)
 *
 * `privateLabel` is the translated display name for the Private audience.
 */
export function seatConversationConfig(viewer: SeatTicketViewer, privateLabel: string): TicketConversationConfig {
  const msp = viewer === 'msp';
  return {
    audiences: msp ? ['requester', 'shared_it', 'organization_private'] : ['requester', 'shared_it'],
    defaultAudience: msp ? 'organization_private' : 'shared_it',
    audienceLabels: { organization_private: privateLabel },
  };
}
