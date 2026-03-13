import type { InputMapping, MappingValue, Step } from '@shared/workflow/runtime/client';

import type { ActionInputField } from './mapping';

type JsonSchema = {
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
  'x-workflow-picker-kind'?: string;
  'x-workflow-picker-dependencies'?: string[];
  'x-workflow-picker-fixed-value-hint'?: string;
  'x-workflow-picker-allow-dynamic-reference'?: boolean;
};

export type WorkflowDesignerActionRegistryItem = {
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

export type ActionInputEditorState = {
  selectedAction?: WorkflowDesignerActionRegistryItem;
  actionInputFields: ActionInputField[];
  requiredActionInputFields: ActionInputField[];
  inputMapping: InputMapping;
  mappedInputFieldCount: number;
  mappedRequiredInputFieldCount: number;
  unmappedRequiredInputFieldCount: number;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const resolveSchema = (schema: JsonSchema, root?: JsonSchema): JsonSchema => {
  if (schema.$ref && root?.definitions) {
    const refKey = schema.$ref.replace('#/definitions/', '');
    const resolved = root.definitions?.[refKey];
    if (resolved) return resolveSchema(resolved, root);
  }

  if (schema.anyOf?.length) {
    const nonNullVariant = schema.anyOf.find(
      (variant) =>
        variant.type !== 'null' &&
        !(Array.isArray(variant.type) && variant.type.length === 1 && variant.type[0] === 'null')
    );
    if (nonNullVariant) {
      const resolved = resolveSchema(nonNullVariant, root);
      return {
        ...resolved,
        type: Array.isArray(resolved.type)
          ? resolved.type
          : resolved.type
            ? [resolved.type, 'null']
            : ['null'],
      };
    }
  }

  return schema;
};

const normalizeSchemaType = (schema?: JsonSchema): string | undefined => {
  if (!schema?.type) return undefined;
  if (Array.isArray(schema.type)) {
    return schema.type.find((value) => value !== 'null') ?? schema.type[0];
  }
  return schema.type;
};

const extractActionInputFields = (schema: JsonSchema | undefined, root?: JsonSchema): ActionInputField[] => {
  if (!schema) return [];
  const resolved = resolveSchema(schema, root);
  if (!resolved.properties) return [];

  const requiredFields = resolved.required ?? [];
  return Object.entries(resolved.properties).map(([name, propSchema]) => {
    const resolvedProp = resolveSchema(propSchema, root);
    const type = normalizeSchemaType(resolvedProp) ?? 'string';
    const isFieldRequired = requiredFields.includes(name);
    const rawResolved = resolvedProp as {
      format?: string;
      minItems?: number;
      maxItems?: number;
      minLength?: number;
      maxLength?: number;
      minimum?: number;
      maximum?: number;
      pattern?: string;
      items?: JsonSchema;
      'x-workflow-picker-kind'?: string;
      'x-workflow-picker-dependencies'?: string[];
      'x-workflow-picker-fixed-value-hint'?: string;
      'x-workflow-picker-allow-dynamic-reference'?: boolean;
    };

    let children: ActionInputField[] | undefined;
    let itemType: string | undefined;
    if (type === 'object' && resolvedProp.properties) {
      children = extractActionInputFields(resolvedProp, root);
    } else if (type === 'array' && resolvedProp.items) {
      const itemSchema = resolveSchema(resolvedProp.items, root);
      itemType = normalizeSchemaType(itemSchema) ?? undefined;
      if (itemSchema.properties) {
        children = extractActionInputFields(itemSchema, root);
      }
    }

    const constraints = {
      format: rawResolved.format,
      minItems: rawResolved.minItems,
      maxItems: rawResolved.maxItems,
      minLength: rawResolved.minLength,
      maxLength: rawResolved.maxLength,
      minimum: rawResolved.minimum,
      maximum: rawResolved.maximum,
      pattern: rawResolved.pattern,
      itemType,
    };
    const hasConstraints = Object.values(constraints).some((constraint) => constraint !== undefined);
    const picker =
      typeof rawResolved['x-workflow-picker-kind'] === 'string'
        ? {
            kind: rawResolved['x-workflow-picker-kind'],
            dependencies: Array.isArray(rawResolved['x-workflow-picker-dependencies'])
              ? rawResolved['x-workflow-picker-dependencies']
              : undefined,
            fixedValueHint:
              typeof rawResolved['x-workflow-picker-fixed-value-hint'] === 'string'
                ? rawResolved['x-workflow-picker-fixed-value-hint']
                : undefined,
            allowsDynamicReference:
              typeof rawResolved['x-workflow-picker-allow-dynamic-reference'] === 'boolean'
                ? rawResolved['x-workflow-picker-allow-dynamic-reference']
                : undefined,
          }
        : undefined;

    return {
      name,
      type,
      description: resolvedProp.description,
      required: isFieldRequired,
      picker,
      enum: resolvedProp.enum,
      default: resolvedProp.default,
      constraints: hasConstraints ? constraints : undefined,
      children,
    };
  });
};

export const getActionFromRegistry = (
  actionId: string | undefined,
  version: number | undefined,
  actionRegistry: WorkflowDesignerActionRegistryItem[]
): WorkflowDesignerActionRegistryItem | undefined => {
  if (!actionId) return undefined;
  return actionRegistry.find(
    (action) => action.id === actionId && (version === undefined || action.version === version)
  );
};

const isInputMappingValueSet = (value: MappingValue | undefined, fieldType?: string): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    if ('$secret' in value) return typeof value.$secret === 'string' && value.$secret.trim().length > 0;
    if ('$expr' in value) return typeof value.$expr === 'string' && value.$expr.trim().length > 0;
    const entryCount = Object.keys(value).length;
    if (fieldType === 'object') return entryCount > 0;
    return entryCount > 0;
  }
  return false;
};

export const buildActionInputEditorState = (
  step: Pick<Step, 'type'> & { config?: unknown },
  actionRegistry: WorkflowDesignerActionRegistryItem[]
): ActionInputEditorState => {
  const config = asRecord(step.config);
  const selectedAction =
    step.type === 'action.call'
      ? getActionFromRegistry(
          typeof config?.actionId === 'string' ? config.actionId : undefined,
          typeof config?.version === 'number' ? config.version : undefined,
          actionRegistry
        )
      : undefined;
  const actionInputFields = selectedAction?.inputSchema
    ? extractActionInputFields(selectedAction.inputSchema, selectedAction.inputSchema)
    : [];
  const inputMapping = (asRecord(config?.inputMapping) as InputMapping | undefined) ?? {};
  const requiredActionInputFields = actionInputFields.filter((field) => Boolean(field.required));
  const mappedInputFieldCount = Object.keys(inputMapping).length;
  const mappedRequiredInputFieldCount = requiredActionInputFields.filter((field) =>
    isInputMappingValueSet(inputMapping[field.name], field.type)
  ).length;

  return {
    selectedAction,
    actionInputFields,
    requiredActionInputFields,
    inputMapping,
    mappedInputFieldCount,
    mappedRequiredInputFieldCount,
    unmappedRequiredInputFieldCount: requiredActionInputFields.length - mappedRequiredInputFieldCount,
  };
};
