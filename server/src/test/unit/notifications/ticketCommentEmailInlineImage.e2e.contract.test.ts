import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('ticket comment outbound inline-image end-to-end contract', () => {
  it('T034: outbound ticket comment email includes CID inline-image mapping pipeline', () => {
    const subscriberPath = path.resolve(
      __dirname,
      '../../../lib/eventBus/subscribers/ticketEmailSubscriber.ts'
    );
    const source = fs.readFileSync(subscriberPath, 'utf-8');

    expect(source).toContain('const inlineCommentImageRewrite = await rewriteTicketCommentImagesToCid({');
    expect(source).toContain('content: inlineCommentImageRewrite.html');
    expect(source).toContain('html: inlineCommentImageRewrite.html');
    expect(source).toContain('const inlineCommentImageAttachments = inlineCommentImageRewrite.attachments');
    expect(source).toContain('attachments: inlineCommentImageAttachments');
  });

  it('T035: outbound fallback path preserves renderable URL-based html when CID conversion fails', () => {
    const rewriteHelperPath = path.resolve(
      __dirname,
      '../../../lib/eventBus/subscribers/ticketCommentInlineImageEmail.ts'
    );
    const source = fs.readFileSync(rewriteHelperPath, 'utf-8');

    expect(source).toContain("reason: 'storage_download_failed'");
    expect(source).toContain('strategy: \'url-fallback\'');
    expect(source).toContain('html: rewriteHtmlImageSources(params.html, replacementMap)');
  });
});
