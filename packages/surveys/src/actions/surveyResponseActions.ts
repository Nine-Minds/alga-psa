'use server';

import { withTransaction } from '@alga-psa/db';
import { z } from 'zod';

import { createTenantKnex, runWithTenant } from '@alga-psa/db';
import {
  hashSurveyToken,
  resolveSurveyTenantFromToken,
  type SurveyInvitationDetails,
} from './surveyTokenService';
import { publishEvent } from 'server/src/lib/eventBus/publishers';

const SURVEY_INVITATIONS_TABLE = 'survey_invitations';
const SURVEY_RESPONSES_TABLE = 'survey_responses';
const TICKETS_TABLE = 'tickets';
const CLIENTS_TABLE = 'clients';
const CONTACTS_TABLE = 'contacts';
const NEGATIVE_RATING_THRESHOLD = 2;

const submitResponseSchema = z.object({
  token: z.string().min(1),
  rating: z.number().int(),
  comment: z
    .string()
    .trim()
    .max(4000)
    .optional(),
});

export type SubmitSurveyResponseInput = z.input<typeof submitResponseSchema>;

export type SubmitSurveyResponseResult = {
  responseId: string;
};

export type SurveyInvitationView = {
  invitationId: string;
  templateId: string;
  ticketId: string;
  clientId: string | null;
  contactId: string | null;
  tokenExpiresAt: Date;
  template: SurveyInvitationDetails['template'];
};

type ResponseRow = {
  response_id: string;
  tenant: string;
  ticket_id: string;
  client_id: string | null;
  contact_id: string | null;
  template_id: string;
  rating: number;
  comment: string | null;
  survey_token_hash: string;
  token_expires_at: Date | string;
  submitted_at: Date | string;
  response_time_seconds: number | null;
};

type InvitationRow = {
  invitation_id: string;
  tenant: string;
  survey_token_hash: string;
  ticket_id: string;
  client_id: string | null;
  contact_id: string | null;
  template_id: string;
  sent_at: Date | string | null;
  responded: boolean;
};

type TicketRow = {
  ticket_id: string;
  ticket_number: string | null;
  client_id: string | null;
  contact_name_id: string | null;
  assigned_to: string | null;
  client_name?: string | null;
  contact_name?: string | null;
};

export async function getSurveyInvitationForToken(token: string): Promise<SurveyInvitationView> {
  const { tenant, invitation } = await resolveSurveyTenantFromToken(token);

  await runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex();

    await knex(SURVEY_INVITATIONS_TABLE)
      .where({
        tenant,
        invitation_id: invitation.invitationId,
      })
      .whereNull('opened_at')
      .update({ opened_at: knex.fn.now() })
      .catch(() => undefined);
  });

  return {
    invitationId: invitation.invitationId,
    templateId: invitation.templateId,
    ticketId: invitation.ticketId,
    clientId: invitation.clientId,
    contactId: invitation.contactId,
    tokenExpiresAt: invitation.tokenExpiresAt,
    template: invitation.template,
  };
}

export async function submitSurveyResponse(input: SubmitSurveyResponseInput): Promise<SubmitSurveyResponseResult> {
  const parsed = submitResponseSchema.parse(input);
  const trimmedComment = parsed.comment?.trim();
  const comment = trimmedComment && trimmedComment.length > 0 ? trimmedComment : null;

  const { tenant, invitation } = await resolveSurveyTenantFromToken(parsed.token);

  if (parsed.rating < 1 || parsed.rating > invitation.template.ratingScale) {
    throw new Error('Rating is outside the allowed range for this survey');
  }

  const hashedToken = hashSurveyToken(parsed.token);

  const { response, ticket } = await runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx) => {
      const invitationRow = await trx<InvitationRow>(SURVEY_INVITATIONS_TABLE)
        .where({
          tenant,
          invitation_id: invitation.invitationId,
          survey_token_hash: hashedToken,
        })
        .forUpdate()
        .first();

      if (!invitationRow) {
        throw new Error('Survey invitation not found for token');
      }

      if (invitationRow.responded) {
        throw new Error('Survey has already been completed');
      }

      const sentAt = invitationRow.sent_at ? toDate(invitationRow.sent_at) : null;
      const responseTimeSeconds = sentAt ? calculateSecondsBetween(sentAt, new Date()) : null;

      const [responseRow] = await trx<ResponseRow>(SURVEY_RESPONSES_TABLE)
        .insert({
          tenant,
          template_id: invitation.templateId,
          ticket_id: invitation.ticketId,
          client_id: invitation.clientId ?? invitationRow.client_id,
          contact_id: invitation.contactId ?? invitationRow.contact_id,
          rating: parsed.rating,
          comment,
          survey_token_hash: hashedToken,
          token_expires_at: invitation.tokenExpiresAt,
          response_time_seconds: responseTimeSeconds,
        })
        .returning('*');

      if (!responseRow) {
        throw new Error('Failed to save survey response');
      }

      await trx(SURVEY_INVITATIONS_TABLE)
        .where({ tenant, invitation_id: invitation.invitationId })
        .update({
          responded: true,
          responded_at: trx.fn.now(),
        });

      const ticketRow = await trx<TicketRow>(`${TICKETS_TABLE} as t`)
        .leftJoin(`${CLIENTS_TABLE} as c`, function joinClients() {
          this.on('t.client_id', '=', 'c.client_id').andOn('t.tenant', '=', 'c.tenant');
        })
        .leftJoin(`${CONTACTS_TABLE} as co`, function joinContacts() {
          this.on('t.contact_name_id', '=', 'co.contact_name_id').andOn('t.tenant', '=', 'co.tenant');
        })
        .select(
          't.ticket_id',
          't.ticket_number',
          't.client_id',
          't.contact_name_id',
          't.assigned_to',
          'c.client_name',
          'co.full_name as contact_name'
        )
        .where({ 't.tenant': tenant, 't.ticket_id': invitation.ticketId })
        .first();

      return { response: responseRow, ticket: ticketRow ?? null };
    });
  });

  await publishEvent({
    eventType: 'SURVEY_RESPONSE_SUBMITTED',
    payload: {
      tenantId: tenant,
      responseId: response.response_id,
      ticketId: response.ticket_id,
      companyId: response.client_id ?? undefined,
      rating: response.rating,
      hasComment: Boolean(response.comment),
    },
  });

  if (response.rating <= NEGATIVE_RATING_THRESHOLD) {
    await publishEvent({
      eventType: 'SURVEY_NEGATIVE_RESPONSE',
      payload: {
        tenantId: tenant,
        responseId: response.response_id,
        ticketId: response.ticket_id,
        ticketNumber: ticket?.ticket_number ?? response.ticket_id,
        companyId: response.client_id ?? undefined,
        companyName: ticket?.client_name ?? undefined,
        contactName: ticket?.contact_name ?? undefined,
        rating: response.rating,
        comment: response.comment ?? undefined,
        assignedTo: ticket?.assigned_to ?? undefined,
      },
    });
  }

  return { responseId: response.response_id };
}

function calculateSecondsBetween(start: Date, end: Date): number {
  const diff = Math.floor((end.getTime() - start.getTime()) / 1000);
  return diff >= 0 ? diff : 0;
}

function toDate(input: Date | string): Date {
  return input instanceof Date ? input : new Date(input);
}
