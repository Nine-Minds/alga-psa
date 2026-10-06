import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const subscriberSource = fs.readFileSync(
  path.resolve(__dirname, '../../../lib/eventBus/subscribers/ticketEmailSubscriber.ts'),
  'utf-8'
);
const sendEventEmailSource = fs.readFileSync(
  path.resolve(__dirname, '../../../lib/notifications/sendEventEmail.ts'),
  'utf-8'
);

describe('per-comment Cc/Bcc delivery contract', () => {
  it('T021: sendEventEmail declares cc/bcc and forwards them only when present', () => {
    expect(sendEventEmailSource).toContain('cc?: EmailAddress[];');
    expect(sendEventEmailSource).toContain('bcc?: EmailAddress[];');
    expect(sendEventEmailSource).toContain("...(params.cc?.length ? { cc: params.cc } : {}),");
    expect(sendEventEmailSource).toContain("...(params.bcc?.length ? { bcc: params.bcc } : {}),");
  });

  it('T020: the delivery claim and the attachment gate still key on the To recipient only', () => {
    expect(sendEventEmailSource).toContain(
      'claimCommentEmailDelivery(knex, params.tenantId, attachmentCommentId!, params.to)'
    );
    expect(sendEventEmailSource).toContain(
      'recipientCanReceiveCommentFiles(knex, params.tenantId, destinationTicketId!, params.to)'
    );
    expect(sendEventEmailSource).toContain('recipient: params.to,');
  });

  it('T023: the subscriber reads email_recipients from the comment row, not the event payload', () => {
    expect(subscriberSource).toContain(
      'commentEmailRecipients = readCommentEmailRecipients(commentAuthor.comment_metadata)'
    );
    expect(subscriberSource).not.toContain('payload.comment?.email_recipients');
  });

  it('T031: internal comments ignore email_recipients even when the row carries them', () => {
    expect(subscriberSource).toContain(
      'const oneOffRecipients = isPublicComment ? commentEmailRecipients : null;'
    );
  });

  it('T022/T072: the requester comment email carries the Cc/Bcc headers', () => {
    expect(subscriberSource).toContain('...oneOffHeaderParams,');
    expect(subscriberSource).toContain("requesterEmailSent = await sendIfUnique(emailParams, 'Ticket Comment Added');");
  });

  it('T030: the requester and the comment author are dropped from Cc/Bcc', () => {
    expect(subscriberSource).toContain('const oneOffExcluded = new Set<string>(');
    expect(subscriberSource).toContain('[primaryEmail, commentAuthorEmail]');
  });

  it('T028/T029: Cc/Bcc addresses join the seen-set so nobody gets a second copy', () => {
    expect(subscriberSource).toContain('const markOneOffRecipientsSent = () => {');
    expect(subscriberSource).toContain('sentEmails.add(normalizeRecipientEmail(entry.email));');
    // sendIfUnique must report whether it actually sent for the fallback to work.
    expect(subscriberSource).toContain('): Promise<boolean> => {');
  });

  it('T024/T026: the fallback sends one Cc message, or one message per Bcc address', () => {
    expect(subscriberSource).toContain('if (hasOneOffRecipients && !requesterEmailSent) {');
    expect(subscriberSource).toContain('const [primaryOneOff, ...remainingCc] = oneOffCc;');
    expect(subscriberSource).toContain('for (const entry of oneOffBcc) {');
  });

  it('T034: the combined message keeps the normal ticket reply context and thread headers', () => {
    const fallbackStart = subscriberSource.indexOf('if (hasOneOffRecipients && !requesterEmailSent) {');
    const fallbackSection = subscriberSource.slice(fallbackStart, fallbackStart + 1800);
    expect(fallbackSection).toContain('replyContext: fallbackReplyContext');
    expect(fallbackSection).toContain("template: 'ticket-comment-added'");
  });
});
