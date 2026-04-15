import type { WorkflowEditorJsonSchemaMetadata } from '@alga-psa/shared/workflow/runtime';

export type WorkflowSchemaEditorAwareJsonSchema = {
  'x-workflow-picker-kind'?: string;
  'x-workflow-picker-dependencies'?: string[];
  'x-workflow-picker-fixed-value-hint'?: string;
  'x-workflow-picker-allow-dynamic-reference'?: boolean;
  'x-workflow-editor'?: WorkflowEditorJsonSchemaMetadata;
};

export type ResolvedWorkflowSchemaEditor = {
  kind: 'text' | 'picker' | 'color' | 'json' | 'custom';
  inline?: {
    mode: 'input' | 'textarea' | 'picker-summary' | 'swatch';
  };
  dialog?: {
    mode: 'large-text';
  };
  dependencies?: string[];
  fixedValueHint?: string;
  allowsDynamicReference?: boolean;
  picker?: {
    resource: string;
  };
};

const WORKFLOW_EDITOR_KINDS = new Set<WorkflowEditorJsonSchemaMetadata['kind']>([
  'text',
  'picker',
  'color',
  'json',
  'custom',
]);

const WORKFLOW_INLINE_MODES = new Set<NonNullable<WorkflowEditorJsonSchemaMetadata['inline']>['mode']>([
  'input',
  'textarea',
  'picker-summary',
  'swatch',
]);

const WORKFLOW_DIALOG_MODES = new Set<NonNullable<WorkflowEditorJsonSchemaMetadata['dialog']>['mode']>([
  'large-text',
]);

const normalizeWorkflowEditorMetadata = (
  metadata: WorkflowEditorJsonSchemaMetadata | undefined
): ResolvedWorkflowSchemaEditor | undefined => {
  if (!metadata || !WORKFLOW_EDITOR_KINDS.has(metadata.kind)) {
    return undefined;
  }

  const inline =
    metadata.inline && WORKFLOW_INLINE_MODES.has(metadata.inline.mode)
      ? { mode: metadata.inline.mode }
      : undefined;
  const dialog =
    metadata.dialog && WORKFLOW_DIALOG_MODES.has(metadata.dialog.mode)
      ? { mode: metadata.dialog.mode }
      : undefined;
  const pickerResource = metadata.picker?.resource;

  return {
    kind: metadata.kind,
    inline,
    dialog,
    dependencies: Array.isArray(metadata.dependencies) ? metadata.dependencies : undefined,
    allowsDynamicReference:
      typeof metadata.allowsDynamicReference === 'boolean'
        ? metadata.allowsDynamicReference
        : undefined,
    fixedValueHint:
      typeof metadata.fixedValueHint === 'string' ? metadata.fixedValueHint : undefined,
    picker:
      metadata.kind === 'picker' && typeof pickerResource === 'string' && pickerResource.trim().length > 0
        ? {
            resource: pickerResource,
          }
        : undefined,
  };
};

const normalizeLegacyPickerEditorMetadata = (
  schema: WorkflowSchemaEditorAwareJsonSchema
): ResolvedWorkflowSchemaEditor | undefined => {
  if (typeof schema['x-workflow-picker-kind'] !== 'string') {
    return undefined;
  }

  return {
    kind: 'picker',
    inline: { mode: 'picker-summary' },
    dependencies: Array.isArray(schema['x-workflow-picker-dependencies'])
      ? schema['x-workflow-picker-dependencies']
      : undefined,
    fixedValueHint:
      typeof schema['x-workflow-picker-fixed-value-hint'] === 'string'
        ? schema['x-workflow-picker-fixed-value-hint']
        : undefined,
    allowsDynamicReference:
      typeof schema['x-workflow-picker-allow-dynamic-reference'] === 'boolean'
        ? schema['x-workflow-picker-allow-dynamic-reference']
        : undefined,
    picker: {
      resource: schema['x-workflow-picker-kind'],
    },
  };
};

export const resolveWorkflowSchemaFieldEditor = (
  schema: WorkflowSchemaEditorAwareJsonSchema
): ResolvedWorkflowSchemaEditor | undefined => {
  return normalizeWorkflowEditorMetadata(schema['x-workflow-editor'])
    ?? normalizeLegacyPickerEditorMetadata(schema);
};
