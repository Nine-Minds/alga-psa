import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * What the delivery of per-comment Cc/Bcc does is pinned behaviourally in
 * server/src/test/integration/ticketCommentEmailRecipientsSmtp.test.ts, which
 * runs the subscriber against a migrated database, the real email service and
 * a real SMTP server and inspects the delivered messages.
 *
 * What is left here is the one guarantee that suite cannot reach cheaply: the
 * per-comment attachment path, which needs stored documents. Both of its
 * gates must stay keyed on the single `To` recipient — a Cc/Bcc address must
 * never be able to claim a comment's delivery or be asked for its own
 * attachment permissions.
 */
const sendEventEmailSource = fs.readFileSync(
  path.resolve(__dirname, '../../../lib/notifications/sendEventEmail.ts'),
  'utf-8'
);

describe('per-comment Cc/Bcc delivery contract', () => {
  it('T020: the delivery claim and the attachment gate key on the To recipient only', () => {
    expect(sendEventEmailSource).toContain(
      'claimCommentEmailDelivery(knex, params.tenantId, attachmentCommentId!, params.to)'
    );
    expect(sendEventEmailSource).toContain(
      'recipientCanReceiveCommentFiles(knex, params.tenantId, destinationTicketId!, params.to)'
    );
  });

  it('T021: sendEventEmail forwards cc/bcc only when they are present', () => {
    expect(sendEventEmailSource).toContain('cc?: EmailAddress[];');
    expect(sendEventEmailSource).toContain('bcc?: EmailAddress[];');
    expect(sendEventEmailSource).toContain("...(params.cc?.length ? { cc: params.cc } : {}),");
    expect(sendEventEmailSource).toContain("...(params.bcc?.length ? { bcc: params.bcc } : {}),");
  });
});
