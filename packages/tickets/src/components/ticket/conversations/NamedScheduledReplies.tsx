'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { listNamedScheduledCommentsAction } from '../../../actions/namedTicketConversationActions';
import { cancelScheduledComment, rescheduleScheduledComment } from '../../../actions/comment-actions/commentActions';
import { ConversationSchedulePicker, formatConversationSchedule, type ConversationSchedule } from './ConversationSchedulePicker';
import { conversationText } from './conversationText';

type Page = Awaited<ReturnType<typeof listNamedScheduledCommentsAction>>;
type Reply = Page['items'][number];

/** Accepted, withheld replies have their own lifecycle. Refreshing these must
 * never reload or replace the author's in-progress composer draft. */
export function NamedScheduledReplies({ id, ticket, conversation, revision, disabled = false, onChanged }: {
  id: string; ticket: ConversationTicketReference; conversation: TicketConversationReference; revision: number; disabled?: boolean; onChanged?: () => void;
}) {
  const { t } = useTranslation('features/tickets');
  const [page, setPage] = useState<Page>({ items: [], next: null });
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ reply: Reply; mode: 'reschedule' | 'cancel' } | null>(null);
  const [timing, setTiming] = useState<ConversationSchedule | null>(null);
  const generation = useRef(0), working = useRef(false);
  const load = useCallback(async (after?: NonNullable<Page['next']>) => {
    const current = ++generation.current;
    setLoading(true); setError(null);
    // Revalidation removes retained content while current access is unknown.
    if (!after) setPage({ items: [], next: null });
    try {
      const value = await listNamedScheduledCommentsAction(ticket,
        { storeTenant: conversation.storeTenant, conversationId: conversation.conversationId }, after);
      if (current !== generation.current) return;
      setPage(previous => ({ ...value, items: after
        ? [...previous.items, ...value.items.filter(item => !previous.items.some(old => old.commentId === item.commentId))] : value.items }));
    } catch {
      if (current === generation.current) { setPage({ items: [], next: null }); setSelected(null); setError('scheduleLoadFailed'); }
    } finally { if (current === generation.current) setLoading(false); }
  }, [ticket.tenant, ticket.ticketId, ticket.relationshipId, conversation.storeTenant, conversation.conversationId]);
  useEffect(() => {
    setSelected(null); setTiming(null); working.current = false; setBusy(false);
    void load();
    return () => { generation.current++; };
  }, [load, revision]);
  const select = (reply: Reply, mode: 'reschedule' | 'cancel') => {
    setSelected({ reply, mode }); setTiming({ at: reply.at, timeZone: reply.timeZone }); setError(null);
  };
  const close = () => { if (!working.current) { setSelected(null); setError(null); } };
  const confirm = async () => {
    if (disabled || working.current || !selected || (selected.mode === 'reschedule' && (!timing || Date.parse(timing.at) <= Date.now()))) return;
    const current = generation.current;
    working.current = true; setBusy(true); setError(null);
    try {
      if (selected.mode === 'cancel') await cancelScheduledComment(selected.reply.commentId);
      else await rescheduleScheduledComment(selected.reply.commentId, timing!.at, timing!.timeZone);
      if (current !== generation.current) return;
      setSelected(null); working.current = false; setBusy(false); onChanged?.();
      await load();
    } catch {
      if (current === generation.current) setError('scheduleChangeFailed');
    } finally {
      if (current === generation.current) { working.current = false; setBusy(false); }
    }
  };
  return <section aria-label={t('namedConversations.scheduledReplies', 'Scheduled replies')} className="space-y-2">
    {(page.items.length > 0 || loading || error) && <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-medium">{t('namedConversations.scheduledReplies', 'Scheduled replies')}</h3>
      <Button id={`${id}-scheduled-refresh`} variant="ghost" size="sm" disabled={busy || loading} onClick={() => { setSelected(null); void load(); }}>
        {t('namedConversations.refresh', 'Refresh')}
      </Button>
    </div>}
    {loading && <p role="status" className="text-sm text-muted-foreground">{t('namedConversations.scheduleLoading', 'Loading scheduled replies…')}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error === 'scheduleLoadFailed'
      ? t('namedConversations.scheduleLoadFailed', 'Could not load scheduled replies. Refresh to check current access.')
      : t('namedConversations.scheduleChangeFailed', 'Could not confirm the change. Refresh to check the current schedule before trying again.')}</p>}
    {page.items.map(reply => <article key={reply.commentId} className="rounded-md border border-[rgb(var(--color-border-200))] p-3 space-y-2 text-sm">
      <p className="font-medium">{formatConversationSchedule(reply)}</p>
      {Date.parse(reply.at) <= Date.now() && <p className="text-muted-foreground">{t('namedConversations.awaitingPublication', 'Awaiting publication')}</p>}
      {reply.email && <div className="space-y-1 break-words">
        <p className="font-medium">{reply.email.subject}</p>
        <p>{t('namedConversations.to', 'To')}: {reply.email.to.map(person => person.email).join(', ')}</p>
        {reply.email.cc.length > 0 && <p>{t('namedConversations.cc', 'CC')}: {reply.email.cc.map(person => person.email).join(', ')}</p>}
      </div>}
      <p className="whitespace-pre-wrap break-words">{conversationText(reply.note, reply.markdown)}</p>
      {reply.isResolution && <p>{t('namedConversations.resolution', 'Resolution')}</p>}
      {reply.files.length > 0 && <ul>{reply.files.map((file, index) => <li key={index}>{file.name} ({file.size.toLocaleString()} B)</li>)}</ul>}
      <div className="flex gap-2">
        <Button id={`${id}-reschedule-${reply.commentId}`} variant="outline" size="sm" disabled={disabled || busy || loading} onClick={() => select(reply, 'reschedule')}>{t('conversation.reschedule', 'Reschedule')}</Button>
        <Button id={`${id}-cancel-schedule-${reply.commentId}`} variant="ghost" size="sm" disabled={disabled || busy || loading} onClick={() => select(reply, 'cancel')}>{t('namedConversations.cancelScheduledReply', 'Cancel scheduled reply')}</Button>
      </div>
    </article>)}
    {page.next && <Button id={`${id}-scheduled-more`} variant="ghost" disabled={loading || busy} onClick={() => void load(page.next!)}>{t('namedConversations.loadMore', 'Load more')}</Button>}
    <Dialog id={`${id}-schedule-dialog`} isOpen={Boolean(selected)} onClose={close}
      title={selected?.mode === 'cancel' ? t('namedConversations.cancelScheduledReply', 'Cancel scheduled reply') : t('conversation.reschedule', 'Reschedule')}
      footer={<div className="flex justify-end gap-2">
        <Button id={`${id}-schedule-back`} variant="outline" disabled={busy} onClick={close}>{t('namedConversations.back', 'Back')}</Button>
        <Button id={`${id}-schedule-confirm`} disabled={disabled || busy || (selected?.mode === 'reschedule' && (!timing || Date.parse(timing.at) <= Date.now()))} onClick={() => void confirm()}>
          {selected?.mode === 'cancel' ? t('namedConversations.confirmScheduleCancel', 'Confirm cancellation') : t('namedConversations.saveSchedule', 'Save schedule')}
        </Button>
      </div>}>
      <DialogContent>{selected && <div className="space-y-3">
        {selected.mode === 'cancel' ? <p>{t('namedConversations.cancelScheduleDescription', 'This reply will not be published or emailed.')}</p>
          : <ConversationSchedulePicker key={selected.reply.commentId} id={`${id}-reschedule-time`} value={selected.reply} disabled={busy || disabled} onChange={setTiming} />}
        {error === 'scheduleChangeFailed' && <p role="alert">{t('namedConversations.scheduleChangeFailed', 'Could not confirm the change. Refresh to check the current schedule before trying again.')}</p>}
      </div>}</DialogContent>
    </Dialog>
  </section>;
}
