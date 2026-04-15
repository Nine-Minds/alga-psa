import type {
  WorkflowDefinition,
  Step,
  NodeStep,
  IfBlock,
  ForEachBlock,
  TryCatchBlock,
} from '@alga-psa/workflows/runtime/client';
import {
  isWorkflowAiInferAction,
  resolveWorkflowAiSchemaFromConfig,
  isWorkflowComposeTextAction,
  resolveComposeTextOutputSchemaFromConfig,
} from '@alga-psa/workflows/authoring';

export type ActionRegistryItem = {
  id: string;
  version: number;
  ui?: {
    label?: string;
    description?: string;
    category?: string;
    icon?: string;
  };
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
};

export type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: Array<string | number | boolean | null>;
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
  $ref?: string;
  definitions?: Record<string, JsonSchema>;
};

export type SchemaField = {
  name: string;
  type: string;
  required: boolean;
  nullable: boolean;
  description?: string;
  defaultValue?: unknown;
  children?: SchemaField[];
  constraints?: {
    enum?: unknown[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
    examples?: unknown[];
  };
};

type StepOutputContext = {
  stepId: string;
  stepName: string;
  saveAs: string;
  outputSchema: JsonSchema;
  fields: SchemaField[];
};

export type DataContext = {
  payload: SchemaField[];
  payloadSchema: JsonSchema | null;
  steps: StepOutputContext[];
  globals: {
    env: SchemaField[];
    secrets: SchemaField[];
    meta: SchemaField[];
    error: SchemaField[];
  };
  forEach?: {
    itemVar: string;
    indexVar: string;
    itemType?: string;
  };
  inCatchBlock?: boolean;
};

type BlockContext = {
  forEach?: { itemVar: string; indexVar: string; itemType?: string };
  inCatchBlock?: boolean;
};

const metaGlobalSchema: JsonSchema = {
  type: 'object',
  properties: {
    state: { type: 'string', description: 'Workflow state' },
    traceId: { type: 'string', description: 'Trace ID' },
    tags: { type: 'object', description: 'Workflow tags' }
  }
};

const errorGlobalSchema: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Error name' },
    message: { type: 'string', description: 'Error message' },
    stack: { type: 'string', description: 'Stack trace' },
    nodePath: { type: 'string', description: 'Error location in workflow' }
  }
};

const resolveSchema = (schema: JsonSchema, root?: JsonSchema): JsonSchema => {
  if (schema.$ref && root?.definitions) {
    const refKey = schema.$ref.replace('#/definitions/', '');
    const resolved = root.definitions?.[refKey];
    if (resolved) return resolveSchema(resolved, root);
  }

  if (schema.anyOf?.length) {
    const nonNullVariant = schema.anyOf.find(
      (variant) => variant.type !== 'null' && !(Array.isArray(variant.type) && variant.type.length === 1 && variant.type[0] === 'null')
    );
    if (nonNullVariant) {
      const resolved = resolveSchema(nonNullVariant, root);
      return {
        ...resolved,
        type: Array.isArray(resolved.type) ? resolved.type : resolved.type ? [resolved.type, 'null'] : ['null']
      };
    }
  }

  return schema;
};

const normalizeSchemaType = (schema?: JsonSchema): string | undefined => {
  if (!schema?.type) return undefined;
  if (Array.isArray(schema.type)) {
    return schema.type.find((t) => t !== 'null') ?? schema.type[0];
  }
  return schema.type;
};

