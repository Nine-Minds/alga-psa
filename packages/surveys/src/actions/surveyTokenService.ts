import { createHash, randomBytes } from 'crypto';

import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';

import { createTenantKnex, runWithTenant } from '@alga-psa/db';

type InvitationLookupRow = {
  tenant: string;
  invitation_id: string;
};

type InvitationDetailRow = {
  invitation_id: string;
  tenant: string;
  template_id: string;
  ticket_id: string;
  client_id: string | null;
  contact_id: string | null;
  token_expires_at: Date | string;
  responded: boolean;
  responded_at: Date | string | null;
  opened_at: Date | string | null;
  prompt_text: string;
  comment_prompt: string;
  thank_you_text: string;
  rating_type: string;
  rating_scale: number;
  rating_labels: unknown;
};

export interface SurveyInvitationDetails {
  invitationId: string;
  tenant: string;
  templateId: string;
  ticketId: string;
  clientId: string | null;
  contactId: string | null;
  tokenExpiresAt: Date;
  responded: boolean;
  respondedAt: Date | null;
  openedAt: Date | null;
  template: {
    promptText: string;
    commentPrompt: string;
    thankYouText: string;
    ratingType: string;
    ratingScale: number;
    ratingLabels: Record<string, string>;
  };
}

export interface ResolvedSurveyInvitation {
  tenant: string;
  invitation: SurveyInvitationDetails;
}

const SURVEY_INVITATIONS_TABLE = 'survey_invitations';
const SURVEY_TEMPLATES_TABLE = 'survey_templates';

export function issueSurveyToken(): { plainToken: string; hashedToken: string } {
  const plainToken = randomBytes(32).toString('base64url');

  return {
    plainToken,
    hashedToken: hashSurveyToken(plainToken),
  } as const;
}

export function hashSurveyToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

export async function resolveSurveyTenantFromToken(token: string): Promise<ResolvedSurveyInvitation> {
  if (!token) {
    throw new Error('Survey token is required.');
  }

  const hashedToken = hashSurveyToken(token);
  const admin = await getAdminConnection();

  const lookup = await admin<InvitationLookupRow>(SURVEY_INVITATIONS_TABLE)
    .select(['tenant', 'invitation_id'])
    .where('survey_token_hash', hashedToken)
    .first();

  if (!lookup || typeof lookup.tenant !== 'string') {
    throw new Error('Invalid or expired survey token.');
  }

  const tenantId = lookup.tenant;

  const invitationRow = await runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();

    return knex<InvitationDetailRow>(SURVEY_INVITATIONS_TABLE)
      .select([
        `${SURVEY_INVITATIONS_TABLE}.invitation_id`,
        `${SURVEY_INVITATIONS_TABLE}.tenant`,
        `${SURVEY_INVITATIONS_TABLE}.template_id`,
        `${SURVEY_INVITATIONS_TABLE}.ticket_id`,
        `${SURVEY_INVITATIONS_TABLE}.client_id`,
        `${SURVEY_INVITATIONS_TABLE}.contact_id`,
        `${SURVEY_INVITATIONS_TABLE}.token_expires_at`,
        `${SURVEY_INVITATIONS_TABLE}.responded`,
        `${SURVEY_INVITATIONS_TABLE}.responded_at`,
        `${SURVEY_INVITATIONS_TABLE}.opened_at`,
        `${SURVEY_TEMPLATES_TABLE}.prompt_text`,
        `${SURVEY_TEMPLATES_TABLE}.comment_prompt`,
        `${SURVEY_TEMPLATES_TABLE}.thank_you_text`,
        `${SURVEY_TEMPLATES_TABLE}.rating_type`,
        `${SURVEY_TEMPLATES_TABLE}.rating_scale`,
        `${SURVEY_TEMPLATES_TABLE}.rating_labels`,
      ])
      .innerJoin(SURVEY_TEMPLATES_TABLE, function joinTemplates() {
        this.on(`${SURVEY_TEMPLATES_TABLE}.template_id`, '=', `${SURVEY_INVITATIONS_TABLE}.template_id`).andOn(
          `${SURVEY_TEMPLATES_TABLE}.tenant`,
          '=',
          `${SURVEY_INVITATIONS_TABLE}.tenant`
        );
      })
      .where(`${SURVEY_INVITATIONS_TABLE}.survey_token_hash`, hashedToken)
      .first();
  });

  if (!invitationRow) {
    throw new Error('Invalid or expired survey token.');
  }

  const tokenExpiresAt = toDate(invitationRow.token_expires_at);

  if (Number.isNaN(tokenExpiresAt.getTime()) || tokenExpiresAt.getTime() <= Date.now()) {
    throw new Error('Survey token has expired.');
  }

  if (invitationRow.responded) {
    throw new Error('Survey already completed.');
  }

  return {
    tenant: tenantId,
    invitation: mapInvitation(invitationRow),
  };
}

function mapInvitation(row: InvitationDetailRow): SurveyInvitationDetails {
  const tokenExpiresAt = toDate(row.token_expires_at);

  return {
    invitationId: row.invitation_id,
    tenant: row.tenant,
    templateId: row.template_id,
    ticketId: row.ticket_id,
    clientId: row.client_id ?? null,
    contactId: row.contact_id ?? null,
    tokenExpiresAt,
    responded: row.responded,
    respondedAt: row.responded_at ? toDate(row.responded_at) : null,
    openedAt: row.opened_at ? toDate(row.opened_at) : null,
    template: {
      promptText: row.prompt_text,
      commentPrompt: row.comment_prompt,
      thankYouText: row.thank_you_text,
      ratingType: row.rating_type,
      ratingScale: row.rating_scale,
      ratingLabels: normaliseRatingLabels(row.rating_labels),
    },
  };
}

function normaliseRatingLabels(value: InvitationDetailRow['rating_labels']): Record<string, string> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch (error) {
      logger.warn('Failed to parse rating labels JSON', { error });
      return {};
    }
  }

  if (typeof value === 'object') {
    return value as Record<string, string>;
  }

  return {};
}

function toDate(input: Date | string): Date {
  return input instanceof Date ? input : new Date(input);
}
