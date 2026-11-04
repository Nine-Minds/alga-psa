// Copy-set rules for "Duplicate ticket". Deliberately NOT a 'use server' module:
// nothing here may become a client-callable action. `addTicket` and
// `getTicketDuplicateSource` (ticketActions.ts) are the only entry points.
//
// The authoritative copy set lives in docs/plans/2026-10-02-duplicate-ticket-plan.md.

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { CreateTicketInput } from '@alga-psa/shared/models/ticketModel';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';
import {
  insertChecklistItemsReplacingTemplates,
} from '@alga-psa/shared/lib/ticketChecklists';

/** Shape returned to the create-ticket form to prefill a duplicate. */
export interface TicketDuplicateSource {
  ticket_id: string;
  ticket_number: string;
  title: string;
  /** `attributes.description` as stored (plain text or serialized rich-text JSON). */
  description: string;
  client: { id: string; name: string; type: string | null };
  contact: { id: string; name: string } | null;
  location_id: string | null;
  board_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  priority_id: string | null;
  itil_impact: number | null;
  itil_urgency: number | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
  /**
   * Display names for the ids above, resolved server-side in the same tenant-scoped load.
   * `null` when the id is null OR the referenced row could not be found; callers must treat
   * "id set, name null" as unresolved and say so rather than guess.
   */
  board_name: string | null;
  category_name: string | null;
  subcategory_name: string | null;
  priority_name: string | null;
  assignee_name: string | null;
  assigned_team_name: string | null;
  additional_agents: { user_id: string; first_name: string | null; last_name: string | null }[];
  tags: {
    tag_id: string;
    tag_text: string;
    background_color: string | null;
    text_color: string | null;
  }[];
  checklist: { item_name: string; is_required: boolean }[];
  custom_field_count: number;
}

/**
 * Attributes allowlist (D7): only `custom_fields` carries over to a duplicate.
 * Every other `attributes` key is system-owned (description is supplied by the
 * form; watch_list, sla_last_*_threshold_notified, source_reference,
 * teams_guest_intake, legacy tags and due_date must never be cloned), so this
 * is an allowlist rather than a denylist: a system key added later cannot leak.
 */
export function pickDuplicableAttributes(attributes: unknown): Record<string, unknown> {
  let parsed: unknown = attributes;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const customFields = (parsed as Record<string, unknown>).custom_fields;
  if (
    customFields &&
    typeof customFields === 'object' &&
    !Array.isArray(customFields) &&
    Object.keys(customFields as Record<string, unknown>).length > 0
  ) {
    return { custom_fields: customFields };
  }
  return {};
}

/** Number of custom field values a duplicate would carry over. */
export function countDuplicableCustomFields(attributes: unknown): number {
  const picked = pickDuplicableAttributes(attributes);
  return picked.custom_fields ? Object.keys(picked.custom_fields as Record<string, unknown>).length : 0;
}

/**
 * The create-input fields that make a ticket a duplicate: provenance plus the
 * attributes allowlist. Single and batch Duplicate both spread this, so the copy
 * set is defined once.
 */
export function duplicateCreateInputPatch(source: {
  ticket_id: string;
  attributes?: unknown;
}): Pick<CreateTicketInput, 'duplicated_from_ticket_id' | 'attributes'> {
  return {
    duplicated_from_ticket_id: source.ticket_id,
    attributes: pickDuplicableAttributes(source.attributes),
  };
}

interface CopyChecklistParams {
  sourceTicketId: string;
  targetTicketId: string;
  userId: string;
}

export {
  insertChecklistItemsReplacingTemplates,
  type ChecklistItemToInsert,
  type InsertChecklistParams,
} from '@alga-psa/shared/lib/ticketChecklists';

/**
 * Copies the source ticket's checklist onto the target, unchecked (D8): loads the
 * source items and hands them to `insertChecklistItemsReplacingTemplates`.
 *
 * Returns the number of items copied.
 */
export async function copyChecklistFromSource(
  trx: Knex.Transaction,
  tenant: string,
  { sourceTicketId, targetTicketId, userId }: CopyChecklistParams
): Promise<number> {
  const db = tenantDb(trx, tenant);

  const sourceItems = await db
    .table('ticket_checklist_items')
    .where({ ticket_id: sourceTicketId })
    .orderBy('order_number', 'asc')
    .orderBy('created_at', 'asc')
    .select('item_name', 'description', 'is_required', 'assigned_to', 'order_number', 'source', 'template_id');

  return insertChecklistItemsReplacingTemplates(trx, tenant, {
    targetTicketId,
    userId,
    items: sourceItems,
  });
}

interface RecordDuplicateCopyParams {
  source: { ticket_id: string; ticket_number: string; attributes?: unknown };
  targetTicketId: string;
  targetTicketNumber: string;
  actorUserId: string;
  copyChecklist: boolean;
  /** Groups the copies made by one batch request; omitted for single Duplicate. */
  batchId?: string;
}

/**
 * Writes everything that makes a freshly created ticket a duplicate, inside the
 * caller's transaction: the checklist copy (when requested), then the
 * `TICKET_DUPLICATED_FROM` row on the copy and `TICKET_DUPLICATED_TO` on the source.
 * Must run after the ticket is created, so templates auto-applied by
 * `TicketModel.createTicket` are already in place for `copyChecklistFromSource`.
 */
export async function recordDuplicateCopy(
  trx: Knex.Transaction,
  tenant: string,
  { source, targetTicketId, targetTicketNumber, actorUserId, copyChecklist, batchId }: RecordDuplicateCopyParams
): Promise<{ checklistItemsCopied: number }> {
  const checklistItemsCopied = copyChecklist
    ? await copyChecklistFromSource(trx, tenant, {
        sourceTicketId: source.ticket_id,
        targetTicketId,
        userId: actorUserId,
      })
    : 0;

  const batchDetail = batchId ? { batch_id: batchId } : {};

  await writeTicketActivity(trx, {
    tenant,
    ticketId: targetTicketId,
    eventType: TICKET_ACTIVITY_EVENT.DUPLICATED_FROM,
    entityType: TICKET_ACTIVITY_ENTITY.TICKET,
    entityId: targetTicketId,
    actor: {
      actorType: TICKET_ACTIVITY_ACTOR.USER,
      userId: actorUserId,
    },
    source: TICKET_ACTIVITY_SOURCE.UI,
    details: {
      source_ticket_id: source.ticket_id,
      source_ticket_number: source.ticket_number,
      checklist_items_copied: checklistItemsCopied,
      custom_fields_copied: countDuplicableCustomFields(source.attributes),
      ...batchDetail,
    },
  });
  await writeTicketActivity(trx, {
    tenant,
    ticketId: source.ticket_id,
    eventType: TICKET_ACTIVITY_EVENT.DUPLICATED_TO,
    entityType: TICKET_ACTIVITY_ENTITY.TICKET,
    entityId: source.ticket_id,
    actor: {
      actorType: TICKET_ACTIVITY_ACTOR.USER,
      userId: actorUserId,
    },
    source: TICKET_ACTIVITY_SOURCE.UI,
    details: {
      duplicate_ticket_id: targetTicketId,
      duplicate_ticket_number: targetTicketNumber,
      ...batchDetail,
    },
  });

  return { checklistItemsCopied };
}
