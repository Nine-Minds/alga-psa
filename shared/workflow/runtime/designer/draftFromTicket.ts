import { v4 as uuidv4 } from 'uuid';
import { EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF } from '@alga-psa/event-schemas';

/**
 * Pure builder behind "Create workflow from ticket" (alga-2026-0002502).
 *
 * Turns a loaded ticket blueprint into a workflow definition: an optional
 * trigger, a prefilled `tickets.create` step (every imported value is a
 * literal, the designer's "fixed" input mode) and the ticket's checklist
 * expressed as workflow actions. No I/O: loading (packages/tickets) and
 * persisting (packages/workflows) are composed by an EE server action.
 *
 * Plan: docs/plans/2026-10-13-create-workflow-from-ticket-plan.md (D2, D3, D5).
 */

export interface TicketWorkflowBlueprintChecklistItem {
  item_name: string;
  description: string | null;
  is_required: boolean;
  /** Template the item was copied from, if any. */
  template_id: string | null;
  /** Null when the template no longer exists. */
  template_name: string | null;
  /** Null when the template no longer exists. */
  template_is_active: boolean | null;
}

/**
 * Everything the builder needs from the source ticket. Superset of the
 * duplicate-ticket source (same field names) plus custom-field values and
 * checklist provenance.
 */
export interface TicketWorkflowBlueprint {
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
  assigned_to: string | null;
  assigned_team_id: string | null;
  additional_agents: { user_id: string; first_name: string | null; last_name: string | null }[];
  tags: { tag_id: string; tag_text: string }[];
  /** Allowlisted `attributes.custom_fields` values. */
  custom_fields: Record<string, unknown>;
  checklist: TicketWorkflowBlueprintChecklistItem[];
}

export interface TicketWorkflowIncludeOptions {
  assignment: boolean;
  tags: boolean;
  customFields: boolean;
  checklist: boolean;
}

export type TicketWorkflowTrigger =
  | { kind: 'manual' }
  | {
      kind: 'trigger';
      /** Resolved server-side from the event catalog, never client supplied. */
      payloadSchemaRef: string;
      trigger: Record<string, unknown>;
    };

export interface BuildWorkflowDraftFromTicketOptions {
  name: string;
  trigger: TicketWorkflowTrigger;
  include: TicketWorkflowIncludeOptions;
  /** Defaults to a fresh uuid. */
  workflowId?: string;
}

const CREATED_TICKET_VAR = 'createdTicket';
const CREATED_TICKET_ID_EXPR = { $expr: `vars.${CREATED_TICKET_VAR}.ticket_id` };

export interface TicketWorkflowChecklistSplit {
  /** Distinct active templates, in order of first appearance. */
  templates: { template_id: string; template_name: string }[];
  /** Manual items and items whose template is missing or inactive, in source order. */
  adHocItems: TicketWorkflowBlueprintChecklistItem[];
}

/** D5: template-backed items collapse to one apply step per template; the rest are ad hoc. */
export function splitTicketChecklist(
  checklist: TicketWorkflowBlueprintChecklistItem[]
): TicketWorkflowChecklistSplit {
  const templates: TicketWorkflowChecklistSplit['templates'] = [];
  const seen = new Set<string>();
  const adHocItems: TicketWorkflowBlueprintChecklistItem[] = [];

  for (const item of checklist) {
    if (item.template_id && item.template_is_active === true) {
      if (!seen.has(item.template_id)) {
        seen.add(item.template_id);
        templates.push({ template_id: item.template_id, template_name: item.template_name ?? '' });
      }
    } else {
      adHocItems.push(item);
    }
  }
  return { templates, adHocItems };
}

function buildCreateTicketInput(
  blueprint: TicketWorkflowBlueprint,
  include: TicketWorkflowIncludeOptions
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    client_id: blueprint.client.id,
    title: blueprint.title,
    description: blueprint.description,
  };
  if (blueprint.contact) input.contact_id = blueprint.contact.id;
  if (blueprint.location_id) input.location_id = blueprint.location_id;
  if (blueprint.board_id) input.board_id = blueprint.board_id;
  if (blueprint.priority_id) input.priority_id = blueprint.priority_id;
  if (blueprint.category_id) input.category_id = blueprint.category_id;
  if (blueprint.subcategory_id) input.subcategory_id = blueprint.subcategory_id;

  if (include.assignment) {
    // additional_user_ids is only valid alongside a primary assignment.
    const primary = blueprint.assigned_to
      ? { type: 'user', id: blueprint.assigned_to }
      : blueprint.assigned_team_id
        ? { type: 'team', id: blueprint.assigned_team_id }
        : null;
    if (primary) {
      input.assignment = {
        primary,
        additional_user_ids: blueprint.additional_agents.map((agent) => agent.user_id),
      };
    }
  }
  if (include.tags && blueprint.tags.length > 0) {
    input.tags = blueprint.tags.map((tag) => tag.tag_text);
  }
  if (include.customFields && Object.keys(blueprint.custom_fields).length > 0) {
    input.custom_fields = blueprint.custom_fields;
  }

  // Explicit so the explicit-choice `contact` field validates: nothing is told to the customer
  // unless the admin changes it in the designer.
  input.notify = { internal: true, contact: false };
  return input;
}

export function buildWorkflowDraftFromTicket(
  blueprint: TicketWorkflowBlueprint,
  options: BuildWorkflowDraftFromTicketOptions
): Record<string, unknown> {
  const { include, trigger } = options;

  const steps: Record<string, unknown>[] = [
    {
      id: 'create-ticket',
      type: 'action.call',
      name: 'Create ticket',
      config: {
        actionId: 'tickets.create',
        version: 1,
        saveAs: CREATED_TICKET_VAR,
        designerGroupKey: 'ticket',
        designerTileKind: 'core-object',
        inputMapping: buildCreateTicketInput(blueprint, include),
      },
    },
  ];

  if (include.checklist && blueprint.checklist.length > 0) {
    const { templates, adHocItems } = splitTicketChecklist(blueprint.checklist);

    templates.forEach((template, index) => {
      steps.push({
        id: `apply-checklist-${index + 1}`,
        type: 'action.call',
        name: template.template_name ? `Apply checklist: ${template.template_name}` : 'Apply checklist',
        config: {
          actionId: 'tickets.apply_checklist',
          version: 1,
          inputMapping: { ticket_id: CREATED_TICKET_ID_EXPR, template_id: template.template_id },
        },
      });
    });

    if (adHocItems.length > 0) {
      steps.push({
        id: 'add-checklist-items',
        type: 'action.call',
        name: 'Add checklist items',
        config: {
          actionId: 'tickets.add_checklist_items',
          version: 1,
          inputMapping: {
            ticket_id: CREATED_TICKET_ID_EXPR,
            items: adHocItems.map((item) => ({
              item_name: item.item_name,
              ...(item.description ? { description: item.description } : {}),
              is_required: item.is_required,
            })),
          },
        },
      });
    }
  }

  return {
    id: options.workflowId ?? uuidv4(),
    version: 1,
    name: options.name,
    description: `Created from ticket #${blueprint.ticket_number} (${blueprint.title})`,
    payloadSchemaRef:
      trigger.kind === 'trigger' ? trigger.payloadSchemaRef : EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF,
    ...(trigger.kind === 'trigger' ? { trigger: trigger.trigger } : {}),
    steps,
  };
}
