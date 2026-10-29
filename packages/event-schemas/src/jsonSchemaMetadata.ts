import { z, type ZodSchema, type ZodTypeAny } from 'zod';

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

const JSON_SCHEMA_DRAFT_07 = 'http://json-schema.org/draft-07/schema#';

type JsonSchemaNode = Record<string, unknown>;

export type JsonSchemaDocumentOptions = {
  /**
   * Emit the schema the way zod-to-json-schema's `name` option did: the body lives under
   * `definitions[name]` and the root is a `$ref` to it. The designer's ref resolver and the
   * schema registry both key on that layout.
   */
  name?: string;
};

const isPlainObject = (value: unknown): value is JsonSchemaNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const PRIMITIVE_JSON_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null']);

const literalMemberType = (member: JsonSchemaNode): string | null => {
  const keys = Object.keys(member).filter((key) => key !== 'description');
  const hasConst = keys.includes('const');
  const hasEnum = keys.includes('enum') && Array.isArray(member.enum);
  if (!hasConst && !hasEnum) return null;
  if (keys.some((key) => key !== 'type' && key !== 'const' && key !== 'enum')) return null;
  const type = typeof member.type === 'string' ? member.type : null;
  if (type && !PRIMITIVE_JSON_TYPES.has(type)) return null;
  if (hasConst) {
    const value = member.const;
    const inferred = value === null ? 'null' : typeof value;
    if (!PRIMITIVE_JSON_TYPES.has(inferred)) return null;
    return type ?? inferred;
  }
  if (type !== 'string') return null;
  return type;
};

/**
 * zod-to-json-schema emitted a union of literals (or of enums) as one `enum`, which is what the
 * designer keys its option pickers on. Zod 4 emits `anyOf` members with `const`; fold them back.
 */
const compactLiteralUnion = (node: JsonSchemaNode): JsonSchemaNode => {
  const members = node.anyOf;
  if (!Array.isArray(members) || members.length === 0 || !members.every(isPlainObject)) return node;
  const types = members.map((member) => literalMemberType(member as JsonSchemaNode));
  if (types.some((type) => type === null)) return node;
  const values = (members as JsonSchemaNode[]).flatMap((member) =>
    Array.isArray(member.enum) ? (member.enum as unknown[]) : [member.const]
  );
  const uniqueTypes = [...new Set(types as string[])];
  const { anyOf: _anyOf, ...rest } = node;
  return { ...rest, type: uniqueTypes.length > 1 ? uniqueTypes : uniqueTypes[0], enum: values };
};

const isNullMember = (member: unknown): boolean =>
  isPlainObject(member) && Object.keys(member).length === 1 && member.type === 'null';

/**
 * zod-to-json-schema copied a nullable field's description (and so its workflow metadata) onto
 * the `anyOf` wrapper; Zod 4 leaves it on the inner member. The designer reads the wrapper.
 */
const hoistNullableMetadata = (node: JsonSchemaNode): JsonSchemaNode => {
  const members = node.anyOf;
  if (!Array.isArray(members) || members.length !== 2) return node;
  const inner = members.find((member) => !isNullMember(member));
  if (!isPlainObject(inner) || !members.some(isNullMember)) return node;
  const hoisted: JsonSchemaNode = {};
  for (const [key, value] of Object.entries(inner)) {
    if ((key === 'description' || key.startsWith('x-')) && !(key in node)) hoisted[key] = value;
  }
  return Object.keys(hoisted).length > 0 ? { ...node, ...hoisted } : node;
};

/** Zod 4 emits exclusive unions as `oneOf`; zod-to-json-schema always used `anyOf`. */
const unifyUnionKeyword = (node: JsonSchemaNode): JsonSchemaNode => {
  if (!Array.isArray(node.oneOf) || 'anyOf' in node) return node;
  const { oneOf, ...rest } = node;
  return { ...rest, anyOf: oneOf };
};

/**
 * In the input view Zod 4 leaves plain objects open; zod-to-json-schema closed them with
 * `additionalProperties: false`, which the Run dialog's payload validation relies on.
 */
const closePlainObject = (node: JsonSchemaNode): JsonSchemaNode =>
  node.type === 'object' && isPlainObject(node.properties) && !('additionalProperties' in node)
    ? { ...node, additionalProperties: false }
    : node;

