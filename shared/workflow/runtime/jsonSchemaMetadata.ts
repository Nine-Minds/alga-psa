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
  if (typeof options === 'string') {
    return zodToJsonSchema(schema, {
      name: options,
      postProcess: buildWorkflowJsonSchemaPostProcess(),
    }) as Record<string, unknown>;
  }

  const nextPostProcess = options?.postProcess;
  return zodToJsonSchema(schema, {
    ...options,
    postProcess: buildWorkflowJsonSchemaPostProcess(nextPostProcess),
  }) as Record<string, unknown>;
};
