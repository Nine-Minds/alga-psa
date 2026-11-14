import { registerUiSlot } from '@alga-psa/ui/capability/uiSlotRegistry';

/**
 * L4b's conversation UI, contributed as data through the `ticket.conversation.*` slots, so it exists only while
 * `co-managed` is served. A host (the ticket conversation) resolves a slot and mounts the named component;
 * a host that does not resolve these slots renders the base conversation unchanged.
 *  - comment-attachments: per-comment file list / upload / removal (MSP) and the read-only list (portal).
 *  - thread-header: the disclosure control on the audience control; opens the preview dialog.
 */
export interface ConversationSlotProps { component: 'CoManagedCommentAttachments' | 'CoManagedPortalAttachments' | 'CoManagedThreadDisclosure' }

registerUiSlot<ConversationSlotProps>('ticket.conversation.comment-attachments', {
  id: 'co-managed.comment-attachments', capability: 'co-managed', order: 40, props: { component: 'CoManagedCommentAttachments' } });
registerUiSlot<ConversationSlotProps>('ticket.conversation.comment-attachments', {
  id: 'co-managed.portal-attachments', capability: 'co-managed', order: 41, props: { component: 'CoManagedPortalAttachments' } });
registerUiSlot<ConversationSlotProps>('ticket.conversation.thread-header', {
  id: 'co-managed.thread-disclosure', capability: 'co-managed', order: 40, props: { component: 'CoManagedThreadDisclosure' } });
