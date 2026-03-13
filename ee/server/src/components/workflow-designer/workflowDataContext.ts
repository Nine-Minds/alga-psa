import type {
  WorkflowDefinition,
  Step,
  NodeStep,
  IfBlock,
  ForEachBlock,
  TryCatchBlock,
} from '@shared/workflow/runtime/client';

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

const extractSchemaFields = (schema: JsonSchema, root?: JsonSchema): SchemaField[] => {
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

    const rootName = parts[0]!;
    const nested = parts.slice(1);

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
              context.steps.push({
                stepId: step.id,
                stepName: nodeStep.name || action.ui?.label || config.actionId,
                saveAs: config.saveAs,
                outputSchema: action.outputSchema,
                fields: extractSchemaFields(action.outputSchema, action.outputSchema)
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

      if (step.type === 'transform.assign' || step.type === 'event.wait') {
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
