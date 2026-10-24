'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { listNamedReplyReviewsAction, getNamedReplyReviewAction, resolveNamedReplyReviewAction } from '../../../actions/email-actions/namedReplyReviewActions';
import type { ResolveNamedReplyReviewRequest } from '@alga-psa/co-managed';
import { useSession } from 'next-auth/react';

type Page = Awaited<ReturnType<typeof listNamedReplyReviewsAction>>;
type Review = Awaited<ReturnType<typeof getNamedReplyReviewAction>>;

export function NamedReplyReviewManager() {
  const { data: session } = useSession();
  if (!session?.user?.id || !session.user.tenant || !session.session_id) return null;
  return <NamedReplyReviewPanel key={`${session.user.tenant}:${session.user.id}:${session.session_id}`} />;
}

function NamedReplyReviewPanel() {
  const { t } = useTranslation('msp/email-providers');
  const [page, setPage] = useState<Page>({ items: [], hasMore: false });
  const [offset, setOffset] = useState(0);
  const [review, setReview] = useState<Review | null>(null);
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef<ResolveNamedReplyReviewRequest | null>(null);
  const generation = useRef(0);
  const load = async (nextOffset = offset) => {
    const current = ++generation.current;
    setBusy(true); setError(''); setReview(null); setPage({ items: [], hasMore: false }); request.current = null; setDestination('');
    try {
      const result = await listNamedReplyReviewsAction(nextOffset);
      if (generation.current === current) { setPage(result); setOffset(nextOffset); }
    } catch { if (generation.current === current) setError(t('replyReview.loadError', { defaultValue: 'Could not load held replies. Mailbox administration permission is required.' })); }
    finally { if (generation.current === current) setBusy(false); }
  };
  useEffect(() => { void load(0); return () => { generation.current++; }; }, []);
  const open = async (inboxId: string) => {
    const current = ++generation.current;
    setBusy(true); setError(''); setNotice(''); setDestination(''); request.current = null;
    try { const result = await getNamedReplyReviewAction(inboxId); if (generation.current === current) setReview(result); }
    catch { if (generation.current === current) setError(t('replyReview.openError', { defaultValue: 'Could not open this reply. Refresh to check whether it is still held.' })); }
    finally { if (generation.current === current) setBusy(false); }
  };
  const resolve = async () => {
    const selected = review?.destinations[Number(destination)];
    if (!review || destination === '' || !selected || busy) return;
    request.current ??= { inboxId: review.inboxId, operationId: crypto.randomUUID(), sourceSha256: review.sourceSha256,
      ticket: selected.ticket, conversation: selected.conversation, expectedConversationRevision: selected.revision };
    setBusy(true); setError('');
    try {
      await resolveNamedReplyReviewAction(request.current);
      setNotice(t('replyReview.resolved', { defaultValue: 'Reply added to the selected conversation.' }));
      await load(0);
    } catch {
      setError(t('replyReview.resolveError', { defaultValue: 'Resolution could not be confirmed. Retry to check the same operation, or refresh to review the current state.' }));
    } finally { setBusy(false); }
  };
  const audience = (value: string) => value === 'shared_it'
    ? t('replyReview.sharedIt', { defaultValue: 'Shared IT' }) : t('replyReview.private', { defaultValue: 'Organization private' });

  return <Card>
    <CardHeader><div className="flex items-center justify-between gap-4">
      <CardTitle>{t('replyReview.title', { defaultValue: 'Held conversation replies' })}</CardTitle>
      <Button id="named-reply-review-refresh" variant="outline" disabled={busy} onClick={() => void load(0)}>
        {t('replyReview.refresh', { defaultValue: 'Refresh' })}
      </Button>
    </div></CardHeader>
    <CardContent className="space-y-4" aria-busy={busy}>
      <p className="text-sm text-[rgb(var(--color-text-600))]">{t('replyReview.description', { defaultValue: 'Review replies whose conversation could not be confirmed, then choose where they belong.' })}</p>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">{t('replyReview.loading', { defaultValue: 'Loading…' })}</p>}
      {review ? <div className="space-y-4">
        <Button id="named-reply-review-back" variant="ghost" disabled={busy} onClick={() => void load(offset)}>{t('replyReview.back', { defaultValue: 'Back to held replies' })}</Button>
        <div className="space-y-1">
          <h3 className="font-semibold break-words">{review.subject}</h3>
          <p className="text-sm break-words">{t('replyReview.from', { defaultValue: 'From' })}: {review.from.name ? `${review.from.name} <${review.from.email}>` : review.from.email}</p>
          <p className="text-sm break-words">{t('replyReview.to', { defaultValue: 'To' })}: {review.to.map(value => value.email).join(', ')}</p>
          {review.cc.length > 0 && <p className="text-sm break-words">CC: {review.cc.map(value => value.email).join(', ')}</p>}
        </div>
        <div className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-[rgb(var(--color-border-200))] p-4 text-sm">{review.text}</div>
        {review.attachments.length > 0 && <ul className="text-sm list-disc pl-5">{review.attachments.map((file, index) => <li key={index}>{file.name} · {file.size} B</li>)}</ul>}
        {!review.canResolve && <Alert><AlertDescription>{t('replyReview.unverified', { defaultValue: 'Sender authentication could not be verified, or the message is not usable. This reply remains held.' })}</AlertDescription></Alert>}
        <CustomSelect id="named-reply-review-destination" label={t('replyReview.destination', { defaultValue: 'Destination conversation' })}
          value={destination} disabled={busy || Boolean(request.current) || !review.canResolve}
          placeholder={t('replyReview.chooseDestination', { defaultValue: 'Choose a conversation' })}
          onValueChange={setDestination} options={review.destinations.map((item, index) => ({ value: String(index),
            label: `${item.ticketNumber ? `#${item.ticketNumber} · ` : ''}${item.name} · ${audience(item.audience)}` }))} />
        {review.destinations.length === 0 && <p className="text-sm">{t('replyReview.noDestinations', { defaultValue: 'No writable vendor conversations are available for this mailbox.' })}</p>}
        <Button id="named-reply-review-resolve" disabled={busy || !review.canResolve || destination === ''} onClick={() => void resolve()}>
          {request.current ? t('replyReview.retry', { defaultValue: 'Retry resolution' }) : t('replyReview.resolve', { defaultValue: 'Add reply to conversation' })}
        </Button>
      </div> : <>
        {!busy && !error && page.items.length === 0 && <p>{t('replyReview.empty', { defaultValue: 'No conversation replies are waiting for review.' })}</p>}
        <ul className="divide-y divide-[rgb(var(--color-border-200))]">{page.items.map(item => <li key={item.inboxId} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0"><p className="font-medium break-words">{item.subject || t('replyReview.noSubject', { defaultValue: '(No subject)' })}</p>
            <p className="text-sm text-[rgb(var(--color-text-600))] break-words">{item.from} → {item.mailbox}</p>
            <time className="text-xs text-[rgb(var(--color-text-500))]" dateTime={item.receivedAt}>{new Date(item.receivedAt).toLocaleString()}</time></div>
          <Button id={`named-reply-review-open-${item.inboxId}`} variant="outline" disabled={busy} onClick={() => void open(item.inboxId)}>{t('replyReview.review', { defaultValue: 'Review' })}</Button>
        </li>)}</ul>
        {(offset > 0 || page.hasMore) && <div className="flex gap-2">
          <Button id="named-reply-review-previous" variant="outline" disabled={busy || offset === 0} onClick={() => void load(Math.max(0, offset - 50))}>{t('replyReview.previous', { defaultValue: 'Previous' })}</Button>
          <Button id="named-reply-review-next" variant="outline" disabled={busy || !page.hasMore} onClick={() => void load(offset + 50)}>{t('replyReview.next', { defaultValue: 'Next' })}</Button>
        </div>}
      </>}
    </CardContent>
  </Card>;
}