const normalizeNode = (node: JsonSchemaNode): JsonSchemaNode =>
  hoistNullableMetadata(compactLiteralUnion(unifyUnionKeyword(closePlainObject(node))));

/** The `description` carries a JSON payload for workflow metadata; spread it into the node. */
const applyJsonDescription = (node: JsonSchemaNode): JsonSchemaNode => {
  if (typeof node.description !== 'string' || !node.description.startsWith('{')) return node;
  try {
    const parsed: unknown = JSON.parse(node.description);
    return isPlainObject(parsed) ? { ...node, ...parsed } : node;
  } catch {
    return node;
  }
};

const WRAPPER_TYPES = new Set(['optional', 'nullable', 'default', 'prefault', 'nonoptional', 'readonly', 'catch']);

/** The workflow `x-` keys from the JSON descriptions of a wrapper's inner schemas. */
const innerJsonDescriptionKeys = (schema: z.ZodType): JsonSchemaNode => {
  const keys: JsonSchemaNode = {};
  let current: z.ZodType | undefined = schema;
  while (current) {
    const description = z.globalRegistry.get(current)?.description;
    if (typeof description === 'string' && description.startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(description);
        if (isPlainObject(parsed)) {
          for (const [key, value] of Object.entries(parsed)) {
            if (key.startsWith('x-') && !(key in keys)) keys[key] = value;
          }
        }
      } catch {
        // Not a metadata payload.
      }
    }
    const def = current._zod.def as { type: string; innerType?: z.ZodType };
    current = WRAPPER_TYPES.has(def.type) ? def.innerType : undefined;
  }
  return keys;
};

const walkJsonSchema = (
  value: unknown,
  visit: (node: JsonSchemaNode) => JsonSchemaNode
): unknown => {
  if (Array.isArray(value)) return value.map((item) => walkJsonSchema(item, visit));
  if (!isPlainObject(value)) return value;
  const out: JsonSchemaNode = {};
  for (const [key, child] of Object.entries(value)) {
    // `const`, `enum` and `default` hold data, not subschemas.
    out[key] = key === 'const' || key === 'enum' || key === 'default' ? child : walkJsonSchema(child, visit);
  }
  return visit(out);
};

const CYCLE_DEFINITION = /^__schema\d+$/;

const refTarget = (node: unknown): string | null =>
  isPlainObject(node) && typeof node.$ref === 'string' && node.$ref.startsWith('#/definitions/')
    ? node.$ref.slice('#/definitions/'.length)
    : null;

/**
 * zod-to-json-schema inlined a recursive schema and cut the recursion with `{}`. Zod 4 hoists
 * it into a `__schemaN` definition and points at it through `allOf`, which the designer's
 * field editor does not read. Inline one level the old way.
 */
const inlineCycleDefinitions = (document: JsonSchemaNode): JsonSchemaNode => {
  const definitions = isPlainObject(document.definitions) ? document.definitions : null;
  if (!definitions) return document;
  const cycles = Object.keys(definitions).filter((name) => CYCLE_DEFINITION.test(name));
  if (cycles.length === 0) return document;
  const cutSelfRefs = (value: unknown, name: string): unknown => {
    if (Array.isArray(value)) return value.map((item) => cutSelfRefs(item, name));
    if (!isPlainObject(value)) return value;
    if (refTarget(value) === name) return {};
    const out: JsonSchemaNode = {};
    for (const [key, child] of Object.entries(value)) out[key] = cutSelfRefs(child, name);
    const keys = Object.keys(out);
    const emptyAllOf = Array.isArray(out.allOf) && out.allOf.length === 1 && isPlainObject(out.allOf[0]) && Object.keys(out.allOf[0]).length === 0;
    return keys.length === 1 && emptyAllOf ? {} : out;
  };
  const bodies = Object.fromEntries(cycles.map((name) => [name, cutSelfRefs(definitions[name], name)]));
  const inline = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(inline);
    if (!isPlainObject(value)) return value;
    const direct = refTarget(value);
    if (direct && direct in bodies) {
      const { $ref: _ref, ...rest } = value;
      return { ...(bodies[direct] as JsonSchemaNode), ...rest };
    }
    const only = Array.isArray(value.allOf) && value.allOf.length === 1 ? refTarget(value.allOf[0]) : null;
    if (only && only in bodies) {
      const { allOf: _allOf, ...rest } = value;
      return { ...(bodies[only] as JsonSchemaNode), ...rest };
    }
    const out: JsonSchemaNode = {};
    for (const [key, child] of Object.entries(value)) out[key] = inline(child);
    return out;
  };
  const remaining = Object.fromEntries(Object.entries(definitions).filter(([name]) => !(name in bodies)));
  const { definitions: _definitions, ...rest } = document;
  const inlined = inline(rest) as JsonSchemaNode;
  return Object.keys(remaining).length > 0
    ? { ...inlined, definitions: inline(remaining) as JsonSchemaNode }
    : inlined;
};

