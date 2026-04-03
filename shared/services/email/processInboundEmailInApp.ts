import type { EmailMessageDetails } from '../../interfaces/inbound-email.interfaces';
import { createHash } from 'node:crypto';
import { convertHtmlToBlockNote, convertMarkdownToBlocks } from '../../lib/utils/contentConversion';
import { extractEmailDomain, normalizeEmailAddress } from '../../lib/email/addressUtils';
import {
  processInboundEmailArtifactsBestEffort,
  type ProcessInboundEmailArtifactsResult,
} from './processInboundEmailArtifacts';
import {
  buildInboundWatchListRecipients,
  mergeTicketWatchListRecipients,
  setTicketWatchListOnAttributes,
  type TicketWatchListRecipientInput,
} from '../../lib/tickets/watchList';

export interface ProcessInboundEmailInAppInput {
  tenantId: string;
  providerId: string;
  emailData: EmailMessageDetails;
}

export interface ProcessInboundEmailInAppOptions {
  collectDiagnostics?: boolean;
}

export interface ProcessInboundEmailInAppDiagnostics extends Record<string, unknown> {
  parser: {
    confidence: number | null;
    strategy: string | null;
    heuristics: string[];
    warnings: string[];
    parseError: string | null;
    tokenPresent: boolean;
    replyTokenHash: string | null;
    replyTokenSuffix: string | null;
  };
  headersSnapshot: {
    messageId: string;
    threadId: string | null;
    inReplyTo: string | null;
    references: string[];
    from: string | null;
    to: string[];
    subject: string | null;
  };
  threading: {
    tokenLookupAttempted: boolean;
    tokenLookupMatched: boolean;
    tokenLookupMissReason: 'token_missing' | 'token_not_found' | 'token_lookup_error' | null;
    tokenLookupError: string | null;
    headerLookupAttempted: boolean;
    headerLookupMatched: boolean;
    headerLookupMissReason: 'header_no_match' | 'header_lookup_error' | null;
    headerLookupError: string | null;
    matchedBy: 'reply_token' | 'thread_headers' | null;
    matchedTicketId: string | null;
    matchedCommentId: string | null;
    threadId: string | null;
    inReplyTo: string | null;
    references: string[];
    originalMessageIdCandidate: string | null;
    failureReason:
      | 'invalid_email_data'
      | 'missing_defaults'
      | 'self_notification'
      | 'new_ticket_created'
      | 'deduped'
      | null;
  };
  outcome?: {
    kind: 'skipped' | 'deduped' | 'replied' | 'created';
    matchedBy?: 'reply_token' | 'thread_headers';
    ticketId?: string;
    ticketNumber?: string;
    commentId?: string;
    dedupeKey?: string;
    reason?: 'missing_defaults' | 'invalid_email_data' | 'self_notification';
  };
}

