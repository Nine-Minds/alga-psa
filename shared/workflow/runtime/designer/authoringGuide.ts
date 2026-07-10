/**
 * Machine-readable workflow authoring guide.
 *
 * Served by GET /api/workflow/registry/authoring-guide. The structural parts
 * (definition schema, step schemas, node-type semantics, expression function
 * catalog) are assembled at request time from the live Zod types and
 * registries so they cannot drift from the runtime; the prose (grammar notes,
 * data-flow idioms, worked example, pitfalls) is authored here.
 */

import { zodToWorkflowJsonSchema } from '../jsonSchemaMetadata';
import { getNodeTypeRegistry } from '../registries/nodeTypeRegistry';
import { listWorkflowExpressionFunctions } from '../expressionFunctions';
import {
  callWorkflowBlockSchema,
  eventWaitStepSchema,
  forEachBlockSchema,
  ifBlockSchema,
  nodeStepSchema,
  returnStepSchema,
  timeWaitStepSchema,
  tryCatchBlockSchema,
  workflowDefinitionSchema,
} from '../types';

export type WorkflowAuthoringGuide = {
  overview: {
    summary: string;
    authoringLoop: string[];
  };
  definitionSchema: Record<string, unknown>;
  stepSchemas: Record<string, Record<string, unknown>>;
  nodeTypes: Array<{
    id: string;
    label: string;
    description: string | null;
    category: string | null;
    configSchema: Record<string, unknown>;
  }>;
  controlBlocks: Array<{
    type: string;
    semantics: string;
  }>;
  expressionLanguage: {
    grammar: string[];
    contexts: Array<{ where: string; roots: string }>;
    functions: Array<{ name: string; signature: string; description: string; example: string }>;
  };
  dataFlow: string[];
  workedExample: {
    request: string;
    notes: string[];
    definition: Record<string, unknown>;
  };
  commonPitfalls: string[];
};

const STEP_RECURSION_KEYS = new Set(['then', 'else', 'body', 'try', 'catch']);

/**
 * The block Zod schemas convert cleanly except for their recursive step
 * arrays, which come out as `{"type":"array","items":{}}`. Patch those with a
 * self-describing reference so a model reading the schema knows nesting is
 * the same Step shape.
 */
const patchStepRecursion = (schema: Record<string, unknown>): Record<string, unknown> => {
  const walk = (node: unknown, key: string | null): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, null));
      return;
    }
    const record = node as Record<string, unknown>;
    if (
      key !== null &&
      STEP_RECURSION_KEYS.has(key) &&
      record.type === 'array' &&
      record.items &&
      typeof record.items === 'object' &&
      Object.keys(record.items as Record<string, unknown>).length === 0
    ) {
      record.items = { $ref: '#/stepSchemas', description: 'Nested list of Step objects (any step schema in stepSchemas)' };
    }
    for (const [childKey, value] of Object.entries(record)) {
      walk(value, childKey);
    }
  };
  walk(schema, null);
  return schema;
};

