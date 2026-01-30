/**
 * Expression Context Builder
 *
 * Centralizes construction of Monaco ExpressionContext objects from JSON Schema inputs.
 * Keeps meta/error schemas consistent across the workflow designer and mapping editors.
 */

import type { ExpressionContext, JsonSchema } from './completionProvider';

export const DEFAULT_META_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    state: { type: 'string', description: 'Workflow state' },
    traceId: { type: 'string', description: 'Trace ID' },
    tags: { type: 'object', description: 'Workflow tags' },
  },
};

export const DEFAULT_ERROR_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Error name' },
    message: { type: 'string', description: 'Error message' },
    stack: { type: 'string', description: 'Stack trace' },
    nodePath: { type: 'string', description: 'Error location in workflow' },
  },
};

export type WorkflowExpressionContextParams = {
  payloadSchema?: JsonSchema | null;
  varsSchema?: JsonSchema | null;
  varsByName?: Record<string, JsonSchema> | null;
  inCatchBlock?: boolean;
  forEachItemVar?: string;
  forEachItemSchema?: JsonSchema | null;
  forEachIndexVar?: string;
};

export function buildWorkflowExpressionContext(params: WorkflowExpressionContextParams): ExpressionContext {
  const varsSchema: JsonSchema | undefined = params.varsSchema
    ? params.varsSchema
    : params.varsByName && Object.keys(params.varsByName).length > 0
      ? { type: 'object', properties: params.varsByName }
      : undefined;

  return {
    payloadSchema: params.payloadSchema ?? undefined,
    varsSchema,
    metaSchema: DEFAULT_META_SCHEMA,
    errorSchema: params.inCatchBlock ? DEFAULT_ERROR_SCHEMA : undefined,
    inCatchBlock: params.inCatchBlock,
    forEachItemVar: params.forEachItemVar,
    forEachItemSchema: params.forEachItemSchema ?? undefined,
    forEachIndexVar: params.forEachIndexVar,
  };
}

export type TriggerMappingExpressionContextParams = {
  sourcePayloadSchema?: JsonSchema | null;
};

export function buildTriggerMappingExpressionContext(params: TriggerMappingExpressionContextParams): ExpressionContext {
  const sourceSchema = params.sourcePayloadSchema ?? { type: 'object', properties: {} };

  return {
    allowPayloadRoot: false,
    eventSchema: {
      type: 'object',
      properties: {
        payload: sourceSchema,
      },
    },
    metaSchema: DEFAULT_META_SCHEMA,
  };
}

