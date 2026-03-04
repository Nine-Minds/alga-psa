import type { SharedExpressionContextRoot, SharedExpressionSchemaNode, SharedExpressionPathOption } from '../context';
import { buildPathOptionsFromContextRoots } from '../pathDiscovery';

const DEFAULT_META_SCHEMA: SharedExpressionSchemaNode = {
  type: 'object',
  properties: {
    state: { type: 'string', description: 'Workflow state' },
    traceId: { type: 'string', description: 'Workflow trace identifier' },
    tags: { type: 'object', description: 'Workflow metadata tags' },
  },
};

const DEFAULT_ERROR_SCHEMA: SharedExpressionSchemaNode = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Error class name' },
    message: { type: 'string', description: 'Error message' },
    stack: { type: 'string', description: 'Error stack trace' },
    nodePath: { type: 'string', description: 'Workflow node path where error occurred' },
  },
};

export type WorkflowForEachAdapterContext = {
  itemVar: string;
  indexVar?: string;
  itemSchema?: SharedExpressionSchemaNode;
};

export type BuildWorkflowExpressionContextRootsParams = {
  allowPayloadRoot?: boolean;
  payloadSchema?: SharedExpressionSchemaNode;
  varsSchema?: SharedExpressionSchemaNode;
  varsByName?: Record<string, SharedExpressionSchemaNode>;
  metaSchema?: SharedExpressionSchemaNode;
  errorSchema?: SharedExpressionSchemaNode;
  includeErrorRoot?: boolean;
  forEach?: WorkflowForEachAdapterContext;
};

const createVarsSchema = (
  varsSchema: SharedExpressionSchemaNode | undefined,
  varsByName: Record<string, SharedExpressionSchemaNode> | undefined
): SharedExpressionSchemaNode => {
  if (varsSchema) {
    return varsSchema;
  }
  return {
    type: 'object',
    properties: varsByName ?? {},
  };
};

export const buildWorkflowExpressionContextRoots = (
  params: BuildWorkflowExpressionContextRootsParams = {}
): SharedExpressionContextRoot[] => {
  const roots: SharedExpressionContextRoot[] = [];

  if (params.allowPayloadRoot !== false) {
    roots.push({
      key: 'payload',
      label: 'Payload',
      description: 'Workflow input payload',
      schema: params.payloadSchema ?? { type: 'object', properties: {} },
      allowInModes: ['expression'],
    });
  }

  roots.push({
    key: 'vars',
    label: 'Variables',
    description: 'Saved outputs from previous workflow steps',
    schema: createVarsSchema(params.varsSchema, params.varsByName),
    allowInModes: ['expression'],
  });

  roots.push({
    key: 'meta',
    label: 'Meta',
    description: 'Workflow runtime metadata',
    schema: params.metaSchema ?? DEFAULT_META_SCHEMA,
    allowInModes: ['expression'],
  });

  if (params.includeErrorRoot || params.errorSchema) {
    roots.push({
      key: 'error',
      label: 'Error',
      description: 'Error context available in catch blocks',
      schema: params.errorSchema ?? DEFAULT_ERROR_SCHEMA,
      allowInModes: ['expression'],
    });
  }

  if (params.forEach?.itemVar) {
    roots.push({
      key: params.forEach.itemVar,
      label: params.forEach.itemVar,
      description: 'Current foreach item',
      schema: params.forEach.itemSchema ?? { type: 'object', properties: {} },
      allowInModes: ['expression'],
    });
  }

  if (params.forEach?.indexVar) {
    roots.push({
      key: params.forEach.indexVar,
      label: params.forEach.indexVar,
      description: 'Current foreach loop index',
      schema: { type: 'number' },
      allowInModes: ['expression'],
    });
  }

  return roots;
};

export const buildWorkflowExpressionPathOptions = (
  params: BuildWorkflowExpressionContextRootsParams = {}
): SharedExpressionPathOption[] =>
  buildPathOptionsFromContextRoots(buildWorkflowExpressionContextRoots(params), {
    mode: 'expression',
  });
