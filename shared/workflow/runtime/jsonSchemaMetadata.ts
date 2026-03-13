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

type WorkflowJsonSchemaMetadata = WorkflowPickerJsonSchemaMetadata & {
  description?: string;
};

const hasWorkflowJsonSchemaMetadata = (metadata: WorkflowJsonSchemaMetadata): boolean =>
  Object.values(metadata).some((value) => value !== undefined);

export const buildWorkflowJsonDescription = (
  description: string | undefined,
  metadata: WorkflowPickerJsonSchemaMetadata = {}
): string => {
  const payload: WorkflowJsonSchemaMetadata = {
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
  metadata: WorkflowPickerJsonSchemaMetadata = {}
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
