import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb, withAdminTransaction } from '@alga-psa/db';
import { TicketModel } from '@shared/models/ticketModel';
import {
  resolveAnthropicApiKey,
  tenantHasAiAssistantAddOn,
  TEAMS_NL_MODEL,
} from '../teams/bot/teamsNlIntent';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const TRANSCRIPT_INPUT_CHAR_CAP = 20_000;
const SUMMARY_TIMEOUT_MS = 20_000;

export interface AnnotateTicketFromTranscriptInput {
  tenantId: string;
  /** Meeting transcripts; omitted for a Teams Phone call transcript. */
  meetingId?: string | null;
  /** Call transcripts (F067): the telephony ledger row the transcript came from. */
  callRecordId?: string | null;
  source?: 'meeting' | 'call';
  /** Skips resolution when the caller already knows the ticket. */
  ticketId?: string | null;
  interactionId?: string | null;
  appointmentRequestId?: string | null;
  subject?: string | null;
  transcriptVtt: string;
  providerArtifactId?: string | null;
}

export type AnnotateTicketFromTranscriptResult =
  | { status: 'commented'; ticketId: string }
  | { status: 'skipped'; reason: string };

type SummarizeFn = (
  input: { subject: string | null; dialogue: string; source?: 'meeting' | 'call' },
) => Promise<string | null>;

/**
 * Reduce WEBVTT to speaker dialogue: drop the header, cue ids, and timestamp
 * lines; unwrap `<v Speaker>text</v>` voice tags to "Speaker: text".
 */
export function vttToDialogue(vtt: string): string {
  const lines = (vtt || '').split(/\r?\n/);
  const dialogue: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === 'WEBVTT' || line.includes('-->') || /^\d+$/.test(line) || line.startsWith('NOTE')) {
      continue;
    }
    const voiced = line.match(/^<v\s+([^>]+)>(.*?)(<\/v>)?$/i);
    dialogue.push(voiced ? `${voiced[1].trim()}: ${voiced[2].trim()}` : line.replace(/<[^>]+>/g, ''));
  }
  return dialogue.join('\n').slice(0, TRANSCRIPT_INPUT_CHAR_CAP);
}

async function resolveLinkedTicketId(input: AnnotateTicketFromTranscriptInput): Promise<string | null> {
  if (input.ticketId) {
    return String(input.ticketId);
  }

  const { knex } = await createTenantKnex(input.tenantId);
  const db = tenantDb(knex, input.tenantId);

  if (input.interactionId) {
    const row = await db.table('interactions')
      .where({ interaction_id: input.interactionId })
      .first('ticket_id');
    if (row?.ticket_id) {
      return String(row.ticket_id);
    }
  }

  if (input.appointmentRequestId) {
    const row = await db.table('appointment_requests')
      .where({ appointment_request_id: input.appointmentRequestId })
      .first('ticket_id');
    if (row?.ticket_id) {
      return String(row.ticket_id);
    }
  }

  return null;
}

async function claudeSummarize(
  input: { subject: string | null; dialogue: string; source?: 'meeting' | 'call' },
): Promise<string | null> {
  const kind = input.source === 'call' ? 'call' : 'meeting';
  const apiKey = await resolveAnthropicApiKey();
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
  try {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: TEAMS_NL_MODEL,
        max_tokens: 700,
        output_config: { effort: 'low' },
        system:
          `You summarize support-${kind} transcripts for the ticket record. Write a compact summary a ` +
          'technician can act on: 2-4 sentences of context, then bullet lists "Decisions" and "Action items" ' +
          '(omit an empty list). Plain text only. Never invent facts absent from the transcript.',
        messages: [
          {
            role: 'user',
            content: `${kind === 'call' ? 'Call' : 'Meeting subject'}: ${input.subject || '(none)'}\n\nTranscript:\n${input.dialogue}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn('[TranscriptTicketSummary] Claude request failed', { status: response.status });
      return null;
    }
    const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim();
    return text || null;
  } catch (error) {
    logger.warn('[TranscriptTicketSummary] Claude request errored', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * When a captured Teams transcript belongs to something linked to a ticket —
 * a meeting (via its interaction or appointment request) or a Teams Phone call
 * (via the ledger's ticket/interaction) — post an AI summary of the transcript
 * as an internal system comment on that ticket.
 *
 * Best-effort by contract: every failure path returns a skip — artifact
 * capture must never fail because summarization did. Gated on the AI
 * Assistant add-on and a configured Anthropic key.
 */
export async function annotateLinkedTicketFromTranscript(
  input: AnnotateTicketFromTranscriptInput,
  summarize: SummarizeFn = claudeSummarize,
): Promise<AnnotateTicketFromTranscriptResult> {
  const source: 'meeting' | 'call' = input.source ?? (input.callRecordId ? 'call' : 'meeting');
  const logContext = {
    tenant: input.tenantId,
    meeting_id: input.meetingId ?? null,
    call_record_id: input.callRecordId ?? null,
  };
  const skip = (reason: string): AnnotateTicketFromTranscriptResult => {
    logger.info('[TranscriptTicketSummary] Skipping transcript summary', {
      ...logContext,
      reason,
    });
    return { status: 'skipped', reason };
  };

  try {
    const ticketId = await resolveLinkedTicketId(input);
    if (!ticketId) {
      return skip('no_linked_ticket');
    }

    const { knex } = await createTenantKnex(input.tenantId);
    if (!(await tenantHasAiAssistantAddOn(knex, input.tenantId))) {
      return skip('ai_addon_inactive');
    }

    const dialogue = vttToDialogue(input.transcriptVtt);
    if (!dialogue.trim()) {
      return skip('empty_transcript');
    }

    const summary = await summarize({ subject: input.subject ?? null, dialogue, source });
    if (!summary) {
      return skip('summarizer_unavailable');
    }

    const header = `${source === 'call' ? 'Call' : 'Meeting'} transcript summary${input.subject ? ` — ${input.subject}` : ''}`;
    await withAdminTransaction(async (trx) => {
      await TicketModel.createComment(
        {
          ticket_id: ticketId,
          content: `${header}\n\n${summary}`,
          is_internal: true,
          author_type: 'system',
          metadata: {
            source: source === 'call' ? 'teams_call_transcript' : 'teams_meeting_transcript',
            meeting_id: input.meetingId ?? null,
            call_record_id: input.callRecordId ?? null,
            provider_artifact_id: input.providerArtifactId ?? null,
          },
        },
        input.tenantId,
        trx,
      );
    });

    logger.info('[TranscriptTicketSummary] Posted transcript summary to ticket', {
      ...logContext,
      ticket_id: ticketId,
    });
    return { status: 'commented', ticketId };
  } catch (error) {
    logger.warn('[TranscriptTicketSummary] Skipping transcript summary', {
      ...logContext,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 'skipped', reason: 'error' };
  }
}
