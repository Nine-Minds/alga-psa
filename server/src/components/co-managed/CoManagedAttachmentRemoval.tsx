'use client';
import { useEffect, useRef, useState } from 'react';
import type { CoManagedSharedResource, CoManagedConversationAttachment } from '@alga-psa/co-managed';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { removeCoManagedAttachmentAction } from '@/lib/actions/coManagedAttachmentActions';

export default function CoManagedAttachmentRemoval({ resource, attachment, onClosed, onRemoved }: {
  resource: CoManagedSharedResource; attachment: CoManagedConversationAttachment; onClosed: () => void; onRemoved: () => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const target = useRef({ resource: { ...resource }, attachment: { storeTenant: attachment.storeTenant, threadId: attachment.threadId,
    commentId: attachment.commentId, attachmentId: attachment.attachmentId } });
  const mounted = useRef(false), inFlight = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const uncertain = error === 'unknownOutcome', rejected = error && !uncertain;
  const id = `co-attachment-${attachment.attachmentId}-removal`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const close = () => { if (!inFlight.current && !uncertain) onClosed(); };
  async function remove() {
    if (inFlight.current || rejected) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await removeCoManagedAttachmentAction(target.current.resource, target.current.attachment);
      if (!mounted.current) return;
      if (result.ok) {
        if (Object.entries(target.current.attachment).some(([key, value]) => result.receipt[key as keyof typeof result.receipt] !== value) ||
          !Number.isFinite(Date.parse(result.receipt.removedAt))) throw new Error('Unexpected attachment removal receipt');
        onRemoved();
      } else if (result.code === 'forbidden' || result.code === 'readOnly') onClosed();
      else setError(result.code);
    } catch { if (mounted.current) setError('unknownOutcome'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  return <Dialog id={id} isOpen onClose={close} hideCloseButton={busy || uncertain} title={t('coManaged.attachments.removeTitle')}
    footer={<div className="flex justify-end gap-2">
      <Button id={`${id}-cancel`} variant="outline" disabled={busy || uncertain} onClick={close}>{t('coManaged.ticket.cancel')}</Button>
      <Button id={`${id}-confirm`} variant="destructive" disabled={busy || Boolean(rejected)} onClick={() => void remove()}>
        {t(busy ? 'coManaged.attachments.removing' : uncertain ? 'coManaged.ticket.retry' : 'coManaged.attachments.remove')}</Button>
    </div>}>
    <DialogContent><p className="break-words">{t('coManaged.attachments.removeHelp', { name: attachment.fileName })}</p>
      {error && <p role="alert" className="mt-2 text-destructive">{t(uncertain ? 'coManaged.attachments.removeUnknownOutcome' : `coManaged.editor.errors.${error}`)}</p>}
    </DialogContent>
  </Dialog>;
}
