import { bootstrapInboundWebhookActions } from './actions/bootstrap';
import { evaluateFieldMapping } from './actions/mappingEvaluator';
import {
  getAction,
  type InboundActionDefinition,
  type InboundActionTargetField,
} from '@alga-psa/shared/inboundWebhooks/actions/registry';
import type { InboundWebhookConfigLookupRow } from './configLookup';
import { filterInboundWebhookHeaders } from './headerFilter';
import { buildWorkflowWebhookEnvelope } from './workflowEnvelope';
import { assertInboundWebhookWorkflowHandlersAvailable } from './editionGate';
import { launchPublishedWorkflowRun } from '@alga-psa/workflows/lib/workflowRunLauncher';
import { createTenantKnex } from '@alga-psa/db';

export class InboundWebhookMappingError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'mapping_failed';

  constructor(message: string) {
    super(message);
    this.name = 'InboundWebhookMappingError';
  }
}

export class InboundWebhookActionError extends Error {
  public readonly action: string;
  public readonly entityType?: string;
  public readonly externalId?: string;
  public readonly metadata?: Record<string, unknown>;

  constructor(args: {
    action: string;
    message: string;
    entityType?: string;
    externalId?: string;
    metadata?: Record<string, unknown>;
  }) {
    super(args.message);
    this.name = 'InboundWebhookActionError';
    this.action = args.action;
    this.entityType = args.entityType;
    this.externalId = args.externalId;
    this.metadata = args.metadata;
  }

  toOutcome(): Record<string, unknown> {
    return {
      action: this.action,
      error: this.message,
      entity_type: this.entityType,
      external_id: this.externalId,
      metadata: this.metadata,
    };
  }
}

export interface DispatchInboundWebhookHandlerInput {
  webhook: Pick<InboundWebhookConfigLookupRow, 'tenant' | 'slug' | 'handler_type' | 'handler_config'>;
  deliveryId: string;
  idempotencyKey: string | null;
  body: unknown;
  headers: Record<string, string | string[]>;
}

export async function dispatchInboundWebhookHandler(
  input: DispatchInboundWebhookHandlerInput,
): Promise<Record<string, unknown>> {
  // Ensure all action packages are registered before lookup. Bootstrap is idempotent
  // and caches a single resolved promise, so this is effectively free after first call.
  await bootstrapInboundWebhookActions();

  if (input.webhook.handler_type === 'direct_action') {
    return dispatchDirectAction(input);
  }

  if (input.webhook.handler_type === 'workflow') {
    assertInboundWebhookWorkflowHandlersAvailable();
    return dispatchWorkflow(input);
  }

  throw new Error(`Unsupported inbound webhook handler type: ${input.webhook.handler_type}`);
}

async function dispatchDirectAction(input: DispatchInboundWebhookHandlerInput): Promise<Record<string, unknown>> {
  const config = input.webhook.handler_config ?? {};
  const actionName = String(config.action ?? '');
  const action = getAction(actionName);

  if (!action) {
    throw new Error(`Inbound action "${actionName}" is not registered`);
  }

  const fieldMapping = isPlainObject(config.field_mapping) ? stringifyRecord(config.field_mapping) : {};
  let mappedValues: Record<string, unknown>;
  try {
    mappedValues = validateMappedValues(action, await evaluateFieldMapping(input.body, fieldMapping));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Inbound webhook field mapping failed';
    throw new InboundWebhookMappingError(message);
  }

  const result = await action.handle(
    {
      tenant: input.webhook.tenant,
      webhookSlug: input.webhook.slug,
      deliveryId: input.deliveryId,
      headers: input.headers,
      rawBody: input.body,
      idempotencyKey: input.idempotencyKey,
    },
    mappedValues,
  );

  if (!result.success) {
    throw new InboundWebhookActionError({
      action: action.name,
      message: result.message || `Inbound action "${action.name}" failed`,
      entityType: result.entityType,
      externalId: result.externalId,
      metadata: result.metadata,
    });
  }

  return {
    action: action.name,
    entity_type: result.entityType,
    entity_id: result.entityId,
    external_id: result.externalId,
    message: result.message,
    metadata: result.metadata,
  };
}

async function dispatchWorkflow(input: DispatchInboundWebhookHandlerInput): Promise<Record<string, unknown>> {
  const config = input.webhook.handler_config ?? {};
  const workflowId = typeof config.workflow_id === 'string' ? config.workflow_id.trim() : '';

  if (!workflowId) {
    throw new Error('Inbound workflow handler requires workflow_id');
  }

  const envelope = buildWorkflowWebhookEnvelope({
    webhookSlug: input.webhook.slug,
    body: input.body,
    headers: filterInboundWebhookHeaders(input.headers),
    deliveryId: input.deliveryId,
    idempotencyKey: input.idempotencyKey,
  });

  const { knex } = await createTenantKnex(input.webhook.tenant);
  const launched = await launchPublishedWorkflowRun(knex, {
    workflowId,
    tenantId: input.webhook.tenant,
    payload: envelope as unknown as Record<string, unknown>,
    triggerType: 'event',
    triggerMetadata: {
      source: 'inbound_webhook',
      webhook_slug: input.webhook.slug,
      delivery_id: input.deliveryId,
      idempotency_key: input.idempotencyKey,
    },
    triggerFireKey: `inbound-webhook:${input.deliveryId}`,
    eventType: 'INBOUND_WEBHOOK_RECEIVED',
    sourcePayloadSchemaRef: 'payload.InboundWebhookReceived.v1',
    executionKey: `inbound-webhook:${input.deliveryId}`,
  });

  return {
    workflow_id: workflowId,
    workflow_run_id: launched.runId,
    workflow_version: launched.workflowVersion,
    envelope,
  };
}

function validateMappedValues(
  action: InboundActionDefinition,
  mappedValues: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const field of action.targetFields) {
    const value = mappedValues[field.name];
    if (isMissing(value)) {
      if (field.required) {
        throw new Error(`Missing required mapped field "${field.name}" for action "${action.name}"`);
      }
      continue;
    }

    normalized[field.name] = normalizeMappedFieldValue(field, value);
  }

  return normalized;
}

function normalizeMappedFieldValue(field: InboundActionTargetField, value: unknown): unknown {
  switch (field.type) {
    case 'string':
    case 'ref':
      return String(value);
    case 'int': {
      const numberValue = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(numberValue)) {
        throw new Error(`Mapped field "${field.name}" must be an integer`);
      }
      return numberValue;
    }
    case 'number': {
      const numberValue = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numberValue)) {
        throw new Error(`Mapped field "${field.name}" must be a number`);
      }
      return numberValue;
    }
    case 'boolean':
      if (typeof value === 'boolean') {
        return value;
      }
      if (value === 'true') {
        return true;
      }
      if (value === 'false') {
        return false;
      }
      throw new Error(`Mapped field "${field.name}" must be a boolean`);
    case 'enum': {
      const stringValue = String(value);
      if (field.enumValues && !field.enumValues.includes(stringValue)) {
        throw new Error(`Mapped field "${field.name}" must be one of: ${field.enumValues.join(', ')}`);
      }
      return stringValue;
    }
    case 'json':
      return value;
    default:
      return value;
  }
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function stringifyRecord(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value)]));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
