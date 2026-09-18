import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  createComment: vi.fn(async () => 'comment-1'),
  hasAiAddOn: { value: true },
  interactions: [] as Array<{ interaction_id: string; ticket_id: string | null }>,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withAdminTransaction: async (fn: (trx: unknown) => Promise<unknown>) => fn({}),
  tenantDb: () => ({
    table: (name: string) => ({
      where: (conditions: Record<string, string>) => ({
        first: async () => (name === 'interactions'
          ? hoisted.interactions.find((row) => row.interaction_id === conditions.interaction_id)
          : undefined),
      }),
    }),
  }),
}));

vi.mock('@shared/models/ticketModel', () => ({
  TicketModel: { createComment: hoisted.createComment },
}));

vi.mock('../../teams/bot/teamsNlIntent', () => ({
  resolveAnthropicApiKey: async () => 'key',
  tenantHasAiAssistantAddOn: async () => hoisted.hasAiAddOn.value,
  TEAMS_NL_MODEL: 'claude-test',
}));

import { annotateLinkedTicketFromTranscript } from '../transcriptTicketSummary';

const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n<v Dorothy Gale>The printer is on fire again.';

describe('annotateLinkedTicketFromTranscript', () => {
  beforeEach(() => {
    hoisted.createComment.mockClear();
    hoisted.hasAiAddOn.value = true;
    hoisted.interactions.length = 0;
  });

  it('T076: a call transcript is filed as a call summary on the ticket the call already carries', async () => {
    const summarize = vi.fn(async () => 'Caller reported a printer fire.');

    const result = await annotateLinkedTicketFromTranscript(
      {
        tenantId: 'tenant-1',
        source: 'call',
        callRecordId: 'call-record-1',
        ticketId: 'ticket-7',
        subject: 'Inbound call from +1 (555) 123-4567',
        transcriptVtt: VTT,
        providerArtifactId: 'tr-1',
      },
      summarize,
    );

    expect(result).toEqual({ status: 'commented', ticketId: 'ticket-7' });
    expect(summarize).toHaveBeenCalledWith(expect.objectContaining({ source: 'call' }));

    const [comment] = hoisted.createComment.mock.calls[0] as unknown as [Record<string, any>];
    expect(comment.content).toContain('Call transcript summary — Inbound call from +1 (555) 123-4567');
    expect(comment.is_internal).toBe(true);
    expect(comment.metadata).toEqual({
      source: 'teams_call_transcript',
      meeting_id: null,
      call_record_id: 'call-record-1',
      provider_artifact_id: 'tr-1',
    });
  });

  it('T076: a meeting transcript keeps its meeting wording and metadata', async () => {
    hoisted.interactions.push({ interaction_id: 'interaction-1', ticket_id: 'ticket-3' });

    const result = await annotateLinkedTicketFromTranscript(
      {
        tenantId: 'tenant-1',
        meetingId: 'meeting-1',
        interactionId: 'interaction-1',
        subject: 'Onboarding call',
        transcriptVtt: VTT,
      },
      async () => 'Discussed onboarding.',
    );

    expect(result).toEqual({ status: 'commented', ticketId: 'ticket-3' });
    const [comment] = hoisted.createComment.mock.calls[0] as unknown as [Record<string, any>];
    expect(comment.content).toContain('Meeting transcript summary — Onboarding call');
    expect(comment.metadata).toMatchObject({ source: 'teams_meeting_transcript', meeting_id: 'meeting-1' });
  });

  it('T076: a call with no ticket yet is skipped rather than guessing one', async () => {
    const result = await annotateLinkedTicketFromTranscript(
      {
        tenantId: 'tenant-1',
        source: 'call',
        callRecordId: 'call-record-1',
        ticketId: null,
        interactionId: 'interaction-unlinked',
        transcriptVtt: VTT,
      },
      async () => 'never used',
    );

    expect(result).toEqual({ status: 'skipped', reason: 'no_linked_ticket' });
    expect(hoisted.createComment).not.toHaveBeenCalled();
  });
});
