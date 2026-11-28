import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ticket comment outbound inline-image end-to-end contract', () => {
  it('T034: outbound ticket comment images are prepared at delivery, not by the subscriber', () => {
    const subscriberPath = path.resolve(
      __dirname,
      '../../../lib/eventBus/subscribers/ticketEmailSubscriber.ts'
    );
    const subscriber = fs.readFileSync(subscriberPath, 'utf-8');
    const sender = fs.readFileSync(path.resolve(
      __dirname, '../../../lib/notifications/sendEventEmail.ts',
    ), 'utf-8');
    const richText = fs.readFileSync(path.resolve(
      __dirname, '../../../lib/notifications/ticketRichTextEmail.ts',
    ), 'utf-8');

    expect(subscriber).not.toContain('rewriteTicketCommentImagesToCid');
    expect(sender).toContain('prepareTicketCommentRichTextEmail({');
    expect(sender).toContain('revalidateCommentOnRetry: needsRichTextPolicy');
    expect(richText).toContain('rewriteTicketCommentImagesToCid({');
    expect(richText).toContain('authorizedRecipientTicketDocument(');
  });

  it('T035: failed document-image conversion produces a visible placeholder', () => {
    const rewriteHelperPath = path.resolve(
      __dirname,
      '../../../lib/eventBus/subscribers/ticketCommentInlineImageEmail.ts'
    );
    const source = fs.readFileSync(rewriteHelperPath, 'utf-8');

    expect(source).toContain("reason: 'storage_download_failed'");
    expect(source).toContain("strategy: 'placeholder', reason: 'storage_download_failed'");
    expect(source).toContain('html: rewriteHtmlImageSources(params.html, replacementMap, params.missingImageText)');
  });
});
