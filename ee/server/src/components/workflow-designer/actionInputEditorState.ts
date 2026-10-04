import type {
  InputMapping,
  MappingValue,
  Step,
} from '@alga-psa/workflows/runtime';

import type { ActionInputField } from './mapping';
import { flattenRequiredActionInputFields } from './mapping/mappingValueState';
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
  'x-workflow-option-labels'?: Record<string, string>;
  'x-workflow-failure-policy'?: import('@alga-psa/shared/workflow/runtime').WorkflowFailurePolicyMetadata;
  'x-workflow-explicit-choice'?: import('@alga-psa/shared/workflow/runtime').WorkflowExplicitChoiceMetadata;
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
  'x-workflow-option-labels': resolved['x-workflow-option-labels'] ?? wrapper['x-workflow-option-labels'],
  'x-workflow-failure-policy': resolved['x-workflow-failure-policy'] ?? wrapper['x-workflow-failure-policy'],
  'x-workflow-explicit-choice': resolved['x-workflow-explicit-choice'] ?? wrapper['x-workflow-explicit-choice'],
});

const readExplicitChoice = (value: unknown): { prompt: string } | undefined => {
  const prompt = asRecord(value)?.prompt;
  return typeof prompt === 'string' && prompt ? { prompt } : undefined;
};

const readOptionLabels = (value: unknown): Record<string, string> | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const labels = Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
  );
  return Object.keys(labels).length > 0 ? labels : undefined;
};

const readFailurePolicy = (value: unknown): { failValue: string } | undefined => {
  const failValue = asRecord(value)?.failValue;
  return typeof failValue === 'string' && failValue ? { failValue } : undefined;
};

/** Plain-language label for a choice input's option, falling back to the raw value. */
export const getActionInputOptionLabel = (
  field: { optionLabels?: Record<string, string> },
  value: unknown
): string => field.optionLabels?.[String(value ?? '')] ?? String(value ?? '');

/**
 * "When nothing is found" inputs (marked with a failure policy) still on a non-failing value. Inside
 * a Try, the designer offers to switch them to the failing value so the Catch branch handles a miss.
 */
export const findNonFailingNotFoundInputs = (
  fields: Array<{ name: string; default?: unknown; failurePolicy?: { failValue: string } }>,
  inputMapping: InputMapping
): Array<{ name: string; failValue: string; currentValue: unknown }> =>
  fields.flatMap((field) => {
    if (!field.failurePolicy) return [];
    const mapped = inputMapping[field.name];
    // A computed value is the author's choice; only fixed or default values are flagged.
    if (mapped !== undefined && mapped !== null && typeof mapped === 'object') return [];
    const currentValue = mapped ?? field.default;
    if (currentValue === field.failurePolicy.failValue) return [];
    return [{ name: field.name, failValue: field.failurePolicy.failValue, currentValue }];
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

    // A choice the author must make: shown as required, nothing prefilled from the schema default.
    const explicitChoice = readExplicitChoice(
      resolvedProp['x-workflow-explicit-choice'] ?? (propSchema as JsonSchema)['x-workflow-explicit-choice']
    );

    return {
      name,
      type,
      nullable: Array.isArray(resolvedProp.type)
        ? resolvedProp.type.includes('null')
        : resolvedProp.type === 'null',
      description: resolvedProp.description,
      required: isFieldRequired || Boolean(explicitChoice),
      explicitChoice,
      examples: Array.isArray(resolvedProp.examples) ? resolvedProp.examples : undefined,
      editor,
      enum: resolvedProp.enum,
      // Plain-language option labels and the "fail when nothing is found" marker (schema metadata).
      optionLabels: readOptionLabels(resolvedProp['x-workflow-option-labels'] ?? (propSchema as JsonSchema)['x-workflow-option-labels']),
      failurePolicy: readFailurePolicy(resolvedProp['x-workflow-failure-policy'] ?? (propSchema as JsonSchema)['x-workflow-failure-policy']),
      default: explicitChoice ? undefined : resolvedProp.default,
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
