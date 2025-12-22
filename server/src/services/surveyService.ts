'use server';

import { withTransaction } from '@alga-psa/shared/db';
import { appendFileSync } from 'node:fs';
import type { Knex } from 'knex';
import logger from '@alga-psa/shared/core/logger';

import { createTenantKnex, runWithTenant } from '../lib/db';
import { issueSurveyToken } from '../lib/actions/surveyTokenService';
import { TenantEmailService } from '../lib/email';
import { isValidEmail } from '../lib/utils/validation';
import { DatabaseTemplateProcessor } from '../lib/email/tenant/templateProcessors';
import { publishEvent } from '../lib/eventBus/publishers';

const SURVEY_TEMPLATE_TABLE = 'survey_templates';
const SURVEY_INVITATION_TABLE = 'survey_invitations';
const TICKETS_TABLE = 'tickets';
const CLIENTS_TABLE = 'clients';
const CONTACTS_TABLE = 'contacts';
const USERS_TABLE = 'users';
const TENANTS_TABLE = 'tenants';
const SURVEY_EMAIL_TEMPLATE_CODE = 'SURVEY_TICKET_CLOSED';
const DEFAULT_TOKEN_TTL_HOURS = 24 * 7; // 7 days

type TemplateRow = {
  template_id: string;
  tenant: string;
  template_name: string;
  is_default: boolean;
  enabled: boolean;
  rating_type: string;
  rating_scale: number;
  rating_labels: Record<string, string> | string | null;
  prompt_text: string;
  comment_prompt: string;
  thank_you_text: string;
};

type InvitationRow = {
  invitation_id: string;
  tenant: string;
  ticket_id: string;
  client_id: string | null;
  contact_id: string | null;
  template_id: string;
  survey_token_hash: string;
  token_expires_at: Date | string;
  sent_at?: Date | string | null;
  responded?: boolean;
};

type TicketRow = {
  ticket_id: string;
  ticket_number: string | null;
  title: string | null;
  client_id: string | null;
  contact_name_id: string | null;
  assigned_to: string | null;
  client_name?: string | null;
  technician_first_name?: string | null;
  technician_last_name?: string | null;
  closed_at?: Date | string | null;
};

type ContactRow = {
  contact_name_id: string;
  full_name: string | null;
  email: string | null;
};

type TenantRow = {
  tenant: string;
  client_name?: string | null;
  name?: string | null;
};

export interface SendSurveyInvitationParams {
  tenantId: string;
  ticketId: string;
  templateId?: string;
  clientId?: string | null;
  contactId?: string | null;
  locale?: string;
}

export interface SendSurveyInvitationResult {
  invitationId: string;
  surveyUrl: string;
  expiresAt: Date;
  contactEmail: string;
}

