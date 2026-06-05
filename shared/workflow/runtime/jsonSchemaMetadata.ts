import type { ZodSchema, ZodTypeAny } from 'zod';
import {
  jsonDescription,
  zodToJsonSchema,
  type Options,
  type PostProcessCallback,
} from 'zod-to-json-schema';

export type WorkflowPickerJsonSchemaMetadata = {
  'x-workflow-picker-kind'?: string;
  'x-workflow-picker-dependencies'?: string[];
  'x-workflow-picker-fixed-value-hint'?: string;
  'x-workflow-picker-allow-dynamic-reference'?: boolean;
};

export type WorkflowEditorKind = 'text' | 'picker' | 'color' | 'json' | 'custom';
export type WorkflowEditorInlineMode = 'input' | 'textarea' | 'picker-summary' | 'swatch';
export type WorkflowEditorDialogMode = 'large-text';

export type WorkflowEditorSoftEnumMetadata = {
  component: 'soft-enum-combobox';
  suggestionKind: 'workflow-data-store-namespace' | 'workflow-entity-type' | 'workflow-link-relation';
  suggestionActionIds?: string[];
  namespaceField?: string;
  curatedValues?: string[];
  allowCustomValue?: boolean;
};

export type WorkflowEditorJsonSchemaMetadata = {
  kind: WorkflowEditorKind;
  inline?: {
    mode: WorkflowEditorInlineMode;
  };
  dialog?: {
    mode: WorkflowEditorDialogMode;
  };
  dependencies?: string[];
  allowsDynamicReference?: boolean;
  fixedValueHint?: string;
  picker?: {
    resource: string;
  };
  softEnum?: WorkflowEditorSoftEnumMetadata;
};

export type WorkflowJsonSchemaMetadata = WorkflowPickerJsonSchemaMetadata & {
  'x-workflow-editor'?: WorkflowEditorJsonSchemaMetadata;
};

type WorkflowJsonSchemaDescriptionPayload = WorkflowJsonSchemaMetadata & {
  description?: string;
};

const hasWorkflowJsonSchemaMetadata = (metadata: WorkflowJsonSchemaDescriptionPayload): boolean =>
  Object.values(metadata).some((value) => value !== undefined);

export const buildWorkflowJsonDescription = (
  description: string | undefined,
  metadata: WorkflowJsonSchemaMetadata = {}
): string => {
  const payload: WorkflowJsonSchemaDescriptionPayload = {
    description,
    ...metadata,
  };

  if (!hasWorkflowJsonSchemaMetadata(payload)) {
    return description ?? '';
  }

  return JSON.stringify(payload);
};

export const withWorkflowJsonSchemaMetadata = <T extends ZodTypeAny>(
  schema: T,
  description: string,
  metadata: WorkflowJsonSchemaMetadata = {}
): T => schema.describe(buildWorkflowJsonDescription(description, metadata)) as T;

export const buildWorkflowJsonSchemaPostProcess = (
  next?: PostProcessCallback
): PostProcessCallback => {
  return (jsonSchema, def, refs) => {
    const described = jsonDescription(jsonSchema, def, refs);
    return next ? next(described, def, refs) : described;
  };
};

export const zodToWorkflowJsonSchema = (
  schema: ZodSchema<unknown>,
  options?: string | Partial<Options>
): Record<string, unknown> => {
  // Inline subschemas instead of emitting `$ref`s. The designer's field editor
  // does not resolve `$ref`, so a schema reused across fields (e.g. links.upsert's
  // `left`/`right` both using entityRefSchema) would otherwise render the second
  // occurrence as an unresolved ref (shown as a bare "string").
  if (typeof options === 'string') {
    return zodToJsonSchema(schema, {
      name: options,
      $refStrategy: 'none',
      postProcess: buildWorkflowJsonSchemaPostProcess(),
    }) as Record<string, unknown>;
  }

  const nextPostProcess = options?.postProcess;
  return zodToJsonSchema(schema, {
    $refStrategy: 'none',
    ...options,
    postProcess: buildWorkflowJsonSchemaPostProcess(nextPostProcess),
  }) as Record<string, unknown>;
};
