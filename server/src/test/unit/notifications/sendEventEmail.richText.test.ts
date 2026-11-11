import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  template: '',
  child: undefined as object | undefined,
  mirror: undefined as object | undefined,
  sendEmail: vi.fn(),
  getCapabilities: vi.fn(),
  prepareComment: vi.fn(),
  prepareDescription: vi.fn(),
  canReceive: vi.fn(),
  classifyRecipient: vi.fn(),
  isPublic: vi.fn(),
  reauthorize: vi.fn(),
  getTranslation: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (table: string) => {
      const chain = {
        where: () => chain,
        whereNull: () => chain,
        first: () => chain,
        toSQL: () => ({ sql: '', bindings: [] }),
        then: (resolve: (value: unknown) => unknown) => resolve(
          table === 'tenant_email_templates'
            ? { id: 'template-1', html_content: state.template, subject: 'Ticket update' }
            : table === 'tickets' ? state.child
              : table === 'ticket_bundle_mirrors' ? state.mirror : undefined,
        ),
      };
      return chain;
    },
  }),
}));

vi.mock('../../../lib/db/db', () => ({
  getConnection: async () => ({ client: { config: { connection: { database: 'test' } } } }),
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    getInstance: () => ({ sendEmail: state.sendEmail, getAttachmentCapabilities: state.getCapabilities }),
  },
  StaticTemplateProcessor: class {
    constructor(public subject: string, public html: string, public text: string) {}
  },
}));

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: state.getTranslation,
}));

vi.mock('../../../lib/notifications/ticketCommentAttachmentEmail', () => ({
  recipientCanReceiveCommentFiles: state.canReceive,
  recipientCanReceiveInternalComment: vi.fn(),
  classifyTicketEmailRecipient: state.classifyRecipient,
  authorizedRecipientTicketDocument: vi.fn(),
  prepareCommentAttachmentEmail: vi.fn(),
}));

vi.mock('../../../lib/notifications/ticketRichTextEmail', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../lib/notifications/ticketRichTextEmail')>(),
  prepareTicketCommentRichTextEmail: state.prepareComment,
  prepareTicketDescriptionRichTextEmail: state.prepareDescription,
}));

vi.mock('@shared/lib/ticketCommentAttachments', () => ({
  isPublicAttachmentComment: state.isPublic,
}));

vi.mock('@shared/lib/coManagedDelivery', () => ({
  coManagedDeliverySeam: { resolve: async () => ({ reauthorizeCommentRecipient: state.reauthorize }) },
}));

import {
  removeUnreferencedInlineAttachments,
  sendEventEmail,
  type SendEmailParams,
} from '../../../lib/notifications/sendEventEmail';

const image = { filename: 'image.png', content: Buffer.from('image'), cid: 'image-1' };
const unused = { filename: 'unused.png', content: Buffer.from('unused'), cid: 'unused-1' };
const file = { filename: 'notes.txt', content: 'notes' };
const prepared = (overrides = {}) => ({
  html: '<p>Current comment <img src="cid:image-1"></p>',
  text: 'Current comment',
  attachments: [image, unused],
  downloadLinks: [],
  managed: false,
  redacted: false,
  rawContent: 'current comment source',
  ...overrides,
});
const baseParams = (): SendEmailParams => ({
  mailClass: 'ticket',
  tenantId: 'tenant-1',
  entityType: 'ticket',
  entityId: 'ticket-1',
  to: ' To@example.test ',
  cc: [{ email: 'CC@example.test' }],
  bcc: [{ email: 'bcc@example.test' }],
  subject: 'Ticket update',
  template: 'ticket-comment-added',
  context: { ticket: { id: 'T-1' }, comment: { html: 'old comment', rawContent: 'old source' } },
  replyContext: { ticketId: 'ticket-1', commentId: 'comment-1', issueReplyToken: false },
  locale: 'fr',
});

