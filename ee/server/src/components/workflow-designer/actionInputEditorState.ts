import type {
  InputMapping,
  MappingValue,
  Step,
} from '@alga-psa/workflows/runtime';

import type { ActionInputField } from './mapping';
import { applyWorkflowActionPresentationHints } from './workflowActionPresentation';
import { resolveWorkflowSchemaFieldEditor } from './workflowSchemaFieldEditor';

type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  format?: string;
  examples?: unknown[];
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
  'x-workflow-editor'?: import('@alga-psa/shared/workflow/runtime').WorkflowEditorJsonSchemaMetadata;
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

const mergeSchemaMetadata = (wrapper: JsonSchema, resolved: JsonSchema): JsonSchema => ({
  ...wrapper,
  ...resolved,
  title: resolved.title ?? wrapper.title,
  description: resolved.description ?? wrapper.description,
  examples: resolved.examples ?? wrapper.examples,
  default: resolved.default ?? wrapper.default,
  'x-workflow-picker-kind': resolved['x-workflow-picker-kind'] ?? wrapper['x-workflow-picker-kind'],
  'x-workflow-picker-dependencies':
    resolved['x-workflow-picker-dependencies'] ?? wrapper['x-workflow-picker-dependencies'],
  'x-workflow-picker-fixed-value-hint':
    resolved['x-workflow-picker-fixed-value-hint'] ?? wrapper['x-workflow-picker-fixed-value-hint'],
  'x-workflow-picker-allow-dynamic-reference':
    resolved['x-workflow-picker-allow-dynamic-reference'] ?? wrapper['x-workflow-picker-allow-dynamic-reference'],
  'x-workflow-editor': resolved['x-workflow-editor'] ?? wrapper['x-workflow-editor'],
});

const isNullSchema = (schema: JsonSchema): boolean =>
  schema.type === 'null' ||
  (Array.isArray(schema.type) && schema.type.length === 1 && schema.type[0] === 'null');

const resolveSchema = (schema: JsonSchema, root?: JsonSchema): JsonSchema => {
  if (schema.$ref && root?.definitions) {
    const refKey = schema.$ref.replace('#/definitions/', '');
    const resolved = root.definitions?.[refKey];
    if (resolved) return resolveSchema(resolved, root);
  }

  if (schema.anyOf?.length) {
    const nonNullVariants = schema.anyOf.filter((variant) => !isNullSchema(variant));
    const hasNullVariant = schema.anyOf.some(isNullSchema);

    if (nonNullVariants.length === 1 && hasNullVariant) {
      const resolved = resolveSchema(nonNullVariants[0], root);
      const mergedWithoutCombinators = { ...mergeSchemaMetadata(schema, resolved) };
      delete mergedWithoutCombinators.anyOf;
      delete mergedWithoutCombinators.oneOf;
      return {
        ...mergedWithoutCombinators,
        type: Array.isArray(resolved.type)
          ? Array.from(new Set([...resolved.type, 'null']))
          : resolved.type
            ? [resolved.type, 'null']
            : ['null'],
      };
    }
  }

  return schema;
};

const normalizeSchemaType = (schema?: JsonSchema, root?: JsonSchema): string | undefined => {
  if (!schema) return undefined;

  const unionVariants = schema.anyOf ?? schema.oneOf;
  if (unionVariants?.length) {
    const unionTypes = unionVariants
      .map((variant) => normalizeSchemaType(resolveSchema(variant, root), root))
      .filter((value): value is string => Boolean(value));
    const uniqueTypes = Array.from(new Set(unionTypes));
    if (uniqueTypes.length > 0) {
      return uniqueTypes.join(' | ');
    }
  }

  if (!schema.type) return undefined;
  if (Array.isArray(schema.type)) {
    return schema.type.find((value) => value !== 'null') ?? schema.type[0];
  }
  return schema.type;
};


