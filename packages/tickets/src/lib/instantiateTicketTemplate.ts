// The one place a ticket template becomes a ticket. Deliberately NOT a 'use server' module.
//
// Two consumers: the recurring-ticket generator (`instantiateTicketTemplate`, the whole thing) and
// `addTicket`'s create-from-template branch (`templateTicketProvenance` + the shared
// `applyCreatedFromTemplateEffects`; that action still takes the user's edited form values).

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  createTicketWithSideEffects,
  type CreateTicketActor,
} from '@alga-psa/shared/services/tickets/createTicketWithSideEffects';
import type { TicketOrigin } from '@alga-psa/types';
import { asJsonColumn } from './recurring/jsonColumn';
import {
  resolveEffectiveFields,
  type RecurringTemplateFields,
  type RecurringTicketOverrides,
} from './recurring/effectiveFields';
import { findTicketFieldReferenceProblems } from './ticketFieldReferences';
import { renderTitleTemplate, type TitleTokenContext } from './ticketTitleTokens';
import { countDuplicableCustomFields, pickDuplicableAttributes } from './ticketDuplicate';

/** A template could not become a ticket. The message is the user-facing reason (stored on a failed occurrence). */
export class TicketTemplateInstantiationError extends Error {
  constructor(message: string, readonly code: 'TEMPLATE_NOT_FOUND' | 'INVALID_REFERENCES') {
    super(message);
    this.name = 'TicketTemplateInstantiationError';
  }
}

export interface TemplateForInstantiation {
  template_id: string;
  name: string;
  title: string;
  description: string | null;
  board_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  priority_id: string | null;
  itil_impact: number | null;
  itil_urgency: number | null;
  tags: string[];
  custom_fields: Record<string, unknown>;
  checklist: { item_name: string; description: string | null; is_required: boolean; checklist_template_id: string | null }[];
}

/**
 * Loads a template with its checklist. Never filters on `is_active` (R4): deactivating a template only
 * hides it from manual use, schedules keep running. Returns null when it does not exist.
 */
export async function loadTemplateForInstantiation(
  conn: Knex | Knex.Transaction,
  tenant: string,
  templateId: string
): Promise<TemplateForInstantiation | null> {
  const db = tenantDb(conn, tenant);
  const row = await db.table('ticket_templates').where({ template_id: templateId }).first();
  if (!row) return null;
  const items = await db
    .table('ticket_template_checklist_items')
    .where({ template_id: templateId })
    .orderBy('order_number', 'asc')
    .orderBy('created_at', 'asc')
    .select('item_name', 'description', 'is_required', 'checklist_template_id');
  return {
    template_id: row.template_id,
    name: row.name,
    title: row.title,
    description: row.description ?? null,
    board_id: row.board_id ?? null,
    category_id: row.category_id ?? null,
    subcategory_id: row.subcategory_id ?? null,
    priority_id: row.priority_id ?? null,
    itil_impact: row.itil_impact ?? null,
    itil_urgency: row.itil_urgency ?? null,
    tags: asJsonColumn<string[]>(row.tags ?? []),
    custom_fields: asJsonColumn<Record<string, unknown>>(row.custom_fields ?? {}),
    checklist: items,
  };
}

/** What a definition contributes besides the template: how a ticket is dispatched. */
export interface TemplateDispatch {
  status_id: string | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
  additional_agent_ids: string[];
}

/**
 * The cascade (R1): template -> dispatch -> each override layer in order (definition overrides, then
 * client overrides). Pure; also used to preview what a schedule will produce.
 */
export function resolveTemplateTicketFields(
  template: Pick<TemplateForInstantiation, 'board_id' | 'priority_id' | 'category_id' | 'subcategory_id'>,
  dispatch: TemplateDispatch,
  overrides: readonly RecurringTicketOverrides[]
): RecurringTemplateFields {
  return resolveEffectiveFields(
    {
      board_id: template.board_id,
      priority_id: template.priority_id,
      category_id: template.category_id,
      subcategory_id: template.subcategory_id,
      status_id: dispatch.status_id,
      assigned_to: dispatch.assigned_to,
      assigned_team_id: dispatch.assigned_team_id,
      additional_agent_ids: dispatch.additional_agent_ids,
    },
    ...overrides
  );
}