beforeEach(() => {
  state.template = '<img data-alga-brand-logo src="cid:alga-brand-logo">{{{comment.html}}}';
  state.child = undefined;
  state.mirror = undefined;
  state.sendEmail.mockReset().mockResolvedValue({ success: true });
  state.getCapabilities.mockReset().mockResolvedValue({
    supportsAttachments: true, maxAttachmentSize: 2_000_000, blockedAttachmentExtensions: [],
  });
  state.prepareComment.mockReset().mockResolvedValue(prepared());
  state.prepareDescription.mockReset().mockResolvedValue(prepared());
  state.canReceive.mockReset().mockResolvedValue(true);
  state.classifyRecipient.mockReset().mockResolvedValue('internal');
  state.isPublic.mockReset().mockResolvedValue(true);
  state.reauthorize.mockReset().mockResolvedValue({
    email: 'to@example.test', principalId: 'sponsor-1', redactedFields: [],
  });
  state.getTranslation.mockReset().mockResolvedValue({
    t: (key: string) => key.endsWith('imageNotIncluded') ? '[Image non incluse]' : '[Contenu indisponible]',
  });
});

describe('ticket rich-text email delivery', () => {
  it('prepares persisted content for To, Cc and Bcc using the resolved locale', async () => {
    await sendEventEmail({
      ...baseParams(),
      attachments: [file],
    });

    expect(state.getTranslation).toHaveBeenCalledWith('fr', 'features/tickets');
    expect(state.prepareComment).toHaveBeenCalledWith(expect.objectContaining({
      ticketId: 'ticket-1',
      commentId: 'comment-1',
      recipients: ['to@example.test', 'cc@example.test', 'bcc@example.test'],
      missingImageText: '[Image non incluse]',
      unsupportedContentText: '[Contenu indisponible]',
      allowInlineImages: true,
      suppressProtectedContent: false,
    }));
    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.templateProcessor.html).toContain('Current comment');
    expect(sent.templateProcessor.html).not.toContain('old comment');
    expect(sent.templateProcessor.html).toContain('data-alga-brand-logo');
    expect(sent.attachments).toEqual([file, image]);
    expect(sent.cc).toEqual([{ email: 'CC@example.test' }]);
    expect(sent.bcc).toEqual([{ email: 'bcc@example.test' }]);
    expect(sent.revalidateCommentOnRetry).toBe(true);
  });

  it('does not trust precomputed images even when the current audience is internal', async () => {
    await sendEventEmail({
      ...baseParams(),
      attachments: [{ filename: 'banner.png', content: 'forged', cid: 'alga-brand-logo' }, {
        filename: 'stale.png', content: 'old',
      }, {
        filename: 'stale-cid.png', content: 'old', cid: 'unverified-image',
      }],
    });
    expect(state.sendEmail.mock.calls[0][0].templateProcessor.html).toContain('data-alga-brand-logo');
    expect(state.sendEmail.mock.calls[0][0].attachments).toEqual([image]);
  });

  it('suppresses images, protected embeds, precomputed files and download links for mixed To/Cc/Bcc', async () => {
    state.template = '<img data-alga-brand-logo src="cid:alga-brand-logo">{{{comment.html}}}|{{comment.rawContent}}';
    state.classifyRecipient.mockImplementation(async (_db, _tenant, _ticket, email) =>
      email === 'bcc@example.test' ? 'external' : 'internal');
    state.prepareComment.mockResolvedValue(prepared({
      html: '<p>Keep <a href="https://example.test/help">Help</a> ' +
        '<a href="/api/documents/download/secret">Private</a><img src="cid:image-1"></p>',
      attachments: [image, file],
      rawContent: 'secret image source',
      downloadLinks: ['https://alga.test/api/ticket-comment-attachments/download?token=secret'],
    }));
    await sendEventEmail({
      ...baseParams(),
      attachments: [file, { filename: 'banner.png', content: 'forged', cid: 'alga-brand-logo' },
        { filename: 'old.png', content: 'old', cid: 'comment-stale' }],
    });

    expect(state.prepareComment).toHaveBeenCalledWith(expect.objectContaining({
      allowInlineImages: false, suppressProtectedContent: true,
    }));
    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.templateProcessor.html).toContain('href="https://example.test/help"');
    expect(sent.templateProcessor.html).toContain('[Image non incluse]');
    expect(sent.templateProcessor.html).toContain('[Contenu indisponible]');
    expect(sent.templateProcessor.html).not.toMatch(/image-1|\/api\/documents|secret image source/);
    expect(sent.templateProcessor.text).not.toMatch(/token=secret|secret image source/);
    expect(sent.templateProcessor.html).toContain('data-alga-brand-logo');
    expect(sent.attachments).toEqual([]);
    expect(sent.cc).toEqual([{ email: 'CC@example.test' }]);
    expect(sent.bcc).toEqual([{ email: 'bcc@example.test' }]);
  });

  it('keeps reconstructed authorized non-image files for external recipients, not supplied files', async () => {
    state.classifyRecipient.mockResolvedValue('external');
    const authorizedFile = { filename: 'report.pdf', content: 'authorized', contentType: 'application/pdf' };
    state.prepareComment.mockResolvedValue(prepared({ attachments: [authorizedFile, image] }));
    await sendEventEmail({
      ...baseParams(), attachments: [
        file, { filename: 'unknown.bin', content: 'unverified', contentType: 'application/octet-stream' },
        { filename: 'stale.png', content: 'old' },
      ],
    });
    expect(state.prepareComment).toHaveBeenCalledWith(expect.objectContaining({
      allowInlineImages: false, suppressProtectedContent: false,
    }));
    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.templateProcessor.html).toContain('[Image non incluse]');
    expect(sent.templateProcessor.html).toContain('data-alga-brand-logo');
    expect(sent.attachments).toEqual([authorizedFile]);
  });

  it.each(['unknown', 'inactive'])('fails closed for an %s recipient', async classification => {
    state.classifyRecipient.mockImplementation(async (_db, _tenant, _ticket, email) =>
      email === 'bcc@example.test' ? (classification === 'inactive' ? 'unknown' : classification) : 'internal');
    await sendEventEmail({ ...baseParams(), attachments: [file] });
    expect(state.prepareComment).toHaveBeenCalledWith(expect.objectContaining({
      allowInlineImages: false, suppressProtectedContent: true,
    }));
    expect(state.sendEmail.mock.calls[0][0].attachments).toEqual([]);
  });

  it('reclassifies all recipients on retry when Bcc changes from staff to external', async () => {
    const params = baseParams();
    await sendEventEmail(params);
    state.classifyRecipient.mockImplementation(async (_db, _tenant, _ticket, email) =>
      email === 'bcc@example.test' ? 'external' : 'internal');
    await sendEventEmail(params);

    expect(state.prepareComment.mock.calls[0][0]).toMatchObject({
      allowInlineImages: true, suppressProtectedContent: false,
    });
    expect(state.prepareComment.mock.calls[1][0]).toMatchObject({
      allowInlineImages: false, suppressProtectedContent: true,
    });
    expect(state.sendEmail.mock.calls[0][0].attachments).toEqual([image]);
    expect(state.sendEmail.mock.calls[1][0].attachments).toEqual([]);
    expect(state.sendEmail.mock.calls[1][0].templateProcessor.html).toContain('[Image non incluse]');
  });

  it('retries without sending when the audience changes while content is being prepared', async () => {
    let bccChecks = 0;
    state.classifyRecipient.mockImplementation(async (_db, _tenant, _ticket, email) => {
      if (email !== 'bcc@example.test') return 'internal';
      return ++bccChecks === 1 ? 'internal' : 'external';
    });

    await expect(sendEventEmail(baseParams())).rejects.toMatchObject({
      errorCode: 'TICKET_EMAIL_AUDIENCE_CHANGED', isRetryable: true,
    });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it('sanitizes old queued content when there is no persisted source identity', async () => {
    state.template = '{{{comment.html}}}|{{comment.rawContent}}';
    await sendEventEmail({
      ...baseParams(),
      context: { ticket: { id: 'T-1' }, comment: {
        html: '<p>Keep <a href="https://example.test/help">Help</a>' +
          '<a href="&#47;api&#47;documents&#47;download&#47;doc-1">Private</a>' +
          '<img src="data:image/png;base64,YQ=="></p>' +
          '<div style="background-image:url(https://example.test/secret.png)">Details</div>' +
          '<svg><image href="https://example.test/secret.svg"></image></svg>',
        rawContent: 'old secret',
      } },
      replyContext: { ticketId: 'ticket-1', issueReplyToken: false },
      attachments: [file],
    });
    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.templateProcessor.html).toContain('https://example.test/help');
    expect(sent.templateProcessor.html).toContain('[Image non incluse]');
    expect(sent.templateProcessor.html).toContain('[Contenu indisponible]');
    expect(sent.templateProcessor.html).toContain('Details');
    expect(sent.templateProcessor.html).not.toMatch(/\/api\/documents|data:image|old secret|secret\.png|secret\.svg|<svg/);
    expect(sent.attachments).toEqual([]);
    expect(sent.revalidateCommentOnRetry).toBe(true);
    expect(state.prepareComment).not.toHaveBeenCalled();
  });

  it('sanitizes a legacy description without a separate HTML field or source identity', async () => {
    state.template = '{{{ticket.description}}}|{{{ticket.descriptionText}}}';
    const description = 'Keep <img src="https://example.test/old.png"> ' +
      '[Private](/api/%64ocuments/download/doc-1) [Help](https://example.test/help)';
    await sendEventEmail({
      ...baseParams(),
      template: 'ticket-created',
      context: { ticket: { id: 'T-1', description, descriptionText: description } },
      replyContext: { ticketId: 'ticket-1', issueReplyToken: false },
      attachments: [file],
    });

    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.templateProcessor.html).toContain('[Image non incluse]');
    expect(sent.templateProcessor.html).toContain('[Contenu indisponible]');
    expect(sent.templateProcessor.html).toContain('https://example.test/help');
    expect(sent.templateProcessor.html).not.toMatch(/<img|old\.png|%64ocuments|doc-1/);
    expect(sent.attachments).toEqual([]);
    expect(sent.revalidateCommentOnRetry).toBe(true);
    expect(state.prepareDescription).not.toHaveBeenCalled();
  });

  it('keeps ordinary legacy resolution text while removing images and protected links', async () => {
    state.template = '{{{ticket.resolution}}}';
    await sendEventEmail({
      ...baseParams(),
      template: 'ticket-closed',
      context: { ticket: {
        id: 'T-1',
        resolution: '<p>Issue resolved. <a href="https://example.test/help">Help</a> ' +
          '<a href="/api/documents/download/doc-1">Private</a><img src="https://example.test/image.png"></p>',
      } },
      replyContext: { ticketId: 'ticket-1', issueReplyToken: false },
    });

    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.templateProcessor.html).toContain('Issue resolved.');
    expect(sent.templateProcessor.html).toContain('https://example.test/help');
    expect(sent.templateProcessor.html).toContain('[Image non incluse]');
    expect(sent.templateProcessor.html).toContain('[Contenu indisponible]');
    expect(sent.templateProcessor.html).not.toMatch(/doc-1|image\.png/);
    expect(state.prepareComment).not.toHaveBeenCalled();
  });

  it('does not forward old precomputed attachments when the queued comment is empty', async () => {
    state.template = '{{{comment.html}}}';
    await sendEventEmail({
      ...baseParams(),
      context: { ticket: { id: 'T-1' }, comment: { html: '' } },
      replyContext: { ticketId: 'ticket-1', issueReplyToken: false },
      attachments: [file, image],
    });
    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.attachments).toEqual([]);
    expect(sent.revalidateCommentOnRetry).toBe(true);
    expect(state.prepareComment).not.toHaveBeenCalled();
  });

  it('reconstructs the message on retry after a recipient loses image access', async () => {
    state.template = '{{{comment.html}}}|{{comment.rawContent}}';
    const params = baseParams();
    await sendEventEmail(params);
    state.prepareComment.mockResolvedValue(prepared({
      html: '<p>Current comment <span>[Image non incluse]</span></p>',
      attachments: [],
      redacted: true,
      rawContent: null,
    }));
    await sendEventEmail(params);

    const retry = state.sendEmail.mock.calls[1][0];
    expect(state.prepareComment).toHaveBeenCalledTimes(2);
    expect(retry.templateProcessor.html).toContain('[Image non incluse]');
    expect(retry.templateProcessor.html).not.toContain('old source');
    expect(retry.attachments).toEqual([]);
    expect(retry.revalidateCommentOnRetry).toBe(true);
  });

  it('rechecks the destination for every bundle recipient before including source images', async () => {
    state.child = { ticket_id: 'child-1', master_ticket_id: 'ticket-1' };
    state.canReceive.mockImplementation(async (_db, _tenant, _ticket, email) => email !== 'bcc@example.test');
    state.prepareComment.mockResolvedValue(prepared({
      html: '<span>[Image non incluse]</span>', attachments: [], redacted: true, rawContent: null,
    }));
    await sendEventEmail({
      ...baseParams(),
      entityId: 'child-1',
      commentSource: { ticketId: 'ticket-1', commentId: 'comment-1' },
      replyContext: { ticketId: 'child-1', issueReplyToken: false },
    });

    expect(state.canReceive.mock.calls.map(call => call[3])).toEqual([
      'to@example.test', 'cc@example.test', 'bcc@example.test',
    ]);
    expect(state.prepareComment).toHaveBeenCalledWith(expect.objectContaining({
      audience: 'public', sharedDocumentAccess: false,
    }));
    expect([...new Set(state.classifyRecipient.mock.calls.map(call => call[2]))].sort())
      .toEqual(['child-1', 'ticket-1']);
    expect(state.sendEmail.mock.calls[0][0].templateProcessor.html).toContain('[Image non incluse]');
  });

  it('clears a resolution which is no longer visible instead of sending queued content', async () => {
    state.template = '{{{ticket.resolution}}}';
    state.prepareComment.mockResolvedValue(null);
    await sendEventEmail({
      ...baseParams(),
      template: 'ticket-closed',
      context: { ticket: { resolution: 'old private resolution' } },
      replyContext: { ticketId: 'ticket-1', issueReplyToken: false },
      ticketResolutionSource: { ticketId: 'ticket-1', commentId: 'resolution-1', audience: 'public' },
    });

    expect(state.prepareComment).toHaveBeenCalledWith(expect.objectContaining({
      commentId: 'resolution-1', requireResolution: true, imageOnly: true, audience: 'public',
    }));
    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.templateProcessor.html).not.toContain('old private resolution');
    expect(sent.attachments).toEqual([]);
    expect(sent.revalidateCommentOnRetry).toBe(true);
  });

  it('reconstructs description HTML and removes stale content if its source is unavailable', async () => {
    state.template = '{{ticket.description}}|{{{ticket.descriptionHtml}}}';
    state.prepareDescription.mockResolvedValueOnce(prepared({
      html: '<img src="cid:image-1">', text: 'current description',
    })).mockResolvedValueOnce(null);
    const params: SendEmailParams = {
      ...baseParams(),
      template: 'ticket-board-created',
      context: { ticket: { description: 'old secret', descriptionHtml: 'old secret' } },
      replyContext: { ticketId: 'ticket-1', issueReplyToken: false },
      ticketDescriptionSource: { ticketId: 'ticket-1', commentId: 'initial-comment' },
    };
    await sendEventEmail(params);
    await sendEventEmail(params);

    expect(state.prepareDescription).toHaveBeenCalledWith(expect.objectContaining({
      commentId: 'initial-comment', recipients: ['to@example.test', 'cc@example.test', 'bcc@example.test'],
    }));
    expect(state.sendEmail.mock.calls[0][0].templateProcessor.html).toContain('current description');
    expect(state.sendEmail.mock.calls[0][0].attachments).toEqual([image]);
    expect(state.sendEmail.mock.calls[1][0].templateProcessor.html).not.toContain('old secret');
    expect(state.sendEmail.mock.calls[1][0].attachments).toEqual([]);
  });

  it('retries rather than sending images if a sponsor address changes during authorization', async () => {
    state.reauthorize.mockResolvedValueOnce({
      email: 'to@example.test', principalId: 'sponsor-1', redactedFields: [],
    }).mockResolvedValueOnce({
      email: 'different@example.test', principalId: 'sponsor-1', redactedFields: [],
    });
    await expect(sendEventEmail({
      ...baseParams(),
      coManagedRecipient: {
        tenant: 'tenant-1', ticketId: 'ticket-1', commentId: 'comment-1',
        relationshipId: 'relationship-1', sponsorTenant: 'sponsor-tenant', principalId: 'sponsor-1',
      },
    })).rejects.toMatchObject({ errorCode: 'SPONSOR_RECIPIENT_CHANGED', isRetryable: true });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it('does not infer internal image access from a reauthorized sponsor identity', async () => {
    state.template = '{{{comment.html}}}|{{comment.rawContent}}';
    state.classifyRecipient.mockImplementation(async (_db, _tenant, _ticket, email) =>
      email === 'to@example.test' ? 'unknown' : 'internal');
    await sendEventEmail({
      ...baseParams(),
      coManagedRecipient: {
        tenant: 'tenant-1', ticketId: 'ticket-1', commentId: 'comment-1',
        relationshipId: 'relationship-1', sponsorTenant: 'sponsor-tenant', principalId: 'sponsor-1',
      },
    });

    expect(state.prepareComment).toHaveBeenCalledWith(expect.objectContaining({
      authorizedSponsorRecipient: 'to@example.test',
      allowInlineImages: false,
      suppressProtectedContent: true,
    }));
    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.templateProcessor.html).toContain('[Image non incluse]');
    expect(sent.templateProcessor.html).not.toContain('current comment source');
    expect(sent.attachments).toEqual([]);
  });

  it('removes prepared content and attachments if sponsor conversation access is revoked before sending', async () => {
    state.template = '{{{comment.html}}}';
    state.reauthorize.mockResolvedValueOnce({
      email: 'to@example.test', principalId: 'sponsor-1', redactedFields: [],
    }).mockResolvedValueOnce({
      email: 'to@example.test', principalId: 'sponsor-1', redactedFields: ['conversation'],
    });
    await sendEventEmail({
      ...baseParams(),
      coManagedRecipient: {
        tenant: 'tenant-1', ticketId: 'ticket-1', commentId: 'comment-1',
        relationshipId: 'relationship-1', sponsorTenant: 'sponsor-tenant', principalId: 'sponsor-1',
      },
    });
    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.templateProcessor.html).not.toContain('Current comment');
    expect(sent.attachments).toEqual([]);
  });

  it('retains non-inline attachments and only inline IDs referenced by rendered HTML', () => {
    const attachments = [
      file, image, unused, { filename: 'css.png', content: 'css', cid: 'css-1' },
    ];
    expect(removeUnreferencedInlineAttachments(
      '<p>cid:unused-1</p><img src="cid:image-1"><div style="background:url(\'cid:css-1\')"></div>',
      attachments,
    )).toEqual([file, image, attachments[3]]);
  });
});
