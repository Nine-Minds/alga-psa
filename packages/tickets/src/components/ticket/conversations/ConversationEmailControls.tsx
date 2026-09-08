'use client';

import { formatConversationSchedule } from './ConversationSchedulePicker';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { NamedTicketConversation, ConversationTicketReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import * as actions from '../../../actions/namedTicketConversationActions';
import { emailAddressLabel as address, emailDeliveryLabels } from './ConversationEmailEnvelope';

type Review = Awaited<ReturnType<typeof actions.prepareNamedTicketEmailAction>>;
type Send = NonNullable<Awaited<ReturnType<typeof actions.getLatestNamedTicketEmailSendAction>>>;
type Request = Parameters<typeof actions.prepareNamedTicketEmailAction>[2];

/** This control owns only the review/Send interaction. Draft persistence remains
 * in the same serial writer used by internal Post and conversation navigation. */
export function ConversationEmailControls({ id, ticket, conversation, ready, saveDraft, onLock, onMailbox, onSent, closeStatuses = [], refreshVersion = 0 }: {
  id: string; ticket: ConversationTicketReference; conversation: NamedTicketConversation; ready: boolean;
  saveDraft: () => Promise<Request | null>; onLock: (locked: boolean) => void;
  onMailbox: (conversation: NamedTicketConversation) => void; onSent: () => Promise<void>;
  closeStatuses?: { value: string; label: string }[]; refreshVersion?: number;
}) {
  const { t } = useTranslation('features/tickets');
  const ref = { storeTenant: conversation.storeTenant, conversationId: conversation.conversationId };
  const [mailboxes, setMailboxes] = useState<Awaited<ReturnType<typeof actions.listNamedConversationMailboxesAction>>>([]);
  const [loaded, setLoaded] = useState(false), [reload, setReload] = useState(0), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [review, setReview] = useState<Review | null>(null), [send, setSend] = useState<Send | null>(null);
  const [closeBlocked, setCloseBlocked] = useState<string[]>([]);
  const live = useRef(true), working = useRef(false), request = useRef<Request | null>(null), confirmed = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (working.current) return;
    let valid = true;
    Promise.all([actions.listNamedConversationMailboxesAction(ticket, ref), actions.getLatestNamedTicketEmailSendAction(ticket, ref)])
      .then(([options, last]) => { if (valid) { setMailboxes(options); setSend(last); setLoaded(true); setError(null); } })
      .catch(() => { if (valid) { setError('emailLoadFailed'); setLoaded(false); } });
    return () => { valid = false; };
  }, [ticket, conversation.conversationId, reload, refreshVersion]);
  const begin = () => { if (working.current) return false; working.current = true; setBusy(true); setError(null); onLock(true); return true; };
  const finish = (locked: boolean) => { working.current = false; if (live.current) { setBusy(false); onLock(locked); } };
  const chooseMailbox = async (mailboxId: string) => {
    if (!begin()) return;
    try {
      if (!await saveDraft()) return;
      const selected = await actions.selectNamedConversationMailboxAction(ticket, ref, conversation.revision, mailboxId);
      if (live.current) onMailbox(selected);
    } catch { if (live.current) setError('mailboxFailed'); }
    finally { finish(false); }
  };
  const prepare = async () => {
    if (!begin()) return;
    let retain = false;
    try {
      request.current ??= await saveDraft();
      if (!request.current) return;
      const value = await actions.prepareNamedTicketEmailAction(ticket, ref, request.current);
      if (!live.current) return;
      setReview(value); setCloseBlocked([]); confirmed.current = false; retain = true;
    } catch { if (live.current) setError('reviewFailed'); request.current = null; }
    finally { finish(retain); }
  };
  const cancel = () => {
    if (working.current || confirmed.current) return;
    request.current = null; setReview(null); setCloseBlocked([]); setError(null); onLock(false);
  };
  const confirm = async () => {
    if (!review || !begin()) return;
    confirmed.current = true;
    let retain = true;
    try {
      const value = await actions.sendNamedTicketEmailAction(ticket, ref, review.operationId, review.review.messageHash);
      if (!live.current) return;
      if (value.status === 'close_blocked') { setCloseBlocked(value.failedRules); confirmed.current = false; return; }
      setCloseBlocked([]);
      setSend({ ...value, reviewHash: review.review.messageHash });
      await onSent();
      if (!live.current) return;
      request.current = null; setReview(null); confirmed.current = false; retain = false;
    } catch { if (live.current) setError('sendFailed'); }
    finally { finish(retain); }
  };
  const check = async () => {
    if (!begin()) return;
    let retain = Boolean(review);
    try {
      // A later message may already be in progress below an older send banner.
      // Flush it before refreshing the draft after the delivery status read.
      if (!await saveDraft()) return;
      const target = review ? { operationId: review.operationId, reviewHash: review.review.messageHash } : send;
      if (!target) return;
      // A status read never grants permission to send an unconfirmed review.
      const value = await actions.getNamedTicketEmailOperationAction(ticket, ref, target.operationId);
      if (!live.current) return;
      if (value.status === 'reviewed') { confirmed.current = false; setError(null); return; }
      setSend({ ...value, reviewHash: target.reviewHash });
      await onSent();
      if (!live.current) return;
      request.current = null; setReview(null); confirmed.current = false; retain = false;
    } catch { if (live.current) setError('statusFailed'); }
    finally { finish(retain); }
  };
  const resume = async () => {
    if (!send || send.status !== 'pending' || !begin()) return;
    try {
      const value = await actions.sendNamedTicketEmailAction(ticket, ref, send.operationId, send.reviewHash);
      if (live.current && value.status !== 'close_blocked') setSend({ ...value, reviewHash: send.reviewHash });
    } catch { if (live.current) setError('statusFailed'); }
    finally { finish(false); }
  };
  const errors: Record<string, string> = {
    emailLoadFailed: 'Could not load email sending options. Retry to check your access.',
    mailboxFailed: 'Could not select the mailbox. Refresh the conversation and check your sending access.',
    reviewFailed: 'Could not prepare the review. Check the recipients, subject, draft and selected mailbox.',
    sendFailed: 'Could not confirm the result. Check this send before editing or sending again.',
    statusFailed: 'Could not check delivery. The original send is retained; try checking again.',
  };
  const closeRuleLabels: Record<string, string> = { resolution_comment: 'Add a resolution comment.', time_entry: 'Log a time entry.',
    checklist_incomplete: 'Complete required checklist items.', open_children: 'Close the open bundled tickets.', required_fields: 'Fill in the required ticket fields.' };
  return <div className="space-y-3">
    <CustomSelect id={`${id}-mailbox`} label={t('namedConversations.mailbox', 'Sending mailbox')} value={conversation.mailbox?.id ?? ''}
      placeholder={t('namedConversations.chooseMailbox', 'Choose a mailbox')} disabled={!loaded || busy || Boolean(review)}
      options={mailboxes.map(mailbox => ({ value: mailbox.id, label: address({ email: mailbox.email, name: mailbox.name ?? undefined }) }))}
      onValueChange={value => void chooseMailbox(value)} />
    {loaded && !mailboxes.length && <p className="text-sm text-muted-foreground">{t('namedConversations.noMailbox', 'No connected mailbox is available with your sending permissions.')}</p>}
    {send && <div role="status" className="rounded-md border border-[rgb(var(--color-border-200))] p-3 text-sm">
      <p>{t(`namedConversations.delivery.${send.status}`, emailDeliveryLabels[send.status])}</p>
      {send.status === 'pending' && <Button id={`${id}-resume-send`} variant="outline" size="sm" disabled={busy || Boolean(review)} onClick={() => void resume()}>{t('namedConversations.resumeDelivery', 'Continue accepted send')}</Button>}
      {(send.status === 'sending' || send.status === 'unknown') && <Button id={`${id}-check-delivery`} variant="outline" size="sm" disabled={busy || Boolean(review)} onClick={() => void check()}>{t('namedConversations.checkDelivery', 'Check delivery')}</Button>}
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{t(`namedConversations.${error}`, errors[error])}</p>}
    {!loaded && error && <Button id={`${id}-retry-mailboxes`} variant="outline" onClick={() => setReload(value => value + 1)}>{t('namedConversations.retry', 'Retry')}</Button>}
    <Button id={`${id}-review-email`} disabled={!loaded || !ready || busy || Boolean(review) || !mailboxes.some(value => value.id === conversation.mailbox?.id)} onClick={() => void prepare()}>{t('namedConversations.reviewEmail', 'Review email')}</Button>
    <Dialog isOpen={Boolean(review)} onClose={cancel} title={t('namedConversations.reviewEmail', 'Review email')}
      footer={<><Button id={`${id}-review-edit`} variant="outline" disabled={busy || confirmed.current} onClick={cancel}>{t('namedConversations.editDraft', 'Back to draft')}</Button>
        {confirmed.current ? <Button id={`${id}-review-check`} disabled={busy} onClick={() => void check()}>{t('namedConversations.checkDelivery', 'Check delivery')}</Button>
          : <Button id={`${id}-confirm-send`} disabled={busy} onClick={() => void confirm()}>{review?.publicationOptions?.schedule ? t('namedConversations.scheduleEmail', 'Schedule email') : t('namedConversations.send', 'Send email')}</Button>}</>}>
      <DialogContent>{review && <div className="space-y-3">
        {review.publicationOptions?.schedule && <div className="text-sm font-medium"><p>{t('namedConversations.scheduleReview', 'Publish and email at:')} {formatConversationSchedule(review.publicationOptions.schedule)}</p><p className="font-normal text-muted-foreground">{t('namedConversations.scheduleKeepsStatus', 'Scheduled replies keep the current ticket status.')}</p></div>}
        {review.publicationOptions?.isResolution && <p className="text-sm font-medium">{t('namedConversations.resolutionReview', 'This message will be marked as a resolution.')}</p>}
        {review.publicationOptions?.close && <div className="text-sm"><p>{t('namedConversations.closeReview', 'The ticket will close when this send is accepted.')} {closeStatuses.find(status => status.value === review.publicationOptions?.close?.statusId)?.label}</p>
          {review.publicationOptions.close.overrideReason !== undefined && <p>{t('namedConversations.overrideClose', 'Override unmet close rules')}: {review.publicationOptions.close.overrideReason}</p>}</div>}
        {closeBlocked.length > 0 && <div role="alert" className="text-sm text-destructive"><p>{t('namedConversations.closeBlocked', 'Nothing was sent. Complete the close requirements, or return to your draft to change the close option.')}</p>
          <ul className="list-disc pl-5">{closeBlocked.map(rule => <li key={rule}>{t(`namedConversations.closeRules.${rule}`, closeRuleLabels[rule] ?? rule)}</li>)}</ul></div>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 break-words text-sm">
          <dt>{t('namedConversations.from', 'From')}</dt><dd>{address(review.review.from)}</dd>
          <dt>{t('namedConversations.replyTo', 'Replies to')}</dt><dd>{review.review.replyTo ? address(review.review.replyTo) : address(review.review.from)}</dd>
          <dt>{t('namedConversations.to', 'To')}</dt><dd>{review.review.to.map(address).join('; ')}</dd>
          {review.review.cc.length > 0 && <><dt>{t('namedConversations.cc', 'CC')}</dt><dd>{review.review.cc.map(address).join('; ')}</dd></>}
          <dt>{t('namedConversations.subject', 'Subject')}</dt><dd>{review.review.subject}</dd>
        </dl>
        {review.review.files.length > 0 && <div><h4 className="text-sm font-medium">{t('namedConversations.files', 'Attachments')}</h4>
          <ul className="mt-1 space-y-1 text-sm">{review.review.files.map((file, index) => <li key={index}>{file.filename} ({Math.ceil(file.size / 1024)} KiB)</li>)}</ul>
        </div>}
        <iframe title={t('namedConversations.emailPreview', 'Email body preview')} sandbox="" className="min-h-64 w-full rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]"
          srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">${review.review.html}`} />
        <p className="text-xs text-muted-foreground">{t('namedConversations.recipientAccess', 'These recipients receive this email. Adding a recipient does not give them access to the ticket.')}</p>
        {error && <p role="alert" className="text-sm text-destructive">{t(`namedConversations.${error}`, errors[error])}</p>}
      </div>}</DialogContent>
    </Dialog>
  </div>;
}