/** `tickets.attributes` + provenance a ticket created from a template starts with (custom fields go through the Duplicate allowlist). */
export function templateTicketProvenance(template: Pick<TemplateForInstantiation, 'template_id' | 'custom_fields'>) {
  return {
    created_from_template_id: template.template_id,
    attributes: pickDuplicableAttributes({ custom_fields: template.custom_fields }),
  };
}

export interface InstantiateTicketTemplateInput {
  templateId: string;
  client: {
    client_id: string;
    contact_id?: string | null;
    location_id?: string | null;
    asset_ids?: readonly string[];
  };
  /** Override layers, lowest first: the definition's, then the client's. */
  overrides: readonly RecurringTicketOverrides[];
  dispatch: TemplateDispatch;
  actor: CreateTicketActor;
  suppression?: { suppressContactNotifications?: boolean; suppressInternalNotifications?: boolean };
  titleContext: TitleTokenContext;
  origin: { ticket_origin: TicketOrigin; source: string };
  dueDate?: Date | null;
}

/**
 * Creates a ticket from a template: resolves the cascade, validates the EFFECTIVE fields (status against
 * the effective board), renders the title, and creates the ticket with tags, assets, owned checklist items,
 * custom fields, ITIL, `created_from_template_id` and the activity. Throws
 * {@link TicketTemplateInstantiationError} for per-occurrence problems; anything else is infrastructure.
 */
export async function instantiateTicketTemplate(
  trx: Knex.Transaction,
  tenant: string,
  input: InstantiateTicketTemplateInput
): Promise<{ ticketId: string; ticketNumber: string }> {
  const template = await loadTemplateForInstantiation(trx, tenant, input.templateId);
  if (!template) {
    throw new TicketTemplateInstantiationError('The ticket template no longer exists; point the schedule at another template', 'TEMPLATE_NOT_FOUND');
  }

  const fields = resolveTemplateTicketFields(template, input.dispatch, input.overrides);
  const assetIds = [...(input.client.asset_ids ?? [])];
  const problems = await findTicketFieldReferenceProblems(trx, tenant, {
    fields,
    clientId: input.client.client_id,
    contactId: input.client.contact_id,
    locationId: input.client.location_id,
    assetIds,
    schedule: true,
  });
  if (problems.length > 0) {
    throw new TicketTemplateInstantiationError(problems.map((problem) => problem.message).join('; '), 'INVALID_REFERENCES');
  }

  const provenance = templateTicketProvenance(template);
  const { ticketId, ticketNumber } = await createTicketWithSideEffects(trx, tenant, {
    actor: input.actor,
    ticket: {
      title: renderTitleTemplate(template.title, input.titleContext),
      description: template.description ?? undefined,
      client_id: input.client.client_id,
      contact_id: input.client.contact_id ?? undefined,
      location_id: input.client.location_id ?? undefined,
      board_id: fields.board_id as string,
      status_id: fields.status_id ?? undefined,
      priority_id: fields.priority_id as string,
      category_id: fields.category_id ?? undefined,
      subcategory_id: fields.subcategory_id ?? undefined,
      assigned_to: fields.assigned_to ?? undefined,
      itil_impact: template.itil_impact ?? undefined,
      itil_urgency: template.itil_urgency ?? undefined,
      due_date: input.dueDate ? input.dueDate.toISOString() : undefined,
      ticket_origin: input.origin.ticket_origin,
      source: input.origin.source,
      created_from_template_id: provenance.created_from_template_id,
      attributes: provenance.attributes,
    },
    teamId: fields.assigned_team_id,
    additionalAgentIds: fields.additional_agent_ids,
    tags: template.tags,
    assetIds,
    notificationSuppression: input.suppression,
    // R6: the template's items are a snapshot the ticket owns; the create layer applies the replacement rule.
    checklistItems: template.checklist.map((item) => ({
      item_name: item.item_name,
      description: item.description,
      is_required: item.is_required,
      checklist_template_id: item.checklist_template_id,
    })),
    fromTemplate: {
      template_id: template.template_id,
      template_name: template.name,
      custom_fields_copied: countDuplicableCustomFields(provenance.attributes),
    },
  });

  return { ticketId, ticketNumber };
}
