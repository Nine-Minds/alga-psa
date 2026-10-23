import { resolveLocalJsonSchemaRef } from './jsonSchemaRefs';
import type { DataContext, JsonSchema } from './workflowDataContext';
import {
  resolveWorkflowSchemaFieldEditor,
  type WorkflowSchemaEditorAwareJsonSchema,
} from './workflowSchemaFieldEditor';

export type WorkflowConditionFieldType = 'string' | 'number' | 'boolean' | 'unknown';

/** A scalar field a condition can test, with what the builder needs to offer a fitting value editor. */
export type WorkflowConditionField = {
  /** Expression path, e.g. `vars.ticketLookup.ticket.priority_id`. */
  path: string;
  /** Where the field comes from: the trigger or a step name. */
  sourceLabel: string;
  /** Path relative to the source, e.g. `ticket.priority_id`. */
  fieldLabel: string;
  description?: string;
  type: WorkflowConditionFieldType;
  enumValues?: Array<string | number | boolean>;
  /** Entity kind from schema metadata; the value editor offers that entity's picker. */
  pickerKind?: string;
  pickerFixedValueHint?: string;
};

type SchemaWithMetadata = JsonSchema & WorkflowSchemaEditorAwareJsonSchema & { format?: string };

const MAX_DEPTH = 6;

const isNullSchema = (schema: JsonSchema): boolean =>
  schema.type === 'null' || (Array.isArray(schema.type) && schema.type.length === 1 && schema.type[0] === 'null');

const METADATA_KEYS = [
  'description',
  'x-workflow-picker-kind',
  'x-workflow-picker-dependencies',
  'x-workflow-picker-fixed-value-hint',
  'x-workflow-picker-allow-dynamic-reference',
  'x-workflow-editor',
] as const;

const resolveSchema = (schema: JsonSchema, root: JsonSchema, seenRefs = new Set<string>()): SchemaWithMetadata => {
  let current = schema as SchemaWithMetadata;

  if (current.$ref && !seenRefs.has(current.$ref)) {
    seenRefs.add(current.$ref);
    const resolved = resolveLocalJsonSchemaRef<JsonSchema>(current.$ref, root);
    if (resolved) {
      current = { ...resolveSchema(resolved, root, seenRefs), ...pickMetadata(current) };
    }
  }

  const variants = current.anyOf ?? current.oneOf;
  if (variants?.length) {
    const concrete = variants.find((variant) => !isNullSchema(variant));
    if (concrete) {
      return { ...resolveSchema(concrete, root, seenRefs), ...pickMetadata(current) };
    }
  }

  return current;
};

function pickMetadata(schema: SchemaWithMetadata): Partial<SchemaWithMetadata> {
  const metadata: Record<string, unknown> = {};
  for (const key of METADATA_KEYS) {
    if (schema[key] !== undefined) metadata[key] = schema[key];
  }
  return metadata as Partial<SchemaWithMetadata>;
}

const normalizeType = (schema: JsonSchema): string | undefined => {
  if (Array.isArray(schema.type)) return schema.type.find((type) => type !== 'null') ?? schema.type[0];
  return schema.type;
};

const toFieldType = (schema: JsonSchema): WorkflowConditionFieldType | null => {
  const type = normalizeType(schema);
  if (type === 'string') return 'string';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  if (!type && schema.enum?.length) return 'unknown';
  return null;
};

const collectFields = (
  schema: JsonSchema,
  root: JsonSchema,
  pathPrefix: string,
  labelPrefix: string,
  sourceLabel: string,
  depth: number,
  into: WorkflowConditionField[]
): void => {
  if (depth > MAX_DEPTH) return;
  const resolved = resolveSchema(schema, root);
  const properties = resolved.properties ?? {};

  for (const [key, rawChild] of Object.entries(properties)) {
    const child = resolveSchema(rawChild, root);
    const path = `${pathPrefix}.${key}`;
    const fieldLabel = labelPrefix ? `${labelPrefix}.${key}` : key;

    if (normalizeType(child) === 'object' && child.properties) {
      collectFields(child, root, path, fieldLabel, sourceLabel, depth + 1, into);
      continue;
    }

    const type = toFieldType(child);
    if (!type) continue;

    const editor = resolveWorkflowSchemaFieldEditor(child);
    const pickerKind = editor?.kind === 'picker' ? editor.picker?.resource : undefined;
    const enumValues = Array.isArray(child.enum)
      ? child.enum.filter((item): item is string | number | boolean =>
          typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
      : undefined;

    into.push({
      path,
      sourceLabel,
      fieldLabel,
      description: typeof child.description === 'string' && child.description.trim() ? child.description.trim() : undefined,
      type,
      enumValues: enumValues?.length ? enumValues : undefined,
      pickerKind,
      pickerFixedValueHint: pickerKind ? editor?.fixedValueHint : undefined,
    });
  }
};

/**
 * Lists the scalar fields a condition at this point of the workflow can test: trigger payload
 * fields first, then the saved output of each earlier step, in workflow order.
 */
export const collectWorkflowConditionFields = (
  payloadSchema: JsonSchema | null,
  dataContext: DataContext | null,
  labels: { trigger: string }
): WorkflowConditionField[] => {
  const fields: WorkflowConditionField[] = [];

  if (payloadSchema) {
    collectFields(payloadSchema, payloadSchema, 'payload', '', labels.trigger, 0, fields);
  }

  for (const stepOutput of dataContext?.steps ?? []) {
    if (!stepOutput.saveAs) continue;
    collectFields(
      stepOutput.outputSchema,
      stepOutput.outputSchema,
      `vars.${stepOutput.saveAs}`,
      '',
      stepOutput.stepName || stepOutput.saveAs,
      0,
      fields
    );
  }

  const seen = new Set<string>();
  return fields.filter((field) => {
    if (seen.has(field.path)) return false;
    seen.add(field.path);
    return true;
  });
};
