'use client';
import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { IComment } from '@alga-psa/types';

export interface TicketConversationAttachmentsProps { ticketId: string; comment: IComment }
const Context = createContext<ComponentType<TicketConversationAttachmentsProps> | null>(null);
/** Application composition supplies additional comment-scoped attachments. */
export function TicketConversationAttachmentsProvider({ component, children }: { component: ComponentType<TicketConversationAttachmentsProps>; children: ReactNode }) {
  return <Context.Provider value={component}>{children}</Context.Provider>;
}
export function TicketConversationAttachments(props: TicketConversationAttachmentsProps) {
  const Component = useContext(Context);
  if (!Component || !props.comment.comment_id || !props.comment.thread_id || props.comment.deleted_at) return null;
  return <Component {...props} />;
}