function appendDebug(step: string, data: Record<string, unknown>) {
  try {
    appendFileSync(
      'survey-debug.log',
      JSON.stringify({
        step,
        timestamp: new Date().toISOString(),
        ...data,
      }) + '\n'
    );
  } catch (error) {
    logger.warn('[SurveyService] Failed to write survey debug log', {
      step,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function sendSurveyInvitation(params: SendSurveyInvitationParams): Promise<SendSurveyInvitationResult> {
  appendDebug('start', { params });
  return runWithTenant(params.tenantId, async () => {
    logger.info('[SurveyService] sendSurveyInvitation invoked', {
      tenantId: params.tenantId,
      ticketId: params.ticketId,
      templateId: params.templateId,
    });

    const { knex } = await createTenantKnex();
    const now = new Date();
    const expiresAt = addHours(now, DEFAULT_TOKEN_TTL_HOURS);
    const { plainToken, hashedToken } = issueSurveyToken();

    const {
      invitation,
      template,
      contact,
      ticket,
      tenant,
    } = await withTransaction(knex, async (trx) => {
      appendDebug('transaction-begin', { tenantId: params.tenantId, ticketId: params.ticketId });

      const templateRow = await loadTemplate(trx, params.tenantId, params.templateId);
      appendDebug('loaded-template', { templateId: templateRow.template_id, enabled: templateRow.enabled });

      const ticketRow = await loadTicket(trx, params.tenantId, params.ticketId);
      appendDebug('loaded-ticket', {
        ticketId: ticketRow?.ticket_id,
        contactId: ticketRow?.contact_name_id,
        clientId: ticketRow?.client_id,
      });

      if (!ticketRow) {
        appendDebug('ticket-missing', { ticketId: params.ticketId });
        throw new Error('Ticket not found for survey invitation');
      }

      const resolvedClientId = params.clientId ?? ticketRow.client_id ?? null;
      const resolvedContactId = params.contactId ?? ticketRow.contact_name_id ?? null;

      const contactRow = resolvedContactId
        ? await loadContact(trx, params.tenantId, resolvedContactId)
        : null;
      appendDebug('loaded-contact', {
        contactId: contactRow?.contact_name_id,
        email: contactRow?.email,
      });

      if (!contactRow || !isValidEmail(contactRow.email)) {
        appendDebug('contact-missing-email', {
          contactId: contactRow?.contact_name_id,
        });
        throw new Error('Survey invitations require an active contact with an email address');
      }

      const tenantRow = await loadTenant(trx, params.tenantId);
      appendDebug('loaded-tenant', { tenantName: tenantRow?.name });

      const [invitationRow] = await trx<InvitationRow>(SURVEY_INVITATION_TABLE)
        .insert({
          tenant: params.tenantId,
          ticket_id: ticketRow.ticket_id,
          client_id: resolvedClientId,
          contact_id: contactRow.contact_name_id,
          template_id: templateRow.template_id,
          survey_token_hash: hashedToken,
          token_expires_at: expiresAt,
          sent_at: trx.fn.now(),
          responded: false,
        })
        .returning('*');

      if (!invitationRow) {
        appendDebug('invitation-insert-failed', {});
        throw new Error('Failed to persist survey invitation');
      }

      appendDebug('invitation-inserted', {
        invitationId: invitationRow.invitation_id,
      });

      return {
        invitation: invitationRow,
        template: templateRow,
        contact: contactRow,
        ticket: ticketRow,
        tenant: tenantRow,
      };
    });

    const surveyUrl = buildSurveyUrl(plainToken);
    const ratingLabels = normaliseLabels(template.rating_labels);
    const ratingLinks = buildRatingLinks(plainToken, template.rating_scale, ratingLabels);
    const ratingButtonsHtml = buildRatingButtonsHtml(ratingLinks);
    const ratingLinksText = buildRatingLinksText(ratingLinks);
    const technicianName = formatFullName(ticket.technician_first_name, ticket.technician_last_name);
    const tenantDisplayName = tenant?.client_name || tenant?.name || 'Your Team';
    const locale = params.locale ?? undefined;

    const templateData = {
      tenant_name: tenantDisplayName,
      ticket_number: ticket.ticket_number ?? ticket.ticket_id,
      ticket_subject: ticket.title ?? '',
      technician_name: technicianName ?? '',
      survey_url: surveyUrl,
      rating_scale: template.rating_scale,
      rating_type: template.rating_type,
      rating_labels: ratingLabels,
      rating_buttons_html: ratingButtonsHtml,
      rating_links_text: ratingLinksText,
      prompt_text: template.prompt_text,
      comment_prompt: template.comment_prompt,
      thank_you_text: template.thank_you_text,
      contact_name: contact.full_name ?? '',
      company_name: ticket.client_name ?? '',
      expires_at: expiresAt.toISOString(),
      ticket_closed_at: ticket.closed_at ? toIsoString(ticket.closed_at) : '',
    };

    if (!contact.email) {
      throw new Error(
        `sendSurveyInvitation: contact ${contact.contact_name_id} has no email address`
      );
    }

    if (!isValidEmail(contact.email)) {
      throw new Error(
        `sendSurveyInvitation: contact ${contact.contact_name_id} has invalid email address`
      );
    }

    try {
      const processor = new DatabaseTemplateProcessor(knex, SURVEY_EMAIL_TEMPLATE_CODE);
      const emailService = TenantEmailService.getInstance(params.tenantId);
      appendDebug('before-email-send', { contactEmail: contact.email });

      // TODO: Queue invitation delivery through Temporal survey workflow once available.
      const sendResult = await emailService.sendEmail({
        to: contact.email,
        tenantId: params.tenantId,
        templateProcessor: processor,
        templateData,
        locale,
      });

      if (!sendResult.success) {
        throw new Error(sendResult.error || 'Failed to send survey invitation email');
      }

      appendDebug('email-sent', {
        invitationId: invitation.invitation_id,
        contactEmail: contact.email,
        messageId: sendResult.messageId,
      });
    } catch (error) {
      logger.error('[SurveyService] Failed to send survey invitation email', {
        tenantId: params.tenantId,
        ticketId: params.ticketId,
        contactId: contact.contact_name_id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      appendDebug('email-error', {
        tenantId: params.tenantId,
        ticketId: params.ticketId,
        contactId: contact.contact_name_id,
        error: error instanceof Error ? error.message : error,
      });

      const message = error instanceof Error ? error.message : String(error);
      const isDomainNotVerified = message.includes('domain is not verified');

      if (isDomainNotVerified) {
        logger.warn('[SurveyService] Proceeding despite email failure (unverified domain)', {
          tenantId: params.tenantId,
          ticketId: params.ticketId,
        });
      } else {
        await removeInvitationSafe(params.tenantId, invitation.invitation_id);
        throw error;
      }
    }

    return {
      invitationId: invitation.invitation_id,
      surveyUrl,
      expiresAt,
      contactEmail: contact.email ?? '',
    };
  });
}

async function loadTemplate(
  knex: Knex | Knex.Transaction,
  tenantId: string,
  templateId?: string
): Promise<TemplateRow> {
  if (templateId) {
    const template = await knex<TemplateRow>(SURVEY_TEMPLATE_TABLE)
      .where({ tenant: tenantId, template_id: templateId })
      .andWhere({ enabled: true })
      .first();

    if (!template) {
      throw new Error('Survey template not found or disabled');
    }
    return template;
  }

  const template = await knex<TemplateRow>(SURVEY_TEMPLATE_TABLE)
    .where({ tenant: tenantId, enabled: true })
    .orderBy([{ column: 'is_default', order: 'desc' }, { column: 'created_at', order: 'asc' }])
    .first();

  if (!template) {
    throw new Error('No enabled survey template found for tenant');
  }

  return template;
}

async function loadTicket(
  knex: Knex | Knex.Transaction,
  tenantId: string,
  ticketId: string
): Promise<TicketRow | null> {
  return knex<TicketRow>(`${TICKETS_TABLE} as t`)
    .leftJoin(`${CLIENTS_TABLE} as c`, function joinClients() {
      this.on('t.client_id', '=', 'c.client_id').andOn('t.tenant', '=', 'c.tenant');
    })
    .leftJoin(`${USERS_TABLE} as u`, function joinUsers() {
      this.on('t.assigned_to', '=', 'u.user_id').andOn('t.tenant', '=', 'u.tenant');
    })
    .select(
      't.ticket_id',
      't.ticket_number',
      't.title',
      't.client_id',
      't.contact_name_id',
      't.assigned_to',
      't.closed_at',
      'c.client_name',
      'u.first_name as technician_first_name',
      'u.last_name as technician_last_name'
    )
    .where({ 't.tenant': tenantId, 't.ticket_id': ticketId })
    .first();
}

async function loadContact(
  knex: Knex | Knex.Transaction,
  tenantId: string,
  contactId: string
): Promise<ContactRow | null> {
  const result = await knex<ContactRow>(CONTACTS_TABLE)
    .select('contact_name_id', 'full_name', 'email')
    .where('tenant', tenantId)
    .andWhere('contact_name_id', contactId)
    .first();
  return result || null;
}

async function loadTenant(knex: Knex | Knex.Transaction, tenantId: string): Promise<TenantRow | null> {
  const result = await knex<TenantRow>(TENANTS_TABLE)
    .select('tenant', 'client_name')
    .where('tenant', tenantId)
    .first();
  return result || null;
}

async function removeInvitationSafe(tenantId: string, invitationId: string): Promise<void> {
  await runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    await knex(SURVEY_INVITATION_TABLE)
      .where({ tenant: tenantId, invitation_id: invitationId })
      .del()
      .catch(() => undefined);
  });
}

function buildSurveyUrl(token: string): string {
  const baseUrl = getBaseUrl();
  return `${baseUrl}/surveys/respond/${encodeURIComponent(token)}`;
}

function buildRatingLinks(
  token: string,
  scale: number,
  labels: Record<string, string>
): Array<{ rating: number; label: string; url: string }> {
  const base = buildSurveyUrl(token);

  return Array.from({ length: scale }, (_, idx) => {
    const rating = idx + 1;
    const url = `${base}?rating=${rating}`;
    const label = labels[String(rating)] ?? String(rating);
    return { rating, label, url };
  });
}

function buildRatingButtonsHtml(
  links: Array<{ rating: number; label: string; url: string }>
): string {
  return links
    .map(
      ({ rating, label, url }) => `
      <a
        href="${url}"
        title="${label}"
        style="
          display:inline-block;
          margin:0 6px;
          padding:12px 18px;
          border-radius:9999px;
          background:#fbbf24;
          color:#1f2937;
          text-decoration:none;
          font-weight:600;
          font-family:Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        "
      >
        ${rating}
      </a>`
    )
    .join('');
}

function buildRatingLinksText(
  links: Array<{ rating: number; label: string; url: string }>
): string {
  return links.map(({ rating, url }) => `${rating} ★: ${url}`).join('\n');
}

function normaliseLabels(input: TemplateRow['rating_labels']): Record<string, string> {
  if (!input) {
    return {};
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return normaliseLabels(parsed);
    } catch (_error) {
      return {};
    }
  }

  return Object.entries(input).reduce<Record<string, string>>((acc, [key, value]) => {
    acc[String(key)] = typeof value === 'string' ? value : String(value ?? '');
    return acc;
  }, {});
}

function formatFullName(first?: string | null, last?: string | null): string | null {
  const parts = [first, last].filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  return parts.join(' ');
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function getBaseUrl(): string {
  const envUrl = process.env.DOMAIN || process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const trimmed = envUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  }
  const normalised = `https://${trimmed}`;
  return normalised.endsWith('/') ? normalised.slice(0, -1) : normalised;
}
