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
  /** For kind 'custom': which purpose-built editor renders the field. */
  custom?: {
    component: WorkflowEditorCustomComponent;
  };
};

export type WorkflowEditorCustomComponent = 'ticket-assignment' | 'notification-recipients' | 'email-recipients' | 'email-user-recipients';

export type WorkflowFailurePolicyMetadata = {
  /** The option value that makes the step fail (so a surrounding Try/Catch handles it). */
  failValue: string;
};

export type WorkflowJsonSchemaMetadata = WorkflowPickerJsonSchemaMetadata & {
  'x-workflow-editor'?: WorkflowEditorJsonSchemaMetadata;
  /** Plain-language labels for a choice input's options, keyed by option value. */
  'x-workflow-option-labels'?: Record<string, string>;
  /** Marks a choice input that decides whether a missing/empty result fails the step. */
  'x-workflow-failure-policy'?: WorkflowFailurePolicyMetadata;
  /**
   * The designer asks the author to pick an option instead of prefilling one. The runtime default
   * is unchanged, so workflows saved without a choice keep behaving as before.
   */
  'x-workflow-explicit-choice'?: WorkflowExplicitChoiceMetadata;
  /**
   * On an input object: its fields are each optional, but at least one of these must be set (a
   * lookup by id, email or phone). Publish validation and the designer's "required missing" count
   * enforce it, instead of the run failing on a runtime refine.
   */
  'x-workflow-require-one-of'?: string[];
};

export type WorkflowExplicitChoiceMetadata = {
  /** The question the designer asks, e.g. "Who can see this comment?". */
  prompt: string;
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

/**
 * Entity kinds that workflow schema fields can reference by id, with the search hint the
 * designer shows in the matching picker. One registry for every action and event schema, so
 * a field marked with a kind gets the same picker in action inputs, the Run dialog, event
 * filters, and If conditions, and an output field marked with a kind can be compared against
 * a picked entity instead of a raw id.
 */
export const WORKFLOW_PICKER_KIND_HINTS = {
  asset: 'Search assets',
  board: 'Search boards',
  client: 'Search clients',
  'client-location': 'Search locations',
  contact: 'Search contacts',
  contract: 'Search contracts',
  'email-sender': 'Select sender identity',
  opportunity: 'Search opportunities',
  project: 'Search projects',
  'project-phase': 'Search project phases',
  'project-task': 'Search project tasks',
  'project-task-status': 'Search project task statuses',
  role: 'Search roles',
  ticket: 'Search tickets',
  'ticket-category': 'Search categories',
  'ticket-priority': 'Search priorities',
  'ticket-status': 'Search statuses',
  'ticket-subcategory': 'Search subcategories',
  user: 'Search users',
  'user-or-team': 'Search users or teams',
} as const;

export type WorkflowPickerKind = keyof typeof WORKFLOW_PICKER_KIND_HINTS;

/**
 * Marks a schema field as holding the id of a `kind` entity. Use it on action inputs (the
 * designer renders a picker) and on action outputs and event payload fields (conditions and
 * filters on the field offer the same picker for the comparison value).
 */
export const withWorkflowPicker = <T extends ZodTypeAny>(
  schema: T,
  description: string,
  kind: WorkflowPickerKind,
  dependencies?: string[]
): T =>
  withWorkflowJsonSchemaMetadata(schema, description, {
    'x-workflow-picker-kind': kind,
    'x-workflow-picker-dependencies': dependencies,
    'x-workflow-picker-fixed-value-hint': WORKFLOW_PICKER_KIND_HINTS[kind],
    'x-workflow-picker-allow-dynamic-reference': true,
  });

/** Plain-language labels for the "when nothing is found" options find/search actions offer. */
export const WORKFLOW_NOT_FOUND_OPTION_LABELS: Record<string, string> = {
  return_null: 'Continue with an empty result',
  return_empty: 'Continue with no results',
  return_false: 'Continue and report that it was not found',
  error: 'Fail the step (a surrounding Try/Catch handles it)',
};

/**
 * Marks a "when nothing is found" choice (on_not_found, on_empty…): its options get plain-language
 * labels, and the designer can suggest the failing option inside a Try so Catch handles the miss.
 */
export const withWorkflowNotFoundPolicy = <T extends ZodTypeAny>(
  schema: T,
  description: string,
  failValue = 'error'
): T =>
  withWorkflowJsonSchemaMetadata(schema, description, {
    'x-workflow-option-labels': WORKFLOW_NOT_FOUND_OPTION_LABELS,
    'x-workflow-failure-policy': { failValue },
  });

/**
 * Marks a choice whose default is risky to take silently (a comment's visibility: "public" shows it
 * to the customer). The designer shows it as required and offers the options with their labels;
 * nothing is preselected.
 */
export const withWorkflowExplicitChoice = <T extends ZodTypeAny>(
  schema: T,
  description: string,
  prompt: string,
  optionLabels?: Record<string, string>
): T =>
  withWorkflowJsonSchemaMetadata(schema, description, {
    'x-workflow-explicit-choice': { prompt },
    'x-workflow-option-labels': optionLabels,
  });

/**
 * Marks an input object whose fields are individually optional but of which at least one must be
 * set. Pair it with the runtime `.refine` that enforces the same rule, so the designer and publish
 * validation catch the gap before a run does.
 */
export const withWorkflowRequireOneOf = <T extends ZodTypeAny>(
  schema: T,
  fields: string[],
  description?: string
): T =>
  withWorkflowJsonSchemaMetadata(schema, description ?? '', {
    'x-workflow-require-one-of': fields,
  });

/** Plain-language labels for comment visibility, shared by every action that writes a comment. */
export const WORKFLOW_COMMENT_VISIBILITY_LABELS: Record<string, string> = {
  internal: 'Internal: only your team can see it',
  public: 'Public: the customer can see it',
};

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
