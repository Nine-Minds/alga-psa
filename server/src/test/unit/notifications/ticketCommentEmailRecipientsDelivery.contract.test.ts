import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { COMMENT_EMAIL_LEDGER } from '@shared/lib/deliveryLedger';
import { resolveDeliveryClaim } from '../../../lib/notifications/sendEventEmail';

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
 * attachment permissions. The claim is pinned through `resolveDeliveryClaim`,
 * the function `sendEventEmail` uses to pick the ledger row it claims.
 */
const sendEventEmailSource = fs.readFileSync(
  path.resolve(__dirname, '../../../lib/notifications/sendEventEmail.ts'),
  'utf-8'
);

describe('per-comment Cc/Bcc delivery contract', () => {
  it('T020: the delivery claim and the attachment gate key on the To recipient only', () => {
    const params = {
      to: 'to@example.test',
      cc: [{ email: 'cc@example.test' }],
      bcc: [{ email: 'bcc@example.test' }],
      tenantId: 'tenant-1',
    };
    expect(resolveDeliveryClaim(params, 'comment-1')).toEqual({
      ledger: COMMENT_EMAIL_LEDGER,
      tenant: 'tenant-1',
      key: { comment_id: 'comment-1', recipient: 'to@example.test' },
    });
    // A send without stored attachments is not ledgered at all.
    expect(resolveDeliveryClaim(params, undefined)).toBeNull();
    expect(sendEventEmailSource).toContain(
      'recipientCanReceiveCommentFiles(knex, params.tenantId, destinationTicketId!, params.to)'
    );
  });

  it('T020b: a co-managed caller\'s named ledger wins over the comment ledger', () => {
    const ledger = { ...COMMENT_EMAIL_LEDGER, table: 'cm_delivery_ledger' };
    const key = { delivery_id: 'd-1' };
    expect(resolveDeliveryClaim(
      { to: 'to@example.test', tenantId: 'tenant-1', delivery: { ledger, key, ledgerTenant: 'tenant-2' } },
      'comment-1',
    )).toEqual({ ledger, tenant: 'tenant-2', key });
  });

  it('T021: sendEventEmail forwards cc/bcc only when they are present', () => {
    expect(sendEventEmailSource).toContain('cc?: EmailAddress[];');
    expect(sendEventEmailSource).toContain('bcc?: EmailAddress[];');
    expect(sendEventEmailSource).toContain("...(params.cc?.length ? { cc: params.cc } : {}),");
    expect(sendEventEmailSource).toContain("...(params.bcc?.length ? { bcc: params.bcc } : {}),");
  });
});
