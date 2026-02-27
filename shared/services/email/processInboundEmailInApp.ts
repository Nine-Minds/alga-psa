import type { EmailMessageDetails } from '../../interfaces/inbound-email.interfaces';
import { convertHtmlToBlockNote, convertMarkdownToBlocks } from '../../lib/utils/contentConversion';
import { extractEmailDomain, normalizeEmailAddress } from '../../lib/email/addressUtils';
import { processInboundEmailArtifactsBestEffort } from './processInboundEmailArtifacts';

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
    resolveEffectiveInboundTicketDefaults,
    findContactByEmail,
    findClientIdByInboundEmailDomain,
    findValidClientPrimaryContactId,
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

  const senderEmail = normalizeEmailAddress(emailData.from?.email);
  const resolveSenderContact = async (context: {
    ticketId?: string;
    defaultClientId?: string | null;
  } = {}) => {
    if (!senderEmail) {
      return null;
    }

    return findContactByEmail(senderEmail, tenantId, context);
  };

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
        const matchedSenderContact = await resolveSenderContact({ ticketId: match.ticketId });
        const commentId = await createCommentFromEmail(
          {
            ticket_id: match.ticketId,
            content: JSON.stringify(blocks),
            source: 'email',
            author_type: 'contact',
            author_id: matchedSenderContact?.user_id,
            contact_id: matchedSenderContact?.contact_id,
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

        await processInboundEmailArtifactsBestEffort({
          tenantId,
          providerId,
          ticketId: match.ticketId,
          emailData,
          scopeLabel: 'reply',
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
    const matchedSenderContact = await resolveSenderContact({ ticketId: threadedTicketId });
    const commentId = await createCommentFromEmail(
      {
        ticket_id: threadedTicketId,
        content: JSON.stringify(blocks),
        source: 'email',
        author_type: 'contact',
        author_id: matchedSenderContact?.user_id,
        contact_id: matchedSenderContact?.contact_id,
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

    await processInboundEmailArtifactsBestEffort({
      tenantId,
      providerId,
      ticketId: threadedTicketId,
      emailData,
      scopeLabel: 'reply',
    });

    return {
      outcome: 'replied',
      matchedBy: 'thread_headers',
      ticketId: threadedTicketId,
      commentId,
    };
  }

  // New ticket path.
  const providerDefaults = await resolveInboundTicketDefaults(tenantId, providerId);
  if (!providerDefaults) {
    console.warn('processInboundEmailInApp: missing inbound ticket defaults; skipping email', {
      tenantId,
      providerId,
      emailId: emailData.id,
    });
    return { outcome: 'skipped', reason: 'missing_defaults' };
  }

  const matchedSenderContact = await resolveSenderContact({
    defaultClientId: providerDefaults.client_id ?? null,
  });

  let domainMatchedClientId: string | null = null;
  let domainMatchedContactId: string | null = null;
  if (!matchedSenderContact && senderEmail) {
    const senderDomain = extractEmailDomain(senderEmail);
    if (senderDomain) {
      domainMatchedClientId = await findClientIdByInboundEmailDomain(senderDomain, tenantId);
      if (domainMatchedClientId) {
        domainMatchedContactId = await findValidClientPrimaryContactId(domainMatchedClientId, tenantId);
      }
    }
  }

  const destinationResolution = await resolveEffectiveInboundTicketDefaults({
    tenant: tenantId,
    providerId,
    providerDefaults,
    matchedContactId: matchedSenderContact?.contact_id ?? null,
    matchedContactClientId: matchedSenderContact?.client_id ?? null,
    domainMatchedClientId,
  });

  const defaults = destinationResolution.defaults;
  if (!defaults) {
    console.warn('processInboundEmailInApp: no effective inbound destination resolved; skipping email', {
      tenantId,
      providerId,
      emailId: emailData.id,
      source: destinationResolution.source,
      fallbackReason: destinationResolution.fallbackReason ?? null,
    });
    return { outcome: 'skipped', reason: 'missing_defaults' };
  }

  console.debug('processInboundEmailInApp: resolved inbound destination source', {
    tenantId,
    providerId,
    emailId: emailData.id,
    source: destinationResolution.source,
    fallbackReason: destinationResolution.fallbackReason ?? null,
  });
  let targetClientId = matchedSenderContact?.client_id ?? defaults.client_id;
  let targetContactId = matchedSenderContact?.contact_id;

  // Domain fallback: if no exact contact match, use explicitly configured inbound-domain client mapping.
  if (!matchedSenderContact && domainMatchedClientId) {
    targetClientId = domainMatchedClientId;
    targetContactId = domainMatchedContactId ?? undefined;
  }

  // Only treat the email as authored by a contact when we have an exact sender email match.
  const commentAuthorContactId = matchedSenderContact?.contact_id;
  const commentAuthorUserId = matchedSenderContact?.user_id ?? null;

  // Ticket creation requires a client. If neither defaults nor sender/domain matching
  // can resolve one, skip without failing the webhook.
  if (!targetClientId) {
    console.warn('processInboundEmailInApp: no target client resolved; skipping email', {
      tenantId,
      providerId,
      emailId: emailData.id,
      senderEmail,
    });
    return { outcome: 'skipped', reason: 'missing_defaults' };
  }

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
      // Avoid cross-client location_id mismatch when we infer a different client than the defaults.
      location_id: targetClientId === defaults.client_id ? defaults.location_id : null,
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
      author_type: commentAuthorContactId ? 'contact' : 'system',
      author_id: commentAuthorUserId ?? undefined,
      contact_id: commentAuthorContactId ?? undefined,
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
        unmatchedSender: !commentAuthorContactId,
      },
    },
    tenantId
  );

  await processInboundEmailArtifactsBestEffort({
    tenantId,
    providerId,
    ticketId: ticketResult.ticket_id,
    emailData,
    scopeLabel: 'new-ticket',
  });

  return {
    outcome: 'created',
    ticketId: ticketResult.ticket_id,
    ticketNumber: ticketResult.ticket_number,
    commentId,
  };
}
