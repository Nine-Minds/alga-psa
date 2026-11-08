/** Props a host passes to a `ticket.conversation.*` slot component. Structural, so the host
 * needs no import from co-managed and co-managed none from the host's component tree. */
export interface TicketConversationAttachmentsProps {
  ticketId: string;
  comment: { tenant?: string; ticket_id?: string; thread_id?: string | null; comment_id?: string | null; deleted_at?: string | Date | null };
}