const cloneSchema = (schema?: JsonSchema | null): JsonSchema => {
  if (!schema) return {};
  return JSON.parse(JSON.stringify(schema)) as JsonSchema;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isExpressionValue = (value: unknown): value is { $expr: string } =>
  isPlainObject(value) && typeof value.$expr === 'string';

const isSecretValue = (value: unknown): value is { $secret: string } =>
  isPlainObject(value) && typeof value.$secret === 'string';

const directReferencePattern = /^(?:\$index|[A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)*$/;

const extractDirectReferencePath = (value: unknown): string | null => {
  if (!isExpressionValue(value)) return null;
  const trimmed = value.$expr.trim();
  if (!trimmed) return null;
  return directReferencePattern.test(trimmed) ? trimmed : null;
};

const descendSchema = (schema: JsonSchema | null | undefined, parts: string[]): JsonSchema | null => {
  if (!schema) return null;

  const root = schema;
  let current: JsonSchema | null = resolveSchema(schema, root);

  for (const part of parts) {
    if (!current) return null;
    const resolved = resolveSchema(current, root);
    const type = normalizeSchemaType(resolved);
    if (type !== 'object' || !resolved.properties || !(part in resolved.properties)) {
      return null;
    }
    current = resolved.properties[part] ?? null;
  }

  return current ? resolveSchema(current, root) : null;
};

const inferSchemaFromLiteralValue = (
  value: unknown,
  resolveReferenceSchema: (referencePath: string) => JsonSchema | null
): JsonSchema => {
  const directReferencePath = extractDirectReferencePath(value);
  if (directReferencePath) {
    return cloneSchema(resolveReferenceSchema(directReferencePath));
  }

  if (isSecretValue(value)) {
    return {};
  }

  if (value === null) {
    return { type: 'null' };
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',
      items:
        value.length === 0 ? {} : inferSchemaFromLiteralValue(value[0], resolveReferenceSchema)
    };
  }

  if (isPlainObject(value)) {
    return {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(value).map(([key, nestedValue]) => [
          key,
          inferSchemaFromLiteralValue(nestedValue, resolveReferenceSchema)
        ])
      )
    };
  }

  switch (typeof value) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: Number.isInteger(value) ? 'integer' : 'number' };
    case 'boolean':
      return { type: 'boolean' };
    default:
      return {};
  }
};

const createObjectTransformOutputSchema = (
  properties: Record<string, JsonSchema>,
  additionalProperties?: boolean
): JsonSchema => ({
  type: 'object',
  properties: {
    object: {
      type: 'object',
      description: 'Transformed object output',
      properties,
      ...(additionalProperties === undefined ? {} : { additionalProperties })
    }
  }
});

export const extractSchemaFields = (schema: JsonSchema, root?: JsonSchema): SchemaField[] => {
  const resolved = schema ? resolveSchema(schema, root) : schema;
  if (!resolved?.properties) return [];

  const requiredFields = resolved.required ?? [];
  return Object.entries(resolved.properties).map(([name, propSchema]) => {
    const resolvedProp = resolveSchema(propSchema, root);
    const type = normalizeSchemaType(resolvedProp) ?? 'unknown';
    const isNullable = Array.isArray(resolvedProp.type) && resolvedProp.type.includes('null');
    const isFieldRequired = requiredFields.includes(name);

    let children: SchemaField[] | undefined;
    if (type === 'object' && resolvedProp.properties) {
      children = extractSchemaFields(resolvedProp, root);
    } else if (type === 'array' && resolvedProp.items) {
      const itemSchema = resolveSchema(resolvedProp.items, root);
      if (itemSchema.properties) {
        children = extractSchemaFields(itemSchema, root);
      }
    }

    const prop = resolvedProp as JsonSchema & {
      minimum?: number;
      maximum?: number;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      format?: string;
      examples?: unknown[];
    };
    const constraints: SchemaField['constraints'] = {};
    if (prop.enum) constraints.enum = prop.enum;
    if (typeof prop.minimum === 'number') constraints.minimum = prop.minimum;
    if (typeof prop.maximum === 'number') constraints.maximum = prop.maximum;
    if (typeof prop.minLength === 'number') constraints.minLength = prop.minLength;
    if (typeof prop.maxLength === 'number') constraints.maxLength = prop.maxLength;
    if (typeof prop.pattern === 'string') constraints.pattern = prop.pattern;
    if (typeof prop.format === 'string') constraints.format = prop.format;
    if (Array.isArray(prop.examples)) constraints.examples = prop.examples;
    const hasConstraints = Object.keys(constraints).length > 0;

    return {
      name,
      type,
      description: resolvedProp.description,
      required: isFieldRequired,
      nullable: isNullable,
      defaultValue: resolvedProp.default,
      children,
      constraints: hasConstraints ? constraints : undefined,
    };
  });
};