const flattenRequiredActionInputFields = (
  fields: ActionInputField[],
  mappingValue: unknown,
  prefix = ''
): {
  requiredFields: ActionInputField[];
  mappedRequiredFieldCount: number;
} => {
  const requiredFields: ActionInputField[] = [];
  let mappedRequiredFieldCount = 0;

  fields.forEach((field) => {
    const fieldPath = prefix ? `${prefix}.${field.name}` : field.name;
    const currentValue =
      mappingValue && typeof mappingValue === 'object' && !Array.isArray(mappingValue)
        ? (mappingValue as Record<string, unknown>)[field.name]
        : undefined;

    const hasObjectChildren = field.type === 'object' && (field.children?.length ?? 0) > 0;
    const hasArrayObjectChildren = field.type === 'array' && (field.children?.length ?? 0) > 0;
    const isWholeObjectMapping =
      currentValue &&
      typeof currentValue === 'object' &&
      !Array.isArray(currentValue) &&
      ('$expr' in currentValue || '$secret' in currentValue);

    if (
      hasObjectChildren &&
      (field.required || isInputMappingValueSet(currentValue as MappingValue | undefined, field.type))
    ) {
      const childStats = flattenRequiredActionInputFields(
        field.children ?? [],
        currentValue,
        fieldPath
      );

      if (childStats.requiredFields.length > 0) {
        requiredFields.push(...childStats.requiredFields);
        mappedRequiredFieldCount += isWholeObjectMapping
          ? childStats.requiredFields.length
          : childStats.mappedRequiredFieldCount;
        return;
      }
    }

    if (hasArrayObjectChildren && Array.isArray(currentValue) && currentValue.length > 0) {
      currentValue.forEach((item, index) => {
        const childStats = flattenRequiredActionInputFields(
          field.children ?? [],
          item,
          `${fieldPath}[${index}]`
        );
        requiredFields.push(...childStats.requiredFields);
        mappedRequiredFieldCount += childStats.mappedRequiredFieldCount;
      });
      return;
    }

    if (field.required) {
      requiredFields.push({
        ...field,
        name: fieldPath,
      });

      if (isInputMappingValueSet(currentValue as MappingValue | undefined, field.type)) {
        mappedRequiredFieldCount += 1;
      }
    }
  });

  return {
    requiredFields,
    mappedRequiredFieldCount,
  };
};

const extractActionInputFields = (schema: JsonSchema | undefined, root?: JsonSchema): ActionInputField[] => {
  if (!schema) return [];
  const resolved = resolveSchema(schema, root);
  if (!resolved.properties) return [];

  const requiredFields = resolved.required ?? [];
  return Object.entries(resolved.properties).map(([name, propSchema]) => {
    const resolvedProp = resolveSchema(propSchema, root);
    const type = normalizeSchemaType(resolvedProp, root) ?? 'string';
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
      'x-workflow-editor'?: import('@alga-psa/shared/workflow/runtime').WorkflowEditorJsonSchemaMetadata;
    };

    let children: ActionInputField[] | undefined;
    let itemType: string | undefined;
    let itemEditor: ReturnType<typeof resolveWorkflowSchemaFieldEditor> | undefined;
    if (type === 'object' && resolvedProp.properties) {
      children = extractActionInputFields(resolvedProp, root);
    } else if (type === 'array' && resolvedProp.items) {
      const itemSchema = resolveSchema(resolvedProp.items, root);
      itemType =
        normalizeSchemaType(itemSchema, root) ??
        (itemSchema.properties ? 'object' : 'unknown');
      itemEditor = resolveWorkflowSchemaFieldEditor(itemSchema);
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
    const fieldEditor = resolveWorkflowSchemaFieldEditor(rawResolved);
    const shouldPromoteItemUserPicker =
      type === 'array' &&
      itemType === 'string' &&
      !children?.length &&
      itemEditor?.kind === 'picker' &&
      itemEditor.picker?.resource === 'user';
    const editor = fieldEditor ?? (shouldPromoteItemUserPicker ? itemEditor : undefined);

    return {
      name,
      type,
      nullable: Array.isArray(resolvedProp.type)
        ? resolvedProp.type.includes('null')
        : resolvedProp.type === 'null',
      description: resolvedProp.description,
      required: isFieldRequired,
      examples: Array.isArray(resolvedProp.examples) ? resolvedProp.examples : undefined,
      editor,
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
  const selectedActionBase =
    step.type === 'action.call'
      ? getActionFromRegistry(
          typeof config?.actionId === 'string' ? config.actionId : undefined,
          typeof config?.version === 'number' ? config.version : undefined,
          actionRegistry
        )
      : undefined;
  const selectedAction = selectedActionBase
    ? applyWorkflowActionPresentationHints(selectedActionBase)
    : undefined;
  const actionInputFields = selectedAction?.inputSchema
    ? extractActionInputFields(selectedAction.inputSchema, selectedAction.inputSchema)
    : [];
  const inputMapping = (asRecord(config?.inputMapping) as InputMapping | undefined) ?? {};
  const {
    requiredFields: requiredActionInputFields,
    mappedRequiredFieldCount,
  } = flattenRequiredActionInputFields(actionInputFields, inputMapping);
  const mappedInputFieldCount = Object.keys(inputMapping).length;

  return {
    selectedAction,
    actionInputFields,
    requiredActionInputFields,
    inputMapping,
    mappedInputFieldCount,
    mappedRequiredInputFieldCount: mappedRequiredFieldCount,
    unmappedRequiredInputFieldCount: requiredActionInputFields.length - mappedRequiredFieldCount,
  };
};
