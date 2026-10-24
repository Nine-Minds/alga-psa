'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ConversationEditorFile } from '@alga-psa/shared/lib/tickets/conversationEditorFiles';
import type { ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import * as actions from '../../../actions/namedTicketConversationActions';

export function ConversationDraftFiles({ id, ticket, conversation, files, disabled, onChange, onLock }: {
  id: string; ticket: ConversationTicketReference; conversation: TicketConversationReference; files: ConversationEditorFile[]; disabled: boolean;
  onChange(files: ConversationEditorFile[]): Promise<boolean>; onLock(locked: boolean): void;
}) {
  const { t } = useTranslation('features/tickets');
  const [maxBytes, setMaxBytes] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; file: File; uploaded?: ConversationEditorFile } | null>(null);
  const alive = useRef(true), working = useRef(false), selected = useRef(files); selected.current = files;
  useEffect(() => {
    alive.current = true;
    actions.getNamedConversationUploadOptionsAction(ticket, conversation).then(value => { if (alive.current) setMaxBytes(value.maxBytes); })
      .catch(() => { if (alive.current) setError('fileOptionsFailed'); });
    return () => { alive.current = false; };
  }, [ticket, conversation.storeTenant, conversation.conversationId]);
  const upload = async (request: NonNullable<typeof pending>) => {
    if (disabled || working.current) return;
    working.current = true; setBusy(true); setPending(request); onLock(true); setError(null);
    try {
      let file = request.uploaded;
      if (!file) {
        const form = new FormData(); form.append('file', request.file);
        const result = await actions.uploadNamedConversationEditorFileAction(ticket, conversation, request.id, form);
        if (!alive.current) return;
        if (!result.ok) { setError(result.code === 'unknownOutcome' ? 'fileUploadUnknown' : 'fileUploadFailed'); return; }
        file = result.attachment; setPending({ ...request, uploaded: file });
      }
      const next = selected.current.some(value => value.attachmentId === file.attachmentId) ? selected.current : [...selected.current, file];
      if (!await onChange(next)) { if (alive.current) setError('fileSelectionFailed'); return; }
      if (alive.current) { setPending(null); onLock(false); }
    } catch { if (alive.current) setError('fileUploadUnknown'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  const cancel = async () => {
    if (working.current || !pending) return;
    working.current = true; setBusy(true);
    try {
      if (pending.uploaded && !await onChange(selected.current.filter(file => file.attachmentId !== pending.id))) return;
      if (alive.current) { setPending(null); setError(null); onLock(false); }
    } finally { working.current = false; if (alive.current) setBusy(false); }
  };
  const remove = async (attachmentId: string) => {
    if (disabled || working.current || pending) return;
    working.current = true; setBusy(true); onLock(true);
    try { if (!await onChange(selected.current.filter(file => file.attachmentId !== attachmentId))) setError('fileSelectionFailed'); }
    finally { working.current = false; if (alive.current) { setBusy(false); onLock(false); } }
  };
  const labels: Record<string, string> = {
    fileOptionsFailed: 'Could not load file upload options. Reload this conversation to try again.',
    fileUploadUnknown: 'The upload result is uncertain. Retry this file or cancel before switching conversations.',
    fileUploadFailed: 'Could not attach this file. Check its type, size and your access.',
    fileSelectionFailed: 'Could not save the file selection. Retry the draft save before sending.',
    fileLimit: 'Choose up to 20 files within the upload size limit and 25 MiB total.',
  };
  return <div className="space-y-2 text-sm">
    <label htmlFor={`${id}-draft-file`} className="block font-medium">{t('namedConversations.files', 'Attachments')}</label>
    <input id={`${id}-draft-file`} type="file" disabled={disabled || busy || Boolean(pending) || maxBytes <= 0 || files.length >= 20}
      className="block w-full rounded-md border border-[rgb(var(--color-border-200))] p-2 text-sm"
      onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        if (file.size > maxBytes || files.reduce((sum, value) => sum + value.size, file.size) > 26214400 || files.length >= 20) { setError('fileLimit'); return; }
        void upload({ id: crypto.randomUUID(), file });
      }} />
    {maxBytes > 0 && <p className="text-xs text-muted-foreground">{t('namedConversations.fileMax', 'Up to {{size}} MiB per upload. Files stay private until you post or send.', { size: (maxBytes / 1048576).toFixed(1) })}</p>}
    {files.length > 0 && <ul className="space-y-1">{files.map(file => {
      const query = new URLSearchParams({ ticketTenant: ticket.tenant, ticketId: ticket.ticketId, storeTenant: conversation.storeTenant,
        conversationId: conversation.conversationId, ...(ticket.relationshipId ? { relationshipId: ticket.relationshipId } : {}) });
      return <li key={file.attachmentId} className="flex items-center justify-between gap-2">
        <a id={`${id}-draft-file-${file.attachmentId}`} className="min-w-0 truncate text-primary underline"
          href={`/api/tickets/conversation-editor-files/${file.attachmentId}?${query}`}>{file.fileName} ({Math.ceil(file.size / 1024)} KiB)</a>
        <Button id={`${id}-remove-file-${file.attachmentId}`} variant="ghost" size="sm" disabled={disabled || busy || Boolean(pending)} onClick={() => void remove(file.attachmentId)}>{t('namedConversations.removeFile', 'Remove')}</Button>
      </li>;
    })}</ul>}
    {pending && <div className="flex flex-wrap items-center gap-2">
      <span>{busy ? t('namedConversations.uploadingFile', 'Attaching {{name}}…', { name: pending.file.name }) : pending.file.name}</span>
      {!busy && <><Button id={`${id}-retry-file`} variant="outline" size="sm" disabled={disabled} onClick={() => void upload(pending)}>{t('namedConversations.retryFile', 'Retry attachment')}</Button>
        <Button id={`${id}-cancel-file`} variant="ghost" size="sm" disabled={disabled} onClick={() => void cancel()}>{t('namedConversations.cancelFile', 'Cancel attachment')}</Button></>}
    </div>}
    {error && <p role="alert" className="text-destructive">{t(`namedConversations.${error}`, labels[error])}</p>}
  </div>;
}
