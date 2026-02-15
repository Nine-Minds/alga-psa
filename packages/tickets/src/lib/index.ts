export { createTicketColumns } from './ticket-columns';
export { calculateItilPriority, ItilLabels } from './itilUtils';
export { getCommentResponseSource, getLatestCustomerResponseSource } from './responseSource';
export { resolveCommentAuthor } from './commentAuthorResolution';
export type {
  CommentContactAuthor,
  CommentUserAuthor,
  ResolvedCommentAuthor,
} from './commentAuthorResolution';
export { getTicketOrigin, TICKET_ORIGIN_OTHER } from './ticketOrigin';
export type { ResolvedTicketOrigin } from './ticketOrigin';
