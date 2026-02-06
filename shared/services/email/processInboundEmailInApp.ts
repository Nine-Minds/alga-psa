import type { EmailMessageDetails } from '../../interfaces/inbound-email.interfaces';
import { convertHtmlToBlockNote, convertMarkdownToBlocks } from '../../lib/utils/contentConversion';

export interface ProcessInboundEmailInAppInput {
  tenantId: string;
  providerId: string;
  emailData: EmailMessageDetails;
}

export type ProcessInboundEmailInAppResult =
  | {
      outcome: 'skipped';
      reason: 'missing_defaults' | 'invalid_email_data';
    }
  | {
      outcome: 'deduped';
      dedupeKey: string;
      ticketId?: string;
      commentId?: string;
    }
  | {
      outcome: 'replied';
      matchedBy: 'reply_token' | 'thread_headers';
      ticketId: string;
      commentId: string;
    }
  | {
      outcome: 'created';
      ticketId: string;
      ticketNumber?: string;
      commentId: string;
    };

function extractConversationToken(parsedEmail: any): string | undefined {
  const direct = parsedEmail?.tokens?.conversationToken;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  const nested = parsedEmail?.metadata?.parser?.tokens?.conversationToken;
  if (typeof nested === 'string' && nested.trim()) {
    return nested.trim();
  }
  return undefined;
}

function buildDedupeKey(input: ProcessInboundEmailInAppInput): string {
  return `inbound-email:${input.tenantId}:${input.providerId}:${input.emailData.id}`;
}

function blocksFallbackFromText(text: string) {
  return [
    {
      type: 'paragraph',
      content: [{ type: 'text', text, styles: {} }],
    },
  ];
}

function blocksFromEmailBody(params: {
  html?: string;
  text?: string;
}): unknown[] {
  const html = params.html?.trim();
  const text = params.text?.trim();

  if (html) {
    try {
      const blocks = convertHtmlToBlockNote(html);
      return blocks.length ? blocks : blocksFallbackFromText(text ?? '');
    } catch {
      return blocksFallbackFromText(text ?? '');
    }
  }

  if (text) {
    try {
      const blocks = convertMarkdownToBlocks(text);
      return blocks.length ? blocks : blocksFallbackFromText(text);
    } catch {
      return blocksFallbackFromText(text);
    }
  }

  return blocksFallbackFromText('');
}

async function findExistingEmailComment(params: {
  tenantId: string;
  ticketId: string;
  messageId: string;
}): Promise<string | null> {
  const { withAdminTransaction } = await import('@alga-psa/db');
  return withAdminTransaction(async (trx: any) => {
    const row = await trx('comments as c')
      .select('c.comment_id as commentId')
      .where('c.tenant', params.tenantId)
      .andWhere('c.ticket_id', params.ticketId)
      .andWhere(function (this: any) {
        this.whereRaw("c.metadata->'email'->>'messageId' = ?", [params.messageId]).orWhereRaw(
          "c.metadata->>'messageId' = ?",
          [params.messageId]
        );
      })
      .first();
    return row?.commentId ?? null;
  });
}

async function findExistingEmailTicket(params: {
  tenantId: string;
  providerId: string;
  messageId: string;
}): Promise<{ ticketId: string; ticketNumber?: string } | null> {
  const { withAdminTransaction } = await import('@alga-psa/db');
  return withAdminTransaction(async (trx: any) => {
    const row = await trx('tickets as t')
      .select('t.ticket_id as ticketId', 't.ticket_number as ticketNumber')
      .where('t.tenant', params.tenantId)
      .andWhereRaw("t.email_metadata->>'messageId' = ?", [params.messageId])
      .andWhere(function (this: any) {
        this.whereRaw("t.email_metadata->>'providerId' = ?", [params.providerId]).orWhereRaw(
          "t.email_metadata->>'provider_id' = ?",
          [params.providerId]
        );
      })
      .first();
    return row?.ticketId ? { ticketId: row.ticketId, ticketNumber: row.ticketNumber } : null;
  });
}

