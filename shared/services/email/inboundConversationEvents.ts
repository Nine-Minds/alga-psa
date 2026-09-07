import type { Knex } from 'knex';
/** Internal composition for native writers. The receiver owns durable current-
 * source publication; true means the native publisher must not also enqueue it. */
export type InboundConversationEventRetainer = (trx: Knex.Transaction, input: {
  tenant: string; eventId: string; ticketId: string; commentId: string;
  payload: Record<string, any>; channel?: 'internal-notifications';
}, publish: (event: { eventType: string; payload: Record<string, any>; channel?: 'internal-notifications' }, eventId: string) => Promise<void>) => Promise<boolean>;