const convert = (
  schema: ZodSchema<unknown>,
  options: JsonSchemaDocumentOptions,
  visit: (node: JsonSchemaNode) => JsonSchemaNode
): JsonSchemaNode => {
  const generated = z.toJSONSchema(schema as z.ZodType, {
    target: 'draft-7',
    // The input view: defaulted fields stay optional and transforms show their input shape,
    // which is what zod-to-json-schema produced and what the designer's forms are built from.
    io: 'input',
    unrepresentable: 'any',
    cycles: 'ref',
    // Inline subschemas instead of emitting `$ref`s. The designer's field editor
    // does not resolve `$ref`, so a schema reused across fields (e.g. links.upsert's
    // `left`/`right` both using entityRefSchema) would otherwise render the second
    // occurrence as an unresolved ref (shown as a bare "string").
    reused: 'inline',
    override: ({ zodSchema, jsonSchema }) => {
      const def = zodSchema._zod.def as {
        type: string;
        innerType?: z.ZodType;
        defaultValue?: unknown;
        shape?: Record<string, z.ZodType>;
      };
      // zod-to-json-schema required a key unless its schema accepted undefined, so z.unknown()
      // and z.any() fields were optional. Zod 4 lists them as required; keep the old rule.
      if (def.type === 'object' && def.shape) {
        const required = Object.entries(def.shape)
          .filter(([, field]) => !field.safeParse(undefined).success)
          .map(([key]) => key);
        if (required.length > 0) jsonSchema.required = required;
        else delete jsonSchema.required;
      }
      // zod-to-json-schema represented dates as date-time strings; Zod 4 has no mapping.
      if (def.type === 'date') {
        jsonSchema.type = 'string';
        jsonSchema.format = 'date-time';
      }
      // A wrapper's own description replaces the inner one in Zod 4, which would drop the
      // workflow metadata carried in the inner JSON description. Keep those keys.
      if (WRAPPER_TYPES.has(def.type) && def.innerType) {
        for (const [key, value] of Object.entries(innerJsonDescriptionKeys(def.innerType))) {
          if (!(key in jsonSchema)) (jsonSchema as JsonSchemaNode)[key] = value;
        }
      }
      // The input view drops `default` under a transform; the designer still prefills from it.
      if (def.type === 'default' && !('default' in jsonSchema)) {
        jsonSchema.default = typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue;
      }
    },
  }) as JsonSchemaNode;
  const { $schema: _draft, definitions: generatedDefinitions, ...body } = inlineCycleDefinitions(
    walkJsonSchema(generated, visit) as JsonSchemaNode
  );
  const definitions = isPlainObject(generatedDefinitions) ? generatedDefinitions : undefined;
  if (options.name) {
    return {
      $ref: `#/definitions/${options.name}`,
      definitions: { ...(definitions ?? {}), [options.name]: body },
      $schema: JSON_SCHEMA_DRAFT_07,
    };
  }
  return { ...body, ...(definitions ? { definitions } : {}), $schema: JSON_SCHEMA_DRAFT_07 };
};

/** Draft-07 JSON Schema in the layout zod-to-json-schema produced, without workflow metadata. */
export const zodToJsonSchemaDocument = (
  schema: ZodSchema<unknown>,
  options: string | JsonSchemaDocumentOptions = {}
): Record<string, unknown> =>
  convert(schema, typeof options === 'string' ? { name: options } : options, normalizeNode);

/** The same document with each JSON description unpacked into the workflow `x-` keywords. */
export const zodToWorkflowJsonSchema = (
  schema: ZodSchema<unknown>,
  options: string | JsonSchemaDocumentOptions = {}
): Record<string, unknown> =>
  convert(schema, typeof options === 'string' ? { name: options } : options, (node) =>
    hoistNullableMetadata(applyJsonDescription(normalizeNode(node)))
  );