export function buildWorkflowAuthoringGuide(): WorkflowAuthoringGuide {
  const nodeRegistry = getNodeTypeRegistry();

  const definitionSchema = zodToWorkflowJsonSchema(workflowDefinitionSchema, {
    name: 'WorkflowDefinition',
  }) as Record<string, unknown>;

  const stepSchemas: Record<string, Record<string, unknown>> = Object.fromEntries(
    (
      [
        ['node (action.call / transform.* / state.set / …)', nodeStepSchema],
        ['event.wait', eventWaitStepSchema],
        ['time.wait', timeWaitStepSchema],
        ['control.if', ifBlockSchema],
        ['control.forEach', forEachBlockSchema],
        ['control.tryCatch', tryCatchBlockSchema],
        ['control.callWorkflow', callWorkflowBlockSchema],
        ['control.return', returnStepSchema],
      ] as const
    ).map(([label, schema]) => [
      label,
      patchStepRecursion(zodToWorkflowJsonSchema(schema, { name: label }) as Record<string, unknown>),
    ])
  );

  const nodeTypes = nodeRegistry.list().map((node) => ({
    id: node.id,
    label: node.ui?.label ?? node.id,
    description: node.ui?.description ?? null,
    category: node.ui?.category ?? null,
    configSchema: zodToWorkflowJsonSchema(node.configSchema, { name: `${node.id}.config` }) as Record<string, unknown>,
  }));

  return {
    overview: {
      summary:
        'A workflow is a JSON WorkflowDefinition: a trigger (usually an event) plus an ordered list of steps. ' +
        'Steps are node steps (action.call invokes a registered action; transform.assign computes values; state.set labels progress) ' +
        'and control blocks (control.if / control.forEach / control.tryCatch / control.return / control.callWorkflow). ' +
        'Workflows are saved as drafts and published by a human in the workflow editor.',
      authoringLoop: [
        'Discover: GET /api/workflow/registry/authoring-guide (this document), GET /api/workflow/registry/events (trigger catalog), GET /api/workflow/registry/actions and /designer-catalog (action ids + input/output schemas), GET /api/workflow/registry/schemas/{schemaRef} (event payload schemas).',
        'Resolve tenant references (priority ids, user ids, activity groups, boards…) through the v1 REST endpoints before composing; never invent UUIDs.',
        'Compose the WorkflowDefinition JSON against definitionSchema and stepSchemas.',
        'Verify: POST /api/workflow-definitions/validate until it returns no errors, then POST /api/workflow-definitions/simulate with a realistic payload and read the trace (action.call steps are stubbed and their evaluated inputs recorded).',
        'Save: POST /api/workflow-definitions (create draft) or PUT /api/workflow-definitions/{workflowId}/{version} with expectedDraftVersion (replace draft). Reply with the editor link /msp/workflow-editor/{workflowId} — publishing is a human action.',
      ],
    },
    definitionSchema,
    stepSchemas,
    nodeTypes,
    controlBlocks: [
      {
        type: 'control.if',
        semantics:
          'condition is a $expr that MUST evaluate to a boolean (non-boolean values fail the run). Executes then[] or else[].',
      },
      {
        type: 'control.forEach',
        semantics:
          'items is a $expr that MUST evaluate to an array. For each element the itemVar is set in vars (vars.<itemVar>) and as a bare local, alongside item/index/length/isFirst/isLast locals. onItemError: "continue" skips failed iterations; the default fails the run.',
      },
      {
        type: 'control.tryCatch',
        semantics:
          'Runs try[]; on any step failure jumps to catch[]. The error is exposed as `error` in expressions and, when captureErrorAs is set, stored at vars.<captureErrorAs>.',
      },
      {
        type: 'control.return',
        semantics: 'Ends the workflow run successfully; later steps do not execute.',
      },
      {
        type: 'control.callWorkflow',
        semantics:
          'Starts another published workflow (workflowId + workflowVersion), mapping inputs from expressions and outputs from the childRun context (e.g. childRun.vars.x) back into this run.',
      },
    ],
    expressionLanguage: {
      grammar: [
        'Expressions are JSONata programs written as { "$expr": "<source>" } objects.',
        '`==` is normalized to JSONata `=` for equality; use `!=`, `>`, `>=`, `<`, `<=` for comparisons and `and` / `or` / `$not(...)` for boolean logic.',
        'String concatenation uses `&` (e.g. payload.name & "!"). String literals use double quotes inside the source.',
        'Only the functions listed in `functions` (called with or without a $ prefix) plus JSONata built-ins that they wrap are allowed; unknown function names fail validation.',
        'Results must be JSON-serializable and under 256KiB.',
      ],
      contexts: [
        {
          where: 'control.if conditions, control.forEach items, action.call inputMapping, trigger correlation, control.callWorkflow mappings',
          roots:
            'payload.*, vars.*, local.* (current loop scope), meta.*, error, system.*, plus every vars key and loop local (item, index, length, isFirst, isLast, <itemVar>) spread as bare names.',
        },
        {
          where: 'transform.assign, event.wait/time.wait/human.task assign maps, email.* node configs',
          roots:
            'payload.*, vars.*, meta.*, error ONLY — loop locals are not bare names here; reference the loop variable as vars.<itemVar>.',
        },
        {
          where: 'trigger.payloadMapping',
          roots: 'event.name, event.correlationKey, event.payload.*, event.payloadSchemaRef — the workflow payload does not exist yet.',
        },
      ],
      functions: listWorkflowExpressionFunctions(),
    },
    dataFlow: [
      'payload.* is the workflow input. For event triggers it is either the raw event payload (when payloadSchemaRef matches the event schema) or the product of trigger.payloadMapping (keys may be dotted paths like "ticket.id"; they expand to nested objects).',
      'vars.* is the scratch space. action.call outputs land where saveAs points — saveAs targets should be vars.* paths (unscoped names are treated as vars.<name>).',
      'transform.assign writes each entry\'s evaluated expression to its path; paths must be scoped payload.* / vars.* / meta.* / error.* .',
      'state.set updates the human-visible run state label (meta.state).',
      'event.wait / human.task resume by setting vars.event (the resume payload) and vars.eventName, then applying their assign map.',
    ],
    workedExample: {
      request:
        'Whenever a ticket is created, if it is from bob@customer.com, set the ticket to high priority and add it to my "important" activity group.',
      notes: [
        'Resolve the high-priority UUID via GET /api/v1/priorities and the group owner user id via GET /api/v1/users before composing; the placeholders below are illustrative.',
        'TICKET_CREATED payloads carry ticketId but not the requester email, so the workflow loads the ticket and its contact first.',
        'payloadSchemaRef payload.TicketCreated.v1 matches the trigger event schema, so no trigger payloadMapping is needed.',
        'activities.find_group resolves the group by name at run time, which keeps the workflow valid if the group is recreated.',
      ],
      definition: {
        id: 'vip-ticket-fast-lane',
        version: 1,
        name: 'VIP ticket fast lane',
        description: 'High priority + important activity group for tickets from bob@customer.com',
        payloadSchemaRef: 'payload.TicketCreated.v1',
        trigger: { type: 'event', eventName: 'TICKET_CREATED' },
        steps: [
          {
            id: 'load-ticket',
            type: 'action.call',
            config: {
              actionId: 'tickets.find',
              version: 1,
              inputMapping: { ticket_id: { $expr: 'payload.ticketId' } },
              saveAs: 'vars.found',
            },
          },
          {
            id: 'has-contact',
            type: 'control.if',
            condition: { $expr: 'vars.found.ticket != null and vars.found.ticket.contact_name_id != null' },
            then: [
              {
                id: 'load-contact',
                type: 'action.call',
                config: {
                  actionId: 'contacts.find',
                  version: 1,
                  inputMapping: { contact_id: { $expr: 'vars.found.ticket.contact_name_id' } },
                  saveAs: 'vars.contactResult',
                },
              },
              {
                id: 'vip-check',
                type: 'control.if',
                condition: {
                  $expr: 'vars.contactResult.contact != null and vars.contactResult.contact.email = "bob@customer.com"',
                },
                then: [
                  {
                    id: 'raise-priority',
                    type: 'action.call',
                    config: {
                      actionId: 'tickets.update_fields',
                      version: 1,
                      inputMapping: {
                        ticket_id: { $expr: 'payload.ticketId' },
                        priority_id: '00000000-0000-0000-0000-00000000hi01',
                      },
                    },
                  },
                  {
                    id: 'find-important-group',
                    type: 'action.call',
                    config: {
                      actionId: 'activities.find_group',
                      version: 1,
                      inputMapping: {
                        groupName: 'important',
                        ownerUserId: '00000000-0000-0000-0000-0000000use01',
                      },
                      saveAs: 'vars.importantGroup',
                    },
                  },
                  {
                    id: 'add-to-group',
                    type: 'action.call',
                    config: {
                      actionId: 'activities.add_to_group',
                      version: 1,
                      inputMapping: {
                        groupId: { $expr: 'vars.importantGroup.groupId' },
                        activityId: { $expr: 'payload.ticketId' },
                        activityType: 'ticket',
                        ownerUserId: '00000000-0000-0000-0000-0000000use01',
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    commonPitfalls: [
      'Every step id must be unique across the whole definition, including nested steps.',
      'control.if conditions must produce a real boolean — `payload.count` alone fails; write `payload.count > 0`.',
      'saveAs targets must be scoped (vars.myResult); bare names are accepted but normalized to vars.*.',
      'action.call requires both actionId and version; look both up in the action registry rather than guessing.',
      'In transform.assign, reference loop variables as vars.<itemVar> — bare locals only resolve in control-flow expressions.',
      'Do not invent tenant UUIDs (priorities, users, boards, groups) — resolve them via the v1 REST endpoints first.',
      'The workflow payloadSchemaRef must exist in the schema registry; when it differs from the trigger event schema a trigger.payloadMapping is required.',
      'Validate, then simulate, before saving — the simulate trace shows each action\'s evaluated input without side effects.',
    ],
  };
}
