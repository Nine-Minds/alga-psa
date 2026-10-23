import {
  getWorkflowEntityLookupAction,
  type WorkflowEntityLookupAction,
} from '@alga-psa/workflows/authoring';
import type { Step } from '@alga-psa/workflows/runtime/client';

import { resolveLocalJsonSchemaRef } from './jsonSchemaRefs';
import type { JsonSchema } from './workflowDataContext';
import { resolveWorkflowSchemaFieldEditor, type WorkflowSchemaEditorAwareJsonSchema } from './workflowSchemaFieldEditor';
import { getStepBranches } from './workflowStepTree';

export type WorkflowEntityLookupSuggestion = {
  /** Entity kind of the payload field, e.g. `ticket`. */
  kind: string;
  /** Payload field holding the id, e.g. `ticketId`. */
  payloadField: string;
  lookup: WorkflowEntityLookupAction;
  /** Other details the payload already carries, which need no lookup (e.g. clientName, status). */
  carriedFields: string[];
};

// Event envelope fields every domain event has; they aren't details of the event's subject.
const EVENT_ENVELOPE_FIELDS = new Set(['tenantId', 'occurredAt', 'actorType', 'updatedFields', 'changes']);

// Every domain event carries who acted (BaseDomainEventPayloadSchema). Those ids describe the
// actor, not the event's subject, so they don't get a lookup suggestion.
const EVENT_ACTOR_FIELDS = new Set(['actorUserId', 'actorContactId']);

const resolveRoot = (schema: JsonSchema): JsonSchema => {
  if (schema.$ref) {
    const resolved = resolveLocalJsonSchemaRef<JsonSchema>(schema.$ref, schema);
    if (resolved) return resolved;
  }
  return schema;
};

const collectActionSteps = (steps: Step[], into: Step[] = []): Step[] => {
  for (const step of steps) {
    if (step.type === 'action.call') into.push(step);
    for (const branch of getStepBranches(step)) collectActionSteps(branch.steps, into);
  }
  return into;
};

const stepLooksUpPayloadField = (step: Step, lookup: WorkflowEntityLookupAction, payloadField: string): boolean => {
  const config = (step as { config?: { actionId?: unknown; inputMapping?: Record<string, unknown> } }).config;
  if (config?.actionId !== lookup.actionId) return false;
  const mapped = config.inputMapping?.[lookup.idInputField];
  const expression = mapped && typeof mapped === 'object' && '$expr' in mapped
    ? String((mapped as { $expr?: unknown }).$expr ?? '')
    : '';
  return new RegExp(`(^|[^A-Za-z0-9_])payload\\.${payloadField}(?![A-Za-z0-9_])`).test(expression);
};

/**
 * Lookup steps worth offering for the workflow's input: one per top-level payload field that holds
 * an entity id with a lookup action (e.g. `ticketId` → Find Ticket), unless a step already looks
 * that field up.
 */
export const buildWorkflowEntityLookupSuggestions = (
  payloadSchema: JsonSchema | null,
  steps: Step[]
): WorkflowEntityLookupSuggestion[] => {
  if (!payloadSchema) return [];
  const root = resolveRoot(payloadSchema);
  const actionSteps = collectActionSteps(steps);
  const suggestions: WorkflowEntityLookupSuggestion[] = [];

  const payloadFields = Object.keys(root.properties ?? {});
  for (const [payloadField, property] of Object.entries(root.properties ?? {})) {
    if (EVENT_ACTOR_FIELDS.has(payloadField)) continue;
    const editor = resolveWorkflowSchemaFieldEditor(property as WorkflowSchemaEditorAwareJsonSchema);
    const kind = editor?.kind === 'picker' ? editor.picker?.resource : undefined;
    const lookup = getWorkflowEntityLookupAction(kind);
    if (!kind || !lookup) continue;
    if (actionSteps.some((step) => stepLooksUpPayloadField(step, lookup, payloadField))) continue;
    const carriedFields = payloadFields.filter((field) =>
      field !== payloadField && !EVENT_ACTOR_FIELDS.has(field) && !EVENT_ENVELOPE_FIELDS.has(field)
    );
    suggestions.push({ kind, payloadField, lookup, carriedFields });
  }

  return suggestions;
};

/**
 * Event details that aren't in an event's payload but come with its lookup step. A customer reply
 * event carries the reply's id, not its text; Find Ticket returns the text as the ticket's latest
 * customer comment.
 */
const WORKFLOW_EVENT_DETAIL_TIPS: Readonly<Record<string, ReadonlyArray<{
  key: string;
  kind: string;
  payloadField: string;
  detailPath: string;
  messages: WorkflowEventDetailTipMessages;
}>>> = {
  TICKET_CUSTOMER_REPLIED: [
    {
      key: 'customerReplyText',
      kind: 'ticket',
      payloadField: 'ticketId',
      detailPath: 'latest_customer_comment.note',
      messages: {
        available: 'The reply text isn’t in the trigger itself. Use {{path}} (“{{action}}” › latest customer comment).',
        afterLookup: 'The reply text isn’t in the trigger itself. After “{{action}}”, it’s available as “{{action}}” › {{detail}}.',
      },
    },
  ],
};

/** English copy for a tip; {{path}}, {{action}} and {{detail}} are filled in. */
export type WorkflowEventDetailTipMessages = {
  /** Once the lookup step exists. */
  available: string;
  /** Before the lookup step is added. */
  afterLookup: string;
};

export type WorkflowEventDetailTip = {
  /** Stable key, also used for the hint's translation keys. */
  key: string;
  lookup: WorkflowEntityLookupAction;
  payloadField: string;
  /** Path of the detail inside the lookup step's output, e.g. `latest_customer_comment.note`. */
  detailPath: string;
  /** Full expression path once a lookup step exists (e.g. `vars.ticketDetails.latest_customer_comment.note`). */
  availableAt: string | null;
  messages: WorkflowEventDetailTipMessages;
};

const savedOutputName = (step: Step): string | null => {
  const saveAs = (step as { config?: { saveAs?: unknown } }).config?.saveAs;
  if (typeof saveAs !== 'string' || !saveAs.trim()) return null;
  return saveAs.trim().replace(/^vars\./, '');
};

/** Where to find the details the event's payload leaves out, for the trigger panel. */
export const buildWorkflowEventDetailTips = (
  eventName: string | null | undefined,
  steps: Step[]
): WorkflowEventDetailTip[] => {
  const tips = eventName ? WORKFLOW_EVENT_DETAIL_TIPS[eventName] : undefined;
  if (!tips) return [];
  const actionSteps = collectActionSteps(steps);
  return tips.flatMap((tip) => {
    const lookup = getWorkflowEntityLookupAction(tip.kind);
    if (!lookup) return [];
    const lookupStep = actionSteps.find((step) => stepLooksUpPayloadField(step, lookup, tip.payloadField));
    const saveAs = lookupStep ? savedOutputName(lookupStep) : null;
    return [{
      key: tip.key,
      lookup,
      payloadField: tip.payloadField,
      detailPath: tip.detailPath,
      availableAt: saveAs ? `vars.${saveAs}.${tip.detailPath}` : null,
      messages: tip.messages,
    }];
  });
};

