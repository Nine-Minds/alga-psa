'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeConversationContent, type CoManagedSharedResource, type CoManagedOpenConversationDraft } from '@alga-psa/co-managed';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { listCoManagedConversationDraftsAction, abandonCoManagedConversationDraftAction } from '@/lib/actions/coManagedConversationDraftActions';
import { missingDraftFiles, restoreConversationDraft, submitConversationDraft } from './conversationDraftSubmission';

const ERROR_KEYS: Record<string, string> = { abandoned: 'coManaged.conversation.files.abandoned', notReady: 'coManaged.conversation.files.notReady' };

/**
 * Messages the signed-in author started sending but did not finish (a reload, a crash, a lost connection). The server keeps
 * the text, audience and file manifest; this lists them with what is already uploaded, asks only for the files that are not,
 * and sends or discards them. It never invents a draft: with nothing open it renders nothing.
 */
// LEVERAGE: friction base-composer-prefill — the base ticket composer has no initial-content seam for a host, so restored text is shown
// and re-sent from this panel rather than placed back in the editor.
export default function CoManagedDraftRestore({ resource, version, onPublished }: {
  resource: CoManagedSharedResource; version: number; onPublished: () => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [drafts, setDrafts] = useState<CoManagedOpenConversationDraft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, File[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const refresh = useCallback(async () => {
    const result = await listCoManagedConversationDraftsAction(resource).catch(() => null);
    if (mounted.current && result?.ok) setDrafts(result.drafts);
  }, [resource]);
  useEffect(() => { void refresh(); }, [refresh, version]);
  if (!drafts.length) return null;
  const fail = (id: string, code: string) => setErrors(value => ({ ...value, [id]: ERROR_KEYS[code] ?? (['forbidden', 'readOnly', 'invalid', 'operationConflict'].includes(code) ? `coManaged.editor.errors.${code}` : 'coManaged.editor.errors.unknownOutcome') }));
  const send = async (draft: CoManagedOpenConversationDraft) => {
    const restored = restoreConversationDraft(resource, draft, picked[draft.operationId] ?? []);
    if (!restored.ok) { setErrors(value => ({ ...value, [draft.operationId]: 'coManaged.conversation.drafts.missing' })); return; }
    setBusy(draft.operationId); setErrors(value => ({ ...value, [draft.operationId]: '' }));
    try {
      const result = await submitConversationDraft(restored.prepared, () => mounted.current, () => undefined);
      if (!result.ok) { if (result.code !== 'aborted') fail(draft.operationId, result.code); }
      else onPublished();
    } catch { fail(draft.operationId, 'unknownOutcome'); }
    finally { if (mounted.current) { setBusy(null); void refresh(); } }
  };
  const discard = async (draft: CoManagedOpenConversationDraft) => {
    setBusy(draft.operationId);
    const result = await abandonCoManagedConversationDraftAction(resource, { storeTenant: draft.storeTenant, operationId: draft.operationId }).catch(() => null);
    if (!mounted.current) return;
    setBusy(null);
    if (result && !result.ok) fail(draft.operationId, result.code); else void refresh();
  };
  return <section id="co-managed-draft-restore" aria-labelledby="co-managed-draft-restore-title" className="space-y-3">
    <h3 id="co-managed-draft-restore-title" className="text-sm font-medium">{t('coManaged.conversation.drafts.title')}</h3>
    <p className="text-xs text-muted-foreground">{t('coManaged.conversation.drafts.help')}</p>
    {drafts.map(draft => {
      const id = `co-managed-draft-${draft.operationId}`, missing = missingDraftFiles(draft);
      return <div key={draft.operationId} id={id} className="space-y-2 rounded border p-3">
        <p className="whitespace-pre-wrap text-sm">{encodeConversationContent(draft.content).markdown_content}</p>
        <p className="text-xs text-muted-foreground">{t('coManaged.conversation.audience')}: {t(`coManaged.conversation.audiences.${draft.audience}`)}</p>
        <ul className="space-y-1">
          {draft.files.map(file => <li key={file.attachmentId} className="flex justify-between gap-2 text-sm">
            <span className="truncate">{file.fileName}</span>
            <span className="text-xs text-muted-foreground">{draft.uploadedAttachmentIds.includes(file.attachmentId) ? t('coManaged.conversation.drafts.fileReady') : t('coManaged.conversation.drafts.fileMissing')}</span>
          </li>)}
        </ul>
        {missing.length > 0 && <Input id={`${id}-files`} type="file" multiple preserveCursor={false} disabled={busy !== null} label={t('coManaged.conversation.drafts.choose')}
          onChange={event => { setPicked(value => ({ ...value, [draft.operationId]: Array.from(event.target.files ?? []) })); setErrors(value => ({ ...value, [draft.operationId]: '' })); }} />}
        {errors[draft.operationId] && <p role="alert" className="text-sm text-destructive">{t(errors[draft.operationId])}</p>}
        <div className="flex gap-2">
          <Button id={`${id}-send`} size="sm" disabled={busy !== null} onClick={() => void send(draft)}>{t('coManaged.conversation.drafts.resume')}</Button>
          <Button id={`${id}-discard`} size="sm" variant="outline" disabled={busy !== null} onClick={() => void discard(draft)}>{t('coManaged.conversation.drafts.discard')}</Button>
        </div>
      </div>;
    })}
  </section>;
}