type ProcessInboundEmailInAppBaseResult =
  | {
      outcome: 'skipped';
      reason: 'missing_defaults' | 'invalid_email_data' | 'self_notification';
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

export type ProcessInboundEmailInAppResult = ProcessInboundEmailInAppBaseResult & {
  diagnostics?: ProcessInboundEmailInAppDiagnostics;
};

const REPLY_TOKEN_SUFFIX_LENGTH = 8;

function getReplyTokenFingerprint(token?: string): {
  replyTokenHash: string | null;
  replyTokenSuffix: string | null;
} {
  const trimmedToken = typeof token === 'string' ? token.trim() : '';
  if (!trimmedToken) {
    return {
      replyTokenHash: null,
      replyTokenSuffix: null,
    };
  }

  return {
    replyTokenHash: createHash('sha256').update(trimmedToken).digest('hex'),
    replyTokenSuffix: trimmedToken.slice(-REPLY_TOKEN_SUFFIX_LENGTH),
  };
}

function buildDiagnostics(params: {
  emailData: EmailMessageDetails;
  senderEmail: string | null;
  parsedEmail?: any | null;
  parseError?: string | null;
  conversationToken?: string;
}): ProcessInboundEmailInAppDiagnostics {
  const fingerprint = getReplyTokenFingerprint(params.conversationToken);

  return {
    parser: {
      confidence: typeof params.parsedEmail?.confidence === 'number' ? params.parsedEmail.confidence : null,
      strategy:
        typeof params.parsedEmail?.strategy === 'string' && params.parsedEmail.strategy.trim()
          ? params.parsedEmail.strategy.trim()
          : null,
      heuristics: Array.isArray(params.parsedEmail?.appliedHeuristics)
        ? params.parsedEmail.appliedHeuristics.filter((value: unknown): value is string => typeof value === 'string')
        : [],
      warnings: Array.isArray(params.parsedEmail?.warnings)
        ? params.parsedEmail.warnings.filter((value: unknown): value is string => typeof value === 'string')
        : [],
      parseError: params.parseError ?? null,
      tokenPresent: Boolean(params.conversationToken),
      replyTokenHash: fingerprint.replyTokenHash,
      replyTokenSuffix: fingerprint.replyTokenSuffix,
    },
    headersSnapshot: {
      messageId: params.emailData.id,
      threadId: params.emailData.threadId ?? null,
      inReplyTo: params.emailData.inReplyTo ?? null,
      references: params.emailData.references ?? [],
      from: params.senderEmail,
      to: (params.emailData.to ?? []).map((recipient) => recipient.email),
      subject: params.emailData.subject ?? null,
    },
    threading: {
      tokenLookupAttempted: Boolean(params.conversationToken),
      tokenLookupMatched: false,
      tokenLookupMissReason: params.conversationToken ? null : 'token_missing',
      tokenLookupError: null,
      headerLookupAttempted: false,
      headerLookupMatched: false,
      headerLookupMissReason: null,
      headerLookupError: null,
      matchedBy: null,
      matchedTicketId: null,
      matchedCommentId: null,
      threadId: params.emailData.threadId ?? null,
      inReplyTo: params.emailData.inReplyTo ?? null,
      references: params.emailData.references ?? [],
      originalMessageIdCandidate: params.emailData.inReplyTo ?? params.emailData.id ?? null,
      failureReason: null,
    },
  };
}

function withDiagnostics<T extends ProcessInboundEmailInAppBaseResult>(
  result: T,
  diagnostics?: ProcessInboundEmailInAppDiagnostics
): ProcessInboundEmailInAppResult {
  if (!diagnostics) {
    return result;
  }

  diagnostics.outcome =
    result.outcome === 'skipped'
      ? { kind: result.outcome, reason: result.reason }
      : result.outcome === 'deduped'
        ? {
            kind: result.outcome,
            dedupeKey: result.dedupeKey,
            ticketId: result.ticketId,
            commentId: result.commentId,
          }
        : result.outcome === 'replied'
          ? {
              kind: result.outcome,
              matchedBy: result.matchedBy,
              ticketId: result.ticketId,
              commentId: result.commentId,
            }
          : {
              kind: result.outcome,
              ticketId: result.ticketId,
              ticketNumber: result.ticketNumber,
              commentId: result.commentId,
            };

  return {
    ...result,
    diagnostics,
  };
}

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

function stripAutomatedReplyMarkers(text: string): string {
  return text
    .replace(/\\?\[ALGA-REPLY-TOKEN[^\]\n\r]*(?:\])?/gi, ' ')
    .replace(/ALGA-REPLY-TOKEN:[^\n\r]*/gi, ' ')
    .replace(/ALGA-(?:TICKET|PROJECT|COMMENT|THREAD)-ID:[^\n\r]*/gi, ' ')
    .replace(/---\s*Please reply above this line\s*---/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasSubstantiveReplyContent(parsedEmail: any, emailData: EmailMessageDetails): boolean {
  const candidateText =
    parsedEmail?.sanitizedText ??
    parsedEmail?.text ??
    emailData.body?.text ??
    '';

  return stripAutomatedReplyMarkers(String(candidateText)).length > 0;
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

function normalizeEmbeddedContentId(value: string | undefined | null): string {
  if (!value) return '';
  return String(value).trim().replace(/^cid:/i, '').replace(/^<|>$/g, '').toLowerCase();
}

function rewriteEmbeddedImageSourcesInHtml(
  html: string,
  embeddedMappings: ProcessInboundEmailArtifactsResult['embeddedImageUrlMappings']
): string {
  if (!html || !embeddedMappings.length) return html;

  const dataUrlMap = new Map<string, string>();
  const cidMap = new Map<string, string>();

  for (const mapping of embeddedMappings) {
    if (mapping.source === 'data-url') {
      dataUrlMap.set(mapping.reference, mapping.url);
      continue;
    }

    if (mapping.source === 'cid') {
      const normalized = normalizeEmbeddedContentId(mapping.reference);
      if (normalized) {
        cidMap.set(normalized, mapping.url);
      }
    }
  }

  let rewritten = html;

  if (dataUrlMap.size > 0) {
    rewritten = rewritten.replace(
      /data:(image\/[a-z0-9.+-]+);base64,([^"'<>]+)/gim,
      (fullMatch: string, contentType: string, base64: string) => {
        const normalized = `data:${String(contentType).toLowerCase()};base64,${String(base64).replace(/\s+/g, '')}`;
        return dataUrlMap.get(normalized) || fullMatch;
      }
    );
  }

  if (cidMap.size > 0) {
    rewritten = rewritten.replace(/\bcid:([^"'<>\s)]+)/gim, (fullMatch: string, cid: string) => {
      const normalized = normalizeEmbeddedContentId(cid);
      return cidMap.get(normalized) || fullMatch;
    });
  }

  return rewritten;
}

async function maybeRewriteCommentWithEmbeddedAttachmentUrls(args: {
  tenantId: string;
  commentId: string;
  html?: string;
  text?: string;
  originalCommentContent: string;
  artifactsResult?: ProcessInboundEmailArtifactsResult;
}): Promise<void> {
  const embeddedMappings = args.artifactsResult?.embeddedImageUrlMappings ?? [];
  if (!args.html || embeddedMappings.length === 0) {
    return;
  }

  const rewrittenHtml = rewriteEmbeddedImageSourcesInHtml(args.html, embeddedMappings);
  if (!rewrittenHtml || rewrittenHtml === args.html) {
    return;
  }

  const rewrittenBlocks = blocksFromEmailBody({
    html: rewrittenHtml,
    text: args.text,
  });
  const rewrittenContent = JSON.stringify(rewrittenBlocks);
  if (rewrittenContent === args.originalCommentContent) {
    return;
  }

  try {
    const { withAdminTransaction } = await import('@alga-psa/db');
    await withAdminTransaction(async (trx: any) => {
      await trx('comments as c')
        .where('c.tenant', args.tenantId)
        .andWhere('c.comment_id', args.commentId)
        .update({
          note: rewrittenContent,
          updated_at: new Date(),
        });
    });
  } catch (error) {
    console.warn('processInboundEmailInApp: embedded image comment rewrite failed (continuing)', {
      tenantId: args.tenantId,
      commentId: args.commentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function processInboundEmailInApp(
  input: ProcessInboundEmailInAppInput,
  options: ProcessInboundEmailInAppOptions = {}
): Promise<ProcessInboundEmailInAppResult> {
  if (!input?.tenantId || !input?.providerId || !input?.emailData?.id) {
    const diagnostics = options.collectDiagnostics
      ? buildDiagnostics({
          emailData: input?.emailData ?? ({
            id: '',
            provider: 'imap',
            providerId: input?.providerId ?? '',
            tenant: input?.tenantId ?? '',
            receivedAt: '',
            from: { email: '' },
            to: [],
            subject: '',
            body: { text: '' },
          } as EmailMessageDetails),
          senderEmail: null,
        })
      : undefined;
    if (diagnostics) {
      diagnostics.threading.failureReason = 'invalid_email_data';
    }
    return withDiagnostics({ outcome: 'skipped', reason: 'invalid_email_data' }, diagnostics);
  }

  const tenantId = input.tenantId;
  const providerId = input.providerId;
  const emailData = input.emailData;
  const dedupeKey = buildDedupeKey(input);
  const senderEmail = normalizeEmailAddress(emailData.from?.email);

  // Fast-path: if we've already created a ticket for this email, never create a second one.
  const existingTicket = await findExistingEmailTicket({
    tenantId,
    providerId,
    messageId: emailData.id,
  });
  if (existingTicket) {
    const diagnostics = options.collectDiagnostics
      ? buildDiagnostics({
          emailData,
          senderEmail,
        })
      : undefined;
    if (diagnostics) {
      diagnostics.threading.matchedTicketId = existingTicket.ticketId;
      diagnostics.threading.failureReason = 'deduped';
    }
    return withDiagnostics({
      outcome: 'deduped',
      dedupeKey,
      ticketId: existingTicket.ticketId,
    }, diagnostics);
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
    findEmailProviderMailboxAddress,
    upsertTicketWatchListRecipients,
    createTicketFromEmail,
    createCommentFromEmail,
  } = await import('../../workflow/actions/emailWorkflowActions');

  let parsedEmail: any | null = null;
  let parseError: string | null = null;
  try {
    parsedEmail = await parseEmailReplyBody({
      text: emailData.body?.text,
      html: emailData.body?.html,
    });
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
    console.warn('processInboundEmailInApp: parseEmailReplyBody failed (continuing)', {
      tenantId,
      providerId,
      emailId: emailData.id,
      error: parseError,
    });
  }
  const resolveSenderContact = async (context: {
    ticketId?: string;
    defaultClientId?: string | null;
  } = {}) => {
    if (!senderEmail) {
      return null;
    }

    return findContactByEmail(senderEmail, tenantId, context);
  };

  let providerMailboxEmail: string | null = null;
  try {
    providerMailboxEmail = await findEmailProviderMailboxAddress(providerId, tenantId);
  } catch (error) {
    console.warn('processInboundEmailInApp: failed to resolve provider mailbox address (continuing)', {
      tenantId,
      providerId,
      emailId: emailData.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let inboundWatchListRecipients: TicketWatchListRecipientInput[] = [];
  try {
    inboundWatchListRecipients = buildInboundWatchListRecipients({
      to: emailData.to,
      cc: emailData.cc,
      senderEmail: emailData.from?.email,
      providerMailboxEmail,
    });
  } catch (error) {
    console.warn('processInboundEmailInApp: watch-list candidate build failed (continuing)', {
      tenantId,
      providerId,
      emailId: emailData.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const conversationToken = extractConversationToken(parsedEmail);
  const diagnostics = options.collectDiagnostics
    ? buildDiagnostics({
        emailData,
        senderEmail,
        parsedEmail,
        parseError,
        conversationToken,
      })
    : undefined;

  if (conversationToken && !hasSubstantiveReplyContent(parsedEmail, emailData)) {
    console.info('processInboundEmailInApp: skipping token-only inbound email with no reply content', {
      tenantId,
      providerId,
      emailId: emailData.id,
      hasConversationToken: true,
    });
    if (diagnostics) {
      diagnostics.threading.failureReason = 'self_notification';
    }
    return withDiagnostics({ outcome: 'skipped', reason: 'self_notification' }, diagnostics);
  }

  const senderIsProviderMailbox =
    Boolean(senderEmail) && Boolean(providerMailboxEmail) && senderEmail === providerMailboxEmail;
  const senderName =
    typeof emailData.from?.name === 'string' && emailData.from.name.trim()
      ? emailData.from.name.trim()
      : undefined;
  const hasReplySignals =
    Boolean(conversationToken) ||
    Boolean(emailData.inReplyTo) ||
    Boolean(emailData.threadId) ||
    Boolean(emailData.references?.length);

  if (senderIsProviderMailbox && hasReplySignals) {
    console.info('processInboundEmailInApp: skipping self-sent notification email', {
      tenantId,
      providerId,
      emailId: emailData.id,
      senderEmail,
      providerMailboxEmail,
      hasConversationToken: Boolean(conversationToken),
      hasInReplyTo: Boolean(emailData.inReplyTo),
      hasThreadId: Boolean(emailData.threadId),
      hasReferences: Boolean(emailData.references?.length),
    });
    if (diagnostics) {
      diagnostics.threading.failureReason = 'self_notification';
    }
    return withDiagnostics({ outcome: 'skipped', reason: 'self_notification' }, diagnostics);
  }

  const buildCommentEmailMetadata = (options: {
    matchedSenderEmail?: string | null;
    primaryContactEmail?: string | null;
  } = {}) => ({
    messageId: emailData.id,
    provider: emailData.provider,
    providerId,
    threadId: emailData.threadId,
    inReplyTo: emailData.inReplyTo,
    references: emailData.references,
    from: emailData.from,
    fromAddress: senderEmail ?? undefined,
    fromName: senderName,
    matchedAddress: options.matchedSenderEmail ?? senderEmail ?? undefined,
    contactEmail: options.primaryContactEmail ?? undefined,
    to: emailData.to,
    subject: emailData.subject,
    receivedAt: emailData.receivedAt,
  });

  const buildUnmatchedSenderWatchListRecipients = (matchedContactId?: string | null) => {
    if (matchedContactId || !senderEmail || senderIsProviderMailbox) {
      return [] as TicketWatchListRecipientInput[];
    }

    return [
      {
        email: senderEmail,
        active: true,
        name: senderName,
        source: 'inbound_from',
      },
    ] as TicketWatchListRecipientInput[];
  };

  const upsertWatchListBestEffort = async (
    ticketId: string,
    recipients: TicketWatchListRecipientInput[] = inboundWatchListRecipients
  ) => {
    if (!recipients.length) {
      return;
    }

    try {
      await upsertTicketWatchListRecipients(
        {
          ticketId,
          recipients,
        },
        tenantId
      );
    } catch (error) {
      console.warn('processInboundEmailInApp: watch-list upsert failed (continuing)', {
        tenantId,
        providerId,
        emailId: emailData.id,
        ticketId,
        recipientCount: recipients.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const token = conversationToken;
  if (token) {
    try {
      const match = await findTicketByReplyToken(String(token), tenantId);
      if (match?.ticketId) {
        if (diagnostics) {
          diagnostics.threading.tokenLookupMatched = true;
          diagnostics.threading.tokenLookupMissReason = null;
          diagnostics.threading.matchedBy = 'reply_token';
          diagnostics.threading.matchedTicketId = match.ticketId;
        }
        const existingCommentId = await findExistingEmailComment({
          tenantId,
          ticketId: match.ticketId,
          messageId: emailData.id,
        });
        if (existingCommentId) {
          if (diagnostics) {
            diagnostics.threading.matchedCommentId = existingCommentId;
            diagnostics.threading.failureReason = 'deduped';
          }
          return withDiagnostics({
            outcome: 'deduped',
            dedupeKey,
            ticketId: match.ticketId,
            commentId: existingCommentId,
          }, diagnostics);
        }

        const parsedHtml = parsedEmail?.sanitizedHtml ?? emailData.body?.html;
        const parsedText = parsedEmail?.sanitizedText ?? emailData.body?.text;
        const blocks = blocksFromEmailBody({
          html: parsedHtml,
          text: parsedText,
        });
        const serializedBlocks = JSON.stringify(blocks);
        const matchedSenderContact = await resolveSenderContact({ ticketId: match.ticketId });
        const matchedSenderIsInternalUser = matchedSenderContact?.user_type === 'internal';
        const matchedSenderContactId = matchedSenderContact?.contact_id || undefined;
        const watchListRecipients = mergeTicketWatchListRecipients(
          inboundWatchListRecipients,
          buildUnmatchedSenderWatchListRecipients(matchedSenderContactId ?? null)
        );
        const commentId = await createCommentFromEmail(
          {
            ticket_id: match.ticketId,
            content: serializedBlocks,
            source: 'email',
            author_type: matchedSenderIsInternalUser ? 'internal' : 'contact',
            author_id: matchedSenderContact?.user_id,
            contact_id: matchedSenderIsInternalUser ? undefined : matchedSenderContactId,
            metadata: {
              email: buildCommentEmailMetadata({
                matchedSenderEmail: matchedSenderContact?.matched_email ?? senderEmail ?? null,
                primaryContactEmail: matchedSenderContact?.email ?? null,
              }),
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

        const artifactsResult = await processInboundEmailArtifactsBestEffort({
          tenantId,
          providerId,
          ticketId: match.ticketId,
          emailData,
          scopeLabel: 'reply',
        });
        await maybeRewriteCommentWithEmbeddedAttachmentUrls({
          tenantId,
          commentId,
          html: parsedHtml,
          text: parsedText,
          originalCommentContent: serializedBlocks,
          artifactsResult,
        });

        await upsertWatchListBestEffort(match.ticketId, watchListRecipients);

        if (diagnostics) {
          diagnostics.threading.matchedCommentId = commentId;
        }
        return withDiagnostics({
          outcome: 'replied',
          matchedBy: 'reply_token',
          ticketId: match.ticketId,
          commentId,
        }, diagnostics);
      }
      if (diagnostics) {
        diagnostics.threading.tokenLookupMissReason = 'token_not_found';
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('processInboundEmailInApp: reply-token threading failed (continuing)', {
        tenantId,
        providerId,
        emailId: emailData.id,
        error: errorMessage,
      });
      if (diagnostics) {
        diagnostics.threading.tokenLookupMissReason = 'token_lookup_error';
        diagnostics.threading.tokenLookupError = errorMessage;
      }
    }
  }

  // Thread headers fallback.
  let threadedTicketId: string | null = null;
  if (diagnostics) {
    diagnostics.threading.headerLookupAttempted = true;
  }
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
      if (diagnostics) {
        diagnostics.threading.headerLookupMatched = true;
        diagnostics.threading.headerLookupMissReason = null;
        diagnostics.threading.matchedBy = 'thread_headers';
        diagnostics.threading.matchedTicketId = ticket.ticketId;
      }
    } else if (diagnostics) {
      diagnostics.threading.headerLookupMissReason = 'header_no_match';
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('processInboundEmailInApp: header threading failed (continuing)', {
      tenantId,
      providerId,
      emailId: emailData.id,
      error: errorMessage,
    });
    if (diagnostics) {
      diagnostics.threading.headerLookupMissReason = 'header_lookup_error';
      diagnostics.threading.headerLookupError = errorMessage;
    }
  }

  if (threadedTicketId) {
    const existingCommentId = await findExistingEmailComment({
      tenantId,
      ticketId: threadedTicketId,
      messageId: emailData.id,
    });
    if (existingCommentId) {
      if (diagnostics) {
        diagnostics.threading.matchedCommentId = existingCommentId;
        diagnostics.threading.failureReason = 'deduped';
      }
      return withDiagnostics({
        outcome: 'deduped',
        dedupeKey,
        ticketId: threadedTicketId,
        commentId: existingCommentId,
      }, diagnostics);
    }

    const parsedHtml = parsedEmail?.sanitizedHtml ?? emailData.body?.html;
    const parsedText = parsedEmail?.sanitizedText ?? emailData.body?.text;
    const blocks = blocksFromEmailBody({
      html: parsedHtml,
      text: parsedText,
    });
    const serializedBlocks = JSON.stringify(blocks);
    const matchedSenderContact = await resolveSenderContact({ ticketId: threadedTicketId });
    const matchedSenderIsInternalUser = matchedSenderContact?.user_type === 'internal';
    const matchedSenderContactId = matchedSenderContact?.contact_id || undefined;
    const watchListRecipients = mergeTicketWatchListRecipients(
      inboundWatchListRecipients,
      buildUnmatchedSenderWatchListRecipients(matchedSenderContactId ?? null)
    );
    const commentId = await createCommentFromEmail(
      {
        ticket_id: threadedTicketId,
        content: serializedBlocks,
        source: 'email',
        author_type: matchedSenderIsInternalUser ? 'internal' : 'contact',
        author_id: matchedSenderContact?.user_id,
        contact_id: matchedSenderIsInternalUser ? undefined : matchedSenderContactId,
        metadata: {
          email: buildCommentEmailMetadata({
            matchedSenderEmail: matchedSenderContact?.matched_email ?? senderEmail ?? null,
            primaryContactEmail: matchedSenderContact?.email ?? null,
          }),
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

    const artifactsResult = await processInboundEmailArtifactsBestEffort({
      tenantId,
      providerId,
      ticketId: threadedTicketId,
      emailData,
      scopeLabel: 'reply',
    });
    await maybeRewriteCommentWithEmbeddedAttachmentUrls({
      tenantId,
      commentId,
      html: parsedHtml,
      text: parsedText,
      originalCommentContent: serializedBlocks,
      artifactsResult,
    });

    await upsertWatchListBestEffort(threadedTicketId, watchListRecipients);

    if (diagnostics) {
      diagnostics.threading.matchedCommentId = commentId;
    }
    return withDiagnostics({
      outcome: 'replied',
      matchedBy: 'thread_headers',
      ticketId: threadedTicketId,
      commentId,
    }, diagnostics);
  }

  // New ticket path.
  const providerDefaults = await resolveInboundTicketDefaults(tenantId, providerId);
  if (!providerDefaults) {
    console.warn('processInboundEmailInApp: missing inbound ticket defaults; skipping email', {
      tenantId,
      providerId,
      emailId: emailData.id,
    });
    if (diagnostics) {
      diagnostics.threading.failureReason = 'missing_defaults';
    }
    return withDiagnostics({ outcome: 'skipped', reason: 'missing_defaults' }, diagnostics);
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

  const matchedSenderClientId = matchedSenderContact?.client_id || undefined;
  const matchedSenderContactId = matchedSenderContact?.contact_id || undefined;

  const destinationResolution = await resolveEffectiveInboundTicketDefaults({
    tenant: tenantId,
    providerId,
    providerDefaults,
    matchedContactId: matchedSenderContactId ?? null,
    matchedContactClientId: matchedSenderClientId ?? null,
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
    if (diagnostics) {
      diagnostics.threading.failureReason = 'missing_defaults';
    }
    return withDiagnostics({ outcome: 'skipped', reason: 'missing_defaults' }, diagnostics);
  }

  console.debug('processInboundEmailInApp: resolved inbound destination source', {
    tenantId,
    providerId,
    emailId: emailData.id,
    source: destinationResolution.source,
    fallbackReason: destinationResolution.fallbackReason ?? null,
  });
  let targetClientId = matchedSenderClientId ?? defaults.client_id;
  let targetContactId = matchedSenderContactId;

  // Domain fallback: if no exact contact match, use explicitly configured inbound-domain client mapping.
  if (!matchedSenderContact && domainMatchedClientId) {
    targetClientId = domainMatchedClientId;
    targetContactId = domainMatchedContactId ?? undefined;
  }

  // Only treat the email as authored by a contact when we have an exact sender email match.
  const matchedSenderIsInternalUser = matchedSenderContact?.user_type === 'internal';
  const commentAuthorContactId = matchedSenderIsInternalUser ? undefined : matchedSenderContactId;
  const commentAuthorUserId = matchedSenderContact?.user_id ?? null;
  const commentAuthorType = matchedSenderIsInternalUser ? 'internal' : 'contact';

  // Ticket creation requires a client. If neither defaults nor sender/domain matching
  // can resolve one, skip without failing the webhook.
  if (!targetClientId) {
    console.warn('processInboundEmailInApp: no target client resolved; skipping email', {
      tenantId,
      providerId,
      emailId: emailData.id,
      senderEmail,
    });
    if (diagnostics) {
      diagnostics.threading.failureReason = 'missing_defaults';
    }
    return withDiagnostics({ outcome: 'skipped', reason: 'missing_defaults' }, diagnostics);
  }

  // New-ticket idempotency: ticket could have been created in another parallel process.
  const existingTicketAfterDefaults = await findExistingEmailTicket({
    tenantId,
    providerId,
    messageId: emailData.id,
  });
  if (existingTicketAfterDefaults) {
    if (diagnostics) {
      diagnostics.threading.matchedTicketId = existingTicketAfterDefaults.ticketId;
      diagnostics.threading.failureReason = 'deduped';
    }
    return withDiagnostics({
      outcome: 'deduped',
      dedupeKey,
      ticketId: existingTicketAfterDefaults.ticketId,
    }, diagnostics);
  }

  const parsedHtml = parsedEmail?.sanitizedHtml ?? emailData.body?.html;
  const parsedText = parsedEmail?.sanitizedText ?? emailData.body?.text;
  const blocks = blocksFromEmailBody({
    html: parsedHtml,
    text: parsedText,
  });
  const serializedBlocks = JSON.stringify(blocks);
  const seededWatchList = mergeTicketWatchListRecipients(
    inboundWatchListRecipients,
    buildUnmatchedSenderWatchListRecipients(commentAuthorContactId ?? null)
  );
  const seededAttributes = setTicketWatchListOnAttributes(undefined, seededWatchList);

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
      attributes: seededAttributes ?? undefined,
    },
    tenantId
  );

  const commentId = await createCommentFromEmail(
    {
      ticket_id: ticketResult.ticket_id,
      content: serializedBlocks,
      source: 'email',
      // Unmatched inbound senders are still customer-originated replies even
      // when we cannot resolve them to an existing contact record.
      author_type: commentAuthorType,
      author_id: commentAuthorUserId ?? undefined,
      contact_id: commentAuthorContactId ?? undefined,
      metadata: {
        email: buildCommentEmailMetadata({
          matchedSenderEmail: matchedSenderContact?.matched_email ?? senderEmail ?? null,
          primaryContactEmail: matchedSenderContact?.email ?? null,
        }),
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

  const artifactsResult = await processInboundEmailArtifactsBestEffort({
    tenantId,
    providerId,
    ticketId: ticketResult.ticket_id,
    emailData,
    scopeLabel: 'new-ticket',
  });
  await maybeRewriteCommentWithEmbeddedAttachmentUrls({
    tenantId,
    commentId,
    html: parsedHtml,
    text: parsedText,
    originalCommentContent: serializedBlocks,
    artifactsResult,
  });

  if (diagnostics) {
    diagnostics.threading.failureReason = 'new_ticket_created';
  }
  return withDiagnostics({
    outcome: 'created',
    ticketId: ticketResult.ticket_id,
    ticketNumber: ticketResult.ticket_number,
    commentId,
  }, diagnostics);
}
