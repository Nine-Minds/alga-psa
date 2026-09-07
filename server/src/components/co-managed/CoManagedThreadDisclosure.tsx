'use client';
import { useEffect, useRef, useState } from 'react';
import type { CoManagedSharedResource, CoManagedThreadReference, CoManagedThreadDisclosurePreview, CoManagedThreadDisclosureRequest } from '@alga-psa/co-managed';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { previewCoManagedThreadDisclosureAction, discloseCoManagedThreadAction } from '@/lib/actions/coManagedThreadDisclosureActions';

export default function CoManagedThreadDisclosure({ resource, thread, actor, audiences, onClosed, onSaved }: {
  resource: CoManagedSharedResource; thread: CoManagedThreadReference; actor: { tenant: string; userId: string };
  audiences: CoManagedThreadDisclosurePreview['audience'][]; onClosed: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const target = useRef({ resource: { ...resource }, thread: { ...thread }, actor: { ...actor } });
  const [preview, setPreview] = useState<CoManagedThreadDisclosurePreview | null>(null);
  const [audience, setAudience] = useState<CoManagedThreadDisclosurePreview['audience'] | ''>('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const currentPreview = useRef<CoManagedThreadDisclosurePreview | null>(null), submission = useRef<CoManagedThreadDisclosureRequest | null>(null);
  const mounted = useRef(false), inFlight = useRef(false), loading = useRef(false);
  const uncertain = error === 'unknownOutcome', rejected = error && !uncertain;
  const id = `co-thread-${thread.threadId}-disclosure`;
  async function review(reset = false) {
    if (loading.current) return;
    loading.current = true;
    try {
      const result = await previewCoManagedThreadDisclosureAction(target.current.resource, target.current.thread);
      if (!mounted.current) return;
      if (result.actor.tenant !== actor.tenant || result.actor.userId !== actor.userId || result.preview.storeTenant !== thread.storeTenant ||
        result.preview.threadId !== thread.threadId) throw new Error('Disclosure identity changed');
      if (!currentPreview.current || reset) {
        currentPreview.current = result.preview; setPreview(result.preview); setAudience(''); setError(null); submission.current = null;
      } else if (!submission.current && result.preview.snapshot !== currentPreview.current.snapshot) setError('conflict');
    } catch { if (mounted.current) onClosed(); }
    finally { loading.current = false; }
  }
  useEffect(() => {
    mounted.current = true; void review(); const timer = setInterval(() => void review(), 30000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  async function submit() {
    if (inFlight.current || rejected || !preview || !audience || !audiences.includes(audience) || preview.pendingAttachments) return;
    if (!submission.current) submission.current = { ...target.current.thread, operationId: crypto.randomUUID(), expectedSnapshot: preview.snapshot, audience, confirmed: true };
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await discloseCoManagedThreadAction(target.current.resource, submission.current);
      if (!mounted.current) return;
      if (result.ok) {
        const request = submission.current!;
        if ((['storeTenant', 'threadId', 'operationId', 'audience'] as const).some(key => result.receipt[key] !== request[key]) ||
          !Number.isFinite(Date.parse(result.receipt.appliedAt))) throw new Error('Invalid disclosure receipt');
        onSaved();
      } else if (result.code === 'forbidden' || result.code === 'readOnly') onClosed();
      else setError(result.code);
    } catch { if (mounted.current) setError('unknownOutcome'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  const close = () => { if (!inFlight.current && !uncertain) onClosed(); };
  return <Dialog id={id} isOpen title={t('coManaged.disclosure.title')} onClose={close} hideCloseButton={busy || uncertain}
    footer={<div className="flex gap-2 justify-end">
      <Button id={`${id}-cancel`} variant="outline" disabled={busy || uncertain} onClick={close}>{t('coManaged.ticket.cancel')}</Button>
      {error === 'conflict' && <Button id={`${id}-review`} variant="outline" onClick={() => void review(true)}>{t('coManaged.disclosure.review')}</Button>}
      <Button id={`${id}-confirm`} disabled={!preview || !audience || busy || Boolean(rejected) || Boolean(preview.pendingAttachments)} onClick={() => void submit()}>
        {t(busy ? 'coManaged.ticket.saving' : uncertain ? 'coManaged.ticket.retry' : 'coManaged.disclosure.confirm')}</Button>
    </div>}>
    <DialogContent><div className="space-y-3">
      {!preview ? <p role="status">{t('coManaged.ticket.loading')}</p> : <>
        <p>{t('coManaged.disclosure.scope', { comments: preview.comments, attachments: preview.attachments })}</p>
        <p className="text-sm font-medium">{t('coManaged.disclosure.current', { audience: t(`coManaged.conversation.audiences.${preview.audience}`) })}</p>
        <CustomSelect id={`${id}-audience`} label={t('coManaged.conversation.audience')} value={audience} disabled={busy || uncertain || Boolean(rejected)}
          options={audiences.filter(value => value !== preview.audience).map(value => ({ value, label: t(`coManaged.conversation.audiences.${value}`) }))}
          onValueChange={value => setAudience(value as typeof audience)} />
        {audience && <p>{t(`coManaged.conversation.audienceHelp.${audience}`)}</p>}
        <p className="text-sm text-muted-foreground">{t('coManaged.disclosure.help')}</p>
        {preview.pendingAttachments > 0 && <p role="status">{t('coManaged.disclosure.pending')}</p>}
      </>}
      {error && <p role="alert" className="text-destructive">{t(uncertain ? 'coManaged.disclosure.unknownOutcome' : `coManaged.editor.errors.${error}`)}</p>}
    </div></DialogContent>
  </Dialog>;
}