export const buildDataContext = (
  definition: WorkflowDefinition,
  currentStepId: string,
  actionRegistry: ActionRegistryItem[],
  payloadSchema: JsonSchema | null
): DataContext => {
  const context: DataContext = {
    payload: payloadSchema ? extractSchemaFields(payloadSchema, payloadSchema) : [],
    payloadSchema,
    steps: [],
    globals: {
      env: [{ name: 'env', type: 'object', required: false, nullable: false, description: 'Environment variables' }],
      secrets: [{ name: 'secrets', type: 'object', required: false, nullable: false, description: 'Workflow secrets' }],
      meta: [
        { name: 'state', type: 'string', required: false, nullable: true, description: 'Workflow state' },
        { name: 'traceId', type: 'string', required: false, nullable: true, description: 'Trace ID' },
        { name: 'tags', type: 'object', required: false, nullable: true, description: 'Workflow tags' }
      ],
      error: [
        { name: 'name', type: 'string', required: false, nullable: true, description: 'Error name' },
        { name: 'message', type: 'string', required: false, nullable: true, description: 'Error message' },
        { name: 'stack', type: 'string', required: false, nullable: true, description: 'Stack trace' },
        { name: 'nodePath', type: 'string', required: false, nullable: true, description: 'Error location' }
      ]
    }
  };

  const assignedVars = new Map<string, { lastStepId: string; lastStepName: string; nestedPaths: string[][] }>();

  const recordAssignedVarPath = (assignmentPath: string, step: Step) => {
    if (!assignmentPath.startsWith('vars.')) return;

    const remainder = assignmentPath.slice('vars.'.length);
    const parts = remainder.split('.').filter(Boolean);
    if (parts.length === 0) return;

    const [rootName, ...nested] = parts;
    if (!rootName) return;

    const nodeStep = step as NodeStep;
    const defaultName = step.type === 'transform.assign' ? 'Assign' : step.type;
    const stepName = nodeStep.name || defaultName;

    const existing = assignedVars.get(rootName) ?? {
      lastStepId: step.id,
      lastStepName: stepName,
      nestedPaths: []
    };

    existing.lastStepId = step.id;
    existing.lastStepName = stepName;
    if (nested.length > 0) {
      existing.nestedPaths.push(nested);
    }

    assignedVars.set(rootName, existing);
  };

  const buildAssignedVarSchema = (nestedPaths: string[][]): JsonSchema => {
    if (!nestedPaths.length) {
      return {};
    }

    const root: JsonSchema = { type: 'object', properties: {} };

    const ensureObjectProperty = (schema: JsonSchema, key: string): JsonSchema => {
      schema.properties ??= {};
      const existing = schema.properties[key] as JsonSchema | undefined;
      if (existing && typeof existing === 'object') {
        if (normalizeSchemaType(existing) !== 'object') {
          schema.properties[key] = { type: 'object', properties: {} };
        } else {
          (schema.properties[key] as JsonSchema).properties ??= {};
        }
      } else {
        schema.properties[key] = { type: 'object', properties: {} };
      }
      return schema.properties[key] as JsonSchema;
    };

    const ensureLeafProperty = (schema: JsonSchema, key: string) => {
      schema.properties ??= {};
      if (!(key in schema.properties)) {
        schema.properties[key] = {};
      }
    };

    for (const pathParts of nestedPaths) {
      let cursor = root;
      pathParts.forEach((segment, idx) => {
        const isLeaf = idx === pathParts.length - 1;
        if (isLeaf) {
          ensureLeafProperty(cursor, segment);
        } else {
          cursor = ensureObjectProperty(cursor, segment);
        }
      });
    }

    return root;
  };

  const resolveReferenceSchema = (referencePath: string, blockCtx: BlockContext): JsonSchema | null => {
    const parts = referencePath.split('.').filter(Boolean);
    if (parts.length === 0) return null;

    if (parts[0] === 'payload') {
      return descendSchema(payloadSchema, parts.slice(1));
    }

    if (parts[0] === 'vars' && parts.length >= 2) {
      const stepOutput = context.steps.find((candidate) => candidate.saveAs === parts[1]);
      return descendSchema(stepOutput?.outputSchema ?? null, parts.slice(2));
    }

    if (parts[0] === 'meta') {
      return descendSchema(metaGlobalSchema, parts.slice(1));
    }

    if (parts[0] === 'error' && blockCtx.inCatchBlock) {
      return descendSchema(errorGlobalSchema, parts.slice(1));
    }

    if (blockCtx.forEach?.itemVar && parts[0] === blockCtx.forEach.itemVar) {
      const itemSchema =
        blockCtx.forEach.itemType && blockCtx.forEach.itemType !== 'any'
          ? ({ type: blockCtx.forEach.itemType } as JsonSchema)
          : {};
      return descendSchema(itemSchema, parts.slice(1));
    }

    if (blockCtx.forEach?.indexVar && parts[0] === blockCtx.forEach.indexVar) {
      return parts.length === 1 ? { type: 'number' } : null;
    }

    return null;
  };

  const inferTransformObjectOutputSchema = (
    step: NodeStep,
    actionId: string,
    fallbackOutputSchema: JsonSchema,
    blockCtx: BlockContext
  ): JsonSchema => {
    if (isWorkflowComposeTextAction(actionId)) {
      return (resolveComposeTextOutputSchemaFromConfig(step.config) as JsonSchema | null) ?? fallbackOutputSchema;
    }

    const config = (step.config ?? {}) as { inputMapping?: Record<string, unknown> };
    const inputMapping = config.inputMapping ?? {};
    const resolveForValue = (value: unknown) => {
      const directReferencePath = extractDirectReferencePath(value);
      return directReferencePath ? resolveReferenceSchema(directReferencePath, blockCtx) : null;
    };

    if (actionId === 'transform.build_object') {
      const fields = Array.isArray(inputMapping.fields) ? inputMapping.fields : [];
      const properties: Record<string, JsonSchema> = {};

      fields.forEach((field) => {
        if (!isPlainObject(field) || typeof field.key !== 'string') return;
        const key = field.key.trim();
        if (!key) return;
        properties[key] = inferSchemaFromLiteralValue(field.value, resolveReferenceSchemaForValue =>
          resolveReferenceSchema(resolveReferenceSchemaForValue, blockCtx)
        );
      });

      return Object.keys(properties).length > 0
        ? createObjectTransformOutputSchema(properties, false)
        : fallbackOutputSchema;
    }

    if (actionId === 'transform.pick_fields') {
      const selectedFields = Array.isArray(inputMapping.fields)
        ? inputMapping.fields.filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
        : [];
      if (selectedFields.length === 0) {
        return fallbackOutputSchema;
      }

      const sourceSchema = resolveForValue(inputMapping.source);
      const sourceObjectSchema =
        normalizeSchemaType(sourceSchema ?? undefined) === 'object' ? sourceSchema : null;
      const properties = Object.fromEntries(
        selectedFields.map((fieldName) => [
          fieldName,
          cloneSchema(sourceObjectSchema?.properties?.[fieldName])
        ])
      );

      return createObjectTransformOutputSchema(properties, !sourceObjectSchema);
    }

    if (actionId === 'transform.rename_fields') {
      const sourceSchema = resolveForValue(inputMapping.source);
      const sourceObjectSchema =
        normalizeSchemaType(sourceSchema ?? undefined) === 'object' ? sourceSchema : null;
      const properties = sourceObjectSchema?.properties
        ? Object.fromEntries(
            Object.entries(sourceObjectSchema.properties).map(([key, schema]) => [key, cloneSchema(schema)])
          )
        : {};

      const renames = Array.isArray(inputMapping.renames) ? inputMapping.renames : [];
      renames.forEach((renameEntry) => {
        if (!isPlainObject(renameEntry)) return;
        if (typeof renameEntry.from !== 'string' || typeof renameEntry.to !== 'string') return;
        const from = renameEntry.from.trim();
        const to = renameEntry.to.trim();
        if (!from || !to) return;

        const nextSchema = cloneSchema(properties[from]);
        properties[to] = nextSchema;
        if (to !== from) {
          delete properties[from];
        }
      });

      return Object.keys(properties).length > 0
        ? createObjectTransformOutputSchema(properties, !sourceObjectSchema)
        : fallbackOutputSchema;
    }

    return fallbackOutputSchema;
  };

  const walkSteps = (steps: Step[], stopAtId: string, blockCtx: BlockContext): BlockContext | null => {
    for (const step of steps) {
      if (step.id === stopAtId) {
        return blockCtx;
      }

      if (!step.type.startsWith('control.')) {
        const nodeStep = step as NodeStep;
        const config = nodeStep.config as { actionId?: string; version?: number; saveAs?: string } | undefined;

        if (config?.saveAs) {
          if (step.type === 'action.call' && config?.actionId) {
            const action = actionRegistry.find(a =>
              a.id === config.actionId &&
              (config.version === undefined || a.version === config.version)
            );
            if (action?.outputSchema) {
              const outputSchema =
                config.actionId.startsWith('transform.')
                  ? inferTransformObjectOutputSchema(nodeStep, config.actionId, action.outputSchema, blockCtx)
                  : isWorkflowAiInferAction(config.actionId)
                    ? ((resolveWorkflowAiSchemaFromConfig(config).schema ?? {}) as JsonSchema)
                    : action.outputSchema;
              context.steps.push({
                stepId: step.id,
                stepName: nodeStep.name || action.ui?.label || config.actionId,
                saveAs: config.saveAs,
                outputSchema,
                fields: extractSchemaFields(outputSchema, outputSchema)
              });
            }
          } else {
            const action = actionRegistry.find(a => a.id === step.type);
            if (action?.outputSchema) {
              context.steps.push({
                stepId: step.id,
                stepName: nodeStep.name || action.ui?.label || step.type,
                saveAs: config.saveAs,
                outputSchema: action.outputSchema,
                fields: extractSchemaFields(action.outputSchema, action.outputSchema)
              });
            } else {
              context.steps.push({
                stepId: step.id,
                stepName: nodeStep.name || step.type,
                saveAs: config.saveAs,
                outputSchema: {},
                fields: []
              });
            }
          }
        }
      }

      if (step.type === 'transform.assign' || step.type === 'event.wait' || step.type === 'time.wait') {
        const config = (step as NodeStep).config as { assign?: Record<string, { $expr: string }> } | undefined;
        if (config?.assign) {
          for (const path of Object.keys(config.assign)) {
            recordAssignedVarPath(path, step);
          }
        }
      }

      if (step.type === 'control.if') {
        const ifBlock = step as IfBlock;
        const found = walkSteps(ifBlock.then, stopAtId, blockCtx);
        if (found) return found;
        if (ifBlock.else) {
          const foundElse = walkSteps(ifBlock.else, stopAtId, blockCtx);
          if (foundElse) return foundElse;
        }
      } else if (step.type === 'control.forEach') {
        const forEachBlock = step as ForEachBlock;
        const forEachCtx: BlockContext = {
          ...blockCtx,
          forEach: {
            itemVar: forEachBlock.itemVar,
            indexVar: '$index',
            itemType: 'any'
          }
        };
        const found = walkSteps(forEachBlock.body, stopAtId, forEachCtx);
        if (found) return found;
      } else if (step.type === 'control.tryCatch') {
        const tryCatchBlock = step as TryCatchBlock;
        const foundTry = walkSteps(tryCatchBlock.try, stopAtId, blockCtx);
        if (foundTry) return foundTry;
        const catchCtx: BlockContext = { ...blockCtx, inCatchBlock: true };
        const foundCatch = walkSteps(tryCatchBlock.catch, stopAtId, catchCtx);
        if (foundCatch) return foundCatch;
      }
    }
    return null;
  };

  const foundBlockCtx = walkSteps(definition.steps, currentStepId, {});

  if (foundBlockCtx) {
    if (foundBlockCtx.forEach) {
      context.forEach = foundBlockCtx.forEach;
    }
    if (foundBlockCtx.inCatchBlock) {
      context.inCatchBlock = true;
    }
  }

  const existingSaveAs = new Set(context.steps.map((entry) => entry.saveAs));
  for (const [saveAs, meta] of assignedVars.entries()) {
    if (existingSaveAs.has(saveAs)) continue;
    const outputSchema = buildAssignedVarSchema(meta.nestedPaths);
    context.steps.push({
      stepId: `${meta.lastStepId}:${saveAs}`,
      stepName: meta.lastStepName,
      saveAs,
      outputSchema,
      fields: extractSchemaFields(outputSchema, outputSchema)
    });
  }

  return context;
};
