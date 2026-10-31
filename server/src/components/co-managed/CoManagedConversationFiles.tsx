'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import { resolveUiSlots } from '@alga-psa/ui/capability/uiSlotRegistry';
import { useCapability } from '@alga-psa/ui/hooks';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import '@/config/coManagedConversationSlots';
import { coManagedAttachmentUploadLimit } from '@/lib/co-managed/attachmentUploadLimit';
import type { AttachmentStaging } from '@/lib/co-managed/attachmentStaging';
import { registerCoManagedAttachmentStager } from './attachmentFileStager';
import type { SharedConversationSession } from './sharedConversationSession';
import SharedCommentAttachmentPicker from './SharedCommentAttachmentPicker';
import CoManagedCommentAttachments from './CoManagedCommentAttachments';
import CoManagedThreadDisclosure from './CoManagedThreadDisclosure';
import CoManagedDraftRestore from './CoManagedDraftRestore';

/** The MSP-side components a `ticket.conversation.*` contribution may name. Unknown names (the portal's) are skipped. */
const COMPONENTS: Record<string, ComponentType<any>> = {
  CoManagedCommentAttachments,
  CoManagedThreadDisclosure,
};
const MAX_FILES = 20;

/**
 * The co-managed host for the conversation's file and disclosure surfaces. The base ticket screen
 * is not forked: this panel sits beside it, inside the co-managed shared-ticket / local-ticket
 * wrappers, resolves `ticket.conversation.comment-attachments` per comment and
 * `ticket.conversation.thread-header` per thread, and offers the composer's file picker.
 * It registers the file stager here so a native ticket page never does.
 */
// LEVERAGE: friction conversation-inline-slots — TicketConversation/CommentItem have no per-comment slot, so files and the
// disclosure control render in this panel beside the conversation instead of inside each comment bubble.
export default function CoManagedConversationFiles({ session, resource, staging }: {
  session: SharedConversationSession; resource: CoManagedSharedResource; staging: AttachmentStaging;
}) {
  const { t } = useTranslation('msp/licensing');
  const { enabled } = useCapability('co-managed');
  useEffect(() => { registerCoManagedAttachmentStager(); }, []);
  const served = useMemo(() => new Set(enabled ? ['co-managed' as const] : []), [enabled]);
  const commentSlots = useMemo(() => resolveUiSlots<{ component: string }>('ticket.conversation.comment-attachments', served), [served]);
  const headerSlots = useMemo(() => resolveUiSlots<{ component: string }>('ticket.conversation.thread-header', served), [served]);
  const [disclosing, setDisclosing] = useState<string | null>(null);
  // Re-render whenever the session finishes a load: the files panel follows the conversation, not a host-passed counter.
  const version = useSyncExternalStore(session.subscribe, session.version, session.version);
  const staged = useSyncExternalStore(staging.subscribe, staging.getSnapshot, staging.getSnapshot);
  const snapshot = session.snapshot();
  const unsent = session.unsentFailure();
  if (!enabled || !snapshot) return null;
  const items = snapshot.items.filter(item => !item.deleted);
  const threads = [...new Set(items.map(item => `${item.storeTenant}:${item.threadId}`))];
  const writeAudiences = session.writeAudiences();
  const maxBytes = coManagedAttachmentUploadLimit();
  void staged;
  return <section id="co-managed-conversation-files" className="space-y-4 p-4">
    {writeAudiences.length > 0 && <CoManagedDraftRestore resource={resource} version={version} onPublished={() => { void session.load(); }} />}
    {unsent && <Alert variant="destructive" role="alert"><AlertDescription>{t(['forbidden', 'readOnly', 'invalid', 'operationConflict'].includes(unsent.code)
      ? `coManaged.editor.errors.${unsent.code}` : 'coManaged.conversation.drafts.unsent')}</AlertDescription></Alert>}
    {writeAudiences.length > 0 && <SharedCommentAttachmentPicker staging={staging} limits={{ maxBytes, maxFiles: MAX_FILES }}
      attachable={writeAudiences.length > 0} disabled={false} />}
    {threads.map(key => {
      const thread = items.filter(item => `${item.storeTenant}:${item.threadId}` === key);
      const root = thread[0];
      const ref = { storeTenant: root.storeTenant, threadId: root.threadId };
      return <div key={key} id={`co-managed-thread-${root.threadId}-files`} className="space-y-2">
        {headerSlots.map(slot => {
          const Slot = COMPONENTS[slot.props?.component ?? ''];
          if (!Slot) return null;
          return <div key={slot.id}>
            <Button id={`co-managed-thread-${root.threadId}-disclose`} variant="outline" size="sm" onClick={() => setDisclosing(key)}>
              {t('coManaged.disclosure.open', { defaultValue: 'Change who can see this thread' })}
            </Button>
            {disclosing === key && <Slot resource={resource} thread={ref} actor={{ tenant: snapshot.actor.tenant, userId: snapshot.actor.userId }}
              audiences={[...writeAudiences]} onClosed={() => setDisclosing(null)}
              onSaved={() => { setDisclosing(null); void session.load(); }} />}
          </div>;
        })}
        {thread.map(item => commentSlots.map(slot => {
          const Slot = COMPONENTS[slot.props?.component ?? ''];
          return Slot ? <Slot key={`${slot.id}:${item.commentId}`} resource={resource}
            comment={{ storeTenant: item.storeTenant, threadId: item.threadId, commentId: item.commentId }} /> : null;
        }))}
      </div>;
    })}
  </section>;
}
