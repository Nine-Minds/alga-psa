'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import type { CoManagedSharedResource, CoManagedCommentReference, CoManagedConversationAttachment } from '@alga-psa/co-managed';
import { getCoManagedAttachmentsScreenAction, uploadCoManagedAttachmentAction } from '@/lib/actions/coManagedAttachmentActions';

import CoManagedAttachmentRemoval from './CoManagedAttachmentRemoval';

type Screen = Awaited<ReturnType<typeof getCoManagedAttachmentsScreenAction>>;
function downloadUrl(resource: CoManagedSharedResource, attachment: CoManagedConversationAttachment) {
  const query = new URLSearchParams({ customerTenant: resource.tenant, relationshipId: resource.relationshipId, ticketId: resource.id,
    storeTenant: attachment.storeTenant, threadId: attachment.threadId, commentId: attachment.commentId });
  return `/api/co-management/attachments/${encodeURIComponent(attachment.attachmentId)}?${query}`;
}
export default function CoManagedCommentAttachments({ resource, comment }: { resource: CoManagedSharedResource; comment: CoManagedCommentReference }) {
  const { data: session } = useSession();
  const actor = { tenant: session?.user?.tenant, userId: session?.user?.id };
  const identity = `${session?.session_id}:${resource.tenant}:${resource.relationshipId}:${resource.id}:${comment.storeTenant}:${comment.threadId}:${comment.commentId}:${actor.tenant}:${actor.userId}`;
  return <Attachments key={identity} resource={resource} comment={comment} actor={actor} />;
}
function Attachments({ resource, comment, actor }: { resource: CoManagedSharedResource; comment: CoManagedCommentReference; actor: { tenant?: string; userId?: string } }) {
  const { t } = useTranslation('msp/licensing'), { formatNumber } = useFormatters();
  const target = useRef({ resource: { ...resource }, comment: { ...comment } });
  const [state, setState] = useState<Screen | null>(null), [readError, setReadError] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [removal, setRemoval] = useState<CoManagedConversationAttachment | null>(null);
  const removalTarget = useRef<CoManagedConversationAttachment | null>(null);
  const selectRemoval = (value: CoManagedConversationAttachment | null) => { removalTarget.current = value; setRemoval(value); };
  const [file, setFile] = useState<File | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [inputKey, setInputKey] = useState(0);
  const mounted = useRef(false), generation = useRef(0), loading = useRef(false), queued = useRef(false), inFlight = useRef(false);
  const draftGeneration = useRef(0);
  const submission = useRef<{ file: File; attachmentId: string } | null>(null);
  const id = `co-attachments-${comment.storeTenant}-${comment.commentId}`;
  const uncertain = error === 'unknownOutcome', rejected = error && !['invalid', 'unknownOutcome'].includes(error);
  const frozen = busy || uncertain || Boolean(rejected) || !state?.canUpload;
  const clearFile = () => { draftGeneration.current++; setChoosing(false); setFile(null); submission.current = null; setError(null); setInputKey(value => value + 1); };
  async function refresh() {
    if (!actor.tenant || !actor.userId) return;
    if (loading.current) { queued.current = true; return; }
    const current = ++generation.current; loading.current = true;
    try {
      const page = await getCoManagedAttachmentsScreenAction(target.current.resource, target.current.comment);
      if (!mounted.current || current !== generation.current) return;
      if (page.actor.tenant !== actor.tenant || page.actor.userId !== actor.userId || page.attachments.some(file =>
        file.storeTenant !== comment.storeTenant || file.threadId !== comment.threadId || file.commentId !== comment.commentId)) throw new Error('Attachment session changed');
      setState(page); setReadError(false);
      if (!page.canUpload) clearFile();
      if (!page.canRemove || (removalTarget.current && !page.attachments.some(file => file.attachmentId === removalTarget.current!.attachmentId))) selectRemoval(null);
    } catch {
      if (mounted.current && current === generation.current) { setState(null); setReadError(true); clearFile(); selectRemoval(null); }
    } finally {
      if (mounted.current && current === generation.current) {
        loading.current = false;
        if (queued.current) { queued.current = false; void refresh(); }
      }
    }
  }
  useEffect(() => {
    mounted.current = true; void refresh();
    const timer = setInterval(() => { void refresh(); }, 30000);
    return () => { mounted.current = false; generation.current++; loading.current = false; queued.current = false; clearInterval(timer); };
  }, [actor.tenant, actor.userId]);
  async function upload() {
    if (inFlight.current || removalTarget.current || rejected || !state?.canUpload || !file) return;
    if (file.size > state.maxBytes) { setError('invalid'); return; }
    if (!submission.current) submission.current = { file, attachmentId: crypto.randomUUID() };
    const currentDraft = draftGeneration.current;
    const saved = submission.current, form = new FormData(); form.append('file', saved.file);
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await uploadCoManagedAttachmentAction(target.current.resource, target.current.comment, saved.attachmentId, form);
      if (!mounted.current || currentDraft !== draftGeneration.current) return;
      if (result.ok) { clearFile(); void refresh(); }
      else { setError(result.code); if (result.code === 'invalid') submission.current = null; }
    } catch { if (mounted.current && currentDraft === draftGeneration.current) setError('unknownOutcome'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  if ((!state && !readError) || (state && !state.attachments.length && !state.canUpload)) return null;
  return <section aria-labelledby={`${id}-title`} className="space-y-2 border-t border-[rgb(var(--color-border-200))] pt-3">
    <h4 id={`${id}-title`} className={state && !state.attachments.length && !choosing ? 'sr-only' : 'text-sm font-medium'}>{t('coManaged.attachments.title')}</h4>
    {readError && <div className="flex items-center gap-2"><p role="status" className="text-sm">{t('coManaged.attachments.loadError')}</p>
      <Button id={`${id}-reload`} size="sm" variant="ghost" onClick={() => void refresh()}>{t('coManaged.ticket.reload')}</Button></div>}
    {state && <>
      {state.attachments.length > 0 && <ul className="space-y-1">{state.attachments.map(attachment => <li key={attachment.attachmentId} className="flex items-center justify-between gap-2 text-sm">
        <a id={`${id}-${attachment.attachmentId}-download`} className="break-words text-[rgb(var(--badge-info-text))] underline" href={downloadUrl(target.current.resource, attachment)} download>{attachment.fileName}</a>
        {state.canRemove && <Button id={`${id}-${attachment.attachmentId}-remove`} variant="ghost" size="sm" disabled={busy || choosing || Boolean(removal)}
          aria-label={t('coManaged.attachments.removeNamed', { name: attachment.fileName })} onClick={() => selectRemoval({ ...attachment })}>{t('coManaged.attachments.remove')}</Button>}
      </li>)}</ul>}
      {state.canUpload && !choosing && !removal && <Button id={`${id}-add`} size="sm" variant="ghost" onClick={() => setChoosing(true)}>{t('coManaged.attachments.add')}</Button>}
      {state.canUpload && choosing && <div className="space-y-2">
        <Input key={inputKey} id={`${id}-file`} type="file" preserveCursor={false} label={t('coManaged.attachments.choose')} disabled={frozen}
          aria-describedby={`${id}-help`} onChange={event => { if (!frozen) { setFile(event.target.files?.[0] ?? null); setError(null); submission.current = null; } }} />
        <p id={`${id}-help`} className="text-xs text-muted-foreground">{t('coManaged.attachments.help', { size: formatNumber(state.maxBytes / 1048576, { maximumFractionDigits: 2 }) })}</p>
        <div className="flex gap-2">
          {file && <Button id={`${id}-upload`} size="sm" disabled={busy || Boolean(rejected)} onClick={() => void upload()}>{t(busy ? 'coManaged.attachments.uploading' : uncertain ? 'coManaged.ticket.retry' : 'coManaged.attachments.upload')}</Button>}
          <Button id={`${id}-cancel`} size="sm" variant="outline" disabled={busy || uncertain} onClick={clearFile}>{t('coManaged.ticket.cancel')}</Button>
        </div>
      </div>}
      {removal && state.canRemove && <CoManagedAttachmentRemoval resource={target.current.resource} attachment={removal}
        onClosed={() => { selectRemoval(null); void refresh(); }} onRemoved={() => { selectRemoval(null); void refresh(); }} />}
      {error && <p role="alert" className="text-sm text-destructive">{t(error === 'unknownOutcome' ? 'coManaged.attachments.unknownOutcome' : error === 'invalid' ? 'coManaged.attachments.invalid' : `coManaged.editor.errors.${error}`)}</p>}
    </>}
  </section>;
}