async function processEmailAttachmentsBestEffort(params: {
  tenantId: string;
  providerId: string;
  emailId: string;
  ticketId: string;
  attachments?: Array<{
    id: string;
    name: string;
    contentType: string;
    size: number;
    contentId?: string;
  }>;
}) {
  const { processEmailAttachment } = await import(
    '../../workflow/actions/emailWorkflowActions'
  );

  const attachments = params.attachments ?? [];
  for (const attachment of attachments) {
    try {
      await processEmailAttachment(
        {
          emailId: params.emailId,
          attachmentId: attachment.id,
          ticketId: params.ticketId,
          tenant: params.tenantId,
          providerId: params.providerId,
          attachmentData: {
            id: attachment.id,
            name: attachment.name,
            contentType: attachment.contentType,
            size: attachment.size,
            contentId: attachment.contentId,
          },
        },
        params.tenantId
      );
    } catch (error) {
      console.warn('processInboundEmailInApp: attachment processing failed (continuing)', {
        tenantId: params.tenantId,
        providerId: params.providerId,
        emailId: params.emailId,
        ticketId: params.ticketId,
        attachmentId: attachment.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function processInboundEmailInApp(
  input: ProcessInboundEmailInAppInput
): Promise<ProcessInboundEmailInAppResult> {
  if (!input?.tenantId || !input?.providerId || !input?.emailData?.id) {
    return { outcome: 'skipped', reason: 'invalid_email_data' };
  }

  const tenantId = input.tenantId;
  const providerId = input.providerId;
  const emailData = input.emailData;
  const dedupeKey = buildDedupeKey(input);

  // Fast-path: if we've already created a ticket for this email, never create a second one.
  const existingTicket = await findExistingEmailTicket({
    tenantId,
    providerId,
    messageId: emailData.id,
  });
  if (existingTicket) {
    return {
      outcome: 'deduped',
      dedupeKey,
      ticketId: existingTicket.ticketId,
    };
  }

  const {
    parseEmailReplyBody,
    findTicketByReplyToken,
    findTicketByEmailThread,
    resolveInboundTicketDefaults,
    findContactByEmail,
    createTicketFromEmail,
    createCommentFromEmail,
  } = await import('../../workflow/actions/emailWorkflowActions');

  let parsedEmail: any | null = null;
  try {
    parsedEmail = await parseEmailReplyBody({
      text: emailData.body?.text,
      html: emailData.body?.html,
    });
  } catch (error) {
    console.warn('processInboundEmailInApp: parseEmailReplyBody failed (continuing)', {
      tenantId,
      providerId,
      emailId: emailData.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const token = extractConversationToken(parsedEmail);
  if (token) {
    try {
      const match = await findTicketByReplyToken(String(token), tenantId);
      if (match?.ticketId) {
        const existingCommentId = await findExistingEmailComment({
          tenantId,
          ticketId: match.ticketId,
          messageId: emailData.id,
        });
        if (existingCommentId) {
          return {
            outcome: 'deduped',
            dedupeKey,
            ticketId: match.ticketId,
            commentId: existingCommentId,
          };
        }

        const blocks = blocksFromEmailBody({
          html: parsedEmail?.sanitizedHtml ?? emailData.body?.html,
          text: parsedEmail?.sanitizedText ?? emailData.body?.text,
        });
        const commentId = await createCommentFromEmail(
          {
            ticket_id: match.ticketId,
            content: JSON.stringify(blocks),
            source: 'email',
            author_type: 'contact',
            metadata: {
              email: {
                messageId: emailData.id,
                provider: emailData.provider,
                providerId,
                threadId: emailData.threadId,
                inReplyTo: emailData.inReplyTo,
                references: emailData.references,
                from: emailData.from,
                to: emailData.to,
                subject: emailData.subject,
                receivedAt: emailData.receivedAt,
              },
              parser: {
                confidence: parsedEmail?.confidence,
                strategy: parsedEmail?.strategy,
                heuristics: parsedEmail?.appliedHeuristics,
                warnings: parsedEmail?.warnings,
              },
            },
            inboundReplyEvent: {
              messageId: emailData.id,
              threadId: emailData.threadId,
              from: emailData.from?.email ?? '',
              to: (emailData.to ?? []).map((r) => r.email),
              subject: emailData.subject,
              receivedAt: emailData.receivedAt,
              provider: emailData.provider,
              matchedBy: 'reply_token',
            },
          },
          tenantId
        );

        await processEmailAttachmentsBestEffort({
          tenantId,
          providerId,
          emailId: emailData.id,
          ticketId: match.ticketId,
          attachments: emailData.attachments?.map((a) => ({
            id: a.id,
            name: a.name,
            contentType: a.contentType,
            size: a.size,
            contentId: a.contentId,
          })),
        });

        return {
          outcome: 'replied',
          matchedBy: 'reply_token',
          ticketId: match.ticketId,
          commentId,
        };
      }
    } catch (error) {
      console.warn('processInboundEmailInApp: reply-token threading failed (continuing)', {
        tenantId,
        providerId,
        emailId: emailData.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Thread headers fallback.
  let threadedTicketId: string | null = null;
  try {
    const ticket = await findTicketByEmailThread(
      {
        threadId: emailData.threadId,
        inReplyTo: emailData.inReplyTo,
        references: emailData.references,
        originalMessageId: emailData.inReplyTo ?? emailData.id,
      },
      tenantId
    );
    if (ticket?.ticketId) {
      threadedTicketId = ticket.ticketId;
    }
  } catch (error) {
    console.warn('processInboundEmailInApp: header threading failed (continuing)', {
      tenantId,
      providerId,
      emailId: emailData.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (threadedTicketId) {
    const existingCommentId = await findExistingEmailComment({
      tenantId,
      ticketId: threadedTicketId,
      messageId: emailData.id,
    });
    if (existingCommentId) {
      return {
        outcome: 'deduped',
        dedupeKey,
        ticketId: threadedTicketId,
        commentId: existingCommentId,
      };
    }

    const blocks = blocksFromEmailBody({
      html: parsedEmail?.sanitizedHtml ?? emailData.body?.html,
      text: parsedEmail?.sanitizedText ?? emailData.body?.text,
    });
    const commentId = await createCommentFromEmail(
      {
        ticket_id: threadedTicketId,
        content: JSON.stringify(blocks),
        source: 'email',
        author_type: 'contact',
        metadata: {
          email: {
            messageId: emailData.id,
            provider: emailData.provider,
            providerId,
            threadId: emailData.threadId,
            inReplyTo: emailData.inReplyTo,
            references: emailData.references,
            from: emailData.from,
            to: emailData.to,
            subject: emailData.subject,
            receivedAt: emailData.receivedAt,
          },
          parser: {
            confidence: parsedEmail?.confidence,
            strategy: parsedEmail?.strategy,
            heuristics: parsedEmail?.appliedHeuristics,
            warnings: parsedEmail?.warnings,
          },
        },
        inboundReplyEvent: {
          messageId: emailData.id,
          threadId: emailData.threadId,
          from: emailData.from?.email ?? '',
          to: (emailData.to ?? []).map((r) => r.email),
          subject: emailData.subject,
          receivedAt: emailData.receivedAt,
          provider: emailData.provider,
          matchedBy: 'thread_headers',
        },
      },
      tenantId
    );

    await processEmailAttachmentsBestEffort({
      tenantId,
      providerId,
      emailId: emailData.id,
      ticketId: threadedTicketId,
      attachments: emailData.attachments?.map((a) => ({
        id: a.id,
        name: a.name,
        contentType: a.contentType,
        size: a.size,
        contentId: a.contentId,
      })),
    });

    return {
      outcome: 'replied',
      matchedBy: 'thread_headers',
      ticketId: threadedTicketId,
      commentId,
    };
  }

  // New ticket path.
  const defaults = await resolveInboundTicketDefaults(tenantId, providerId);
  if (!defaults) {
    console.warn('processInboundEmailInApp: missing inbound ticket defaults; skipping email', {
      tenantId,
      providerId,
      emailId: emailData.id,
    });
    return { outcome: 'skipped', reason: 'missing_defaults' };
  }

  const senderEmail = emailData.from?.email?.toLowerCase();
  const matchedContact = senderEmail
    ? await findContactByEmail(senderEmail, tenantId)
    : null;

  const targetClientId = matchedContact?.client_id ?? defaults.client_id;
  const targetContactId = matchedContact?.contact_id;

  // New-ticket idempotency: ticket could have been created in another parallel process.
  const existingTicketAfterDefaults = await findExistingEmailTicket({
    tenantId,
    providerId,
    messageId: emailData.id,
  });
  if (existingTicketAfterDefaults) {
    return {
      outcome: 'deduped',
      dedupeKey,
      ticketId: existingTicketAfterDefaults.ticketId,
    };
  }

  const blocks = blocksFromEmailBody({
    html: parsedEmail?.sanitizedHtml ?? emailData.body?.html,
    text: parsedEmail?.sanitizedText ?? emailData.body?.text,
  });

  const ticketResult = await createTicketFromEmail(
    {
      title: emailData.subject || '(no subject)',
      description: parsedEmail?.sanitizedText ?? emailData.body?.text ?? '',
      client_id: targetClientId,
      contact_id: targetContactId,
      source: 'email',
      board_id: defaults.board_id,
      status_id: defaults.status_id,
      priority_id: defaults.priority_id,
      category_id: defaults.category_id,
      subcategory_id: defaults.subcategory_id,
      location_id: defaults.location_id,
      entered_by: defaults.entered_by,
      email_metadata: {
        messageId: emailData.id,
        threadId: emailData.threadId,
        from: emailData.from,
        inReplyTo: emailData.inReplyTo,
        references: emailData.references,
        providerId,
      },
    },
    tenantId
  );

  const commentId = await createCommentFromEmail(
    {
      ticket_id: ticketResult.ticket_id,
      content: JSON.stringify(blocks),
      source: 'email',
      author_type: targetContactId ? 'contact' : 'system',
      metadata: {
        email: {
          messageId: emailData.id,
          provider: emailData.provider,
          providerId,
          threadId: emailData.threadId,
          inReplyTo: emailData.inReplyTo,
          references: emailData.references,
          from: emailData.from,
          to: emailData.to,
          subject: emailData.subject,
          receivedAt: emailData.receivedAt,
        },
        parser: {
          confidence: parsedEmail?.confidence,
          strategy: parsedEmail?.strategy,
          heuristics: parsedEmail?.appliedHeuristics,
          warnings: parsedEmail?.warnings,
        },
        unmatchedSender: !targetContactId,
      },
    },
    tenantId
  );

  await processEmailAttachmentsBestEffort({
    tenantId,
    providerId,
    emailId: emailData.id,
    ticketId: ticketResult.ticket_id,
    attachments: emailData.attachments?.map((a) => ({
      id: a.id,
      name: a.name,
      contentType: a.contentType,
      size: a.size,
      contentId: a.contentId,
    })),
  });

  return {
    outcome: 'created',
    ticketId: ticketResult.ticket_id,
    ticketNumber: ticketResult.ticket_number,
    commentId,
  };
}
