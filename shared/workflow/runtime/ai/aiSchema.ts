export type WorkflowAiSchemaMode = 'simple' | 'advanced';

export type WorkflowJsonSchema = {
  [key: string]: unknown;
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, WorkflowJsonSchema>;
  required?: string[];
  enum?: Array<string | number | boolean | null>;
  const?: string | number | boolean | null;
  items?: WorkflowJsonSchema | WorkflowJsonSchema[];
  additionalProperties?: boolean | WorkflowJsonSchema;
  anyOf?: WorkflowJsonSchema[];
  oneOf?: WorkflowJsonSchema[];
  allOf?: WorkflowJsonSchema[];
  default?: unknown;
  $ref?: string;
  definitions?: Record<string, WorkflowJsonSchema>;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  examples?: unknown[];
};

export type WorkflowAiSimplePrimitiveType = 'string' | 'number' | 'integer' | 'boolean';
export type WorkflowAiSimpleFieldType = WorkflowAiSimplePrimitiveType | 'object' | 'array';
export type WorkflowAiSimpleArrayItemType = WorkflowAiSimplePrimitiveType | 'object';

export type WorkflowAiSimpleField = {
  id: string;
  name: string;
  type: WorkflowAiSimpleFieldType;
  description?: string;
  required?: boolean;
  children?: WorkflowAiSimpleField[];
  arrayItemType?: WorkflowAiSimpleArrayItemType;
};

export type WorkflowAiSchemaParseResult = {
  mode: WorkflowAiSchemaMode | null;
  schema: WorkflowJsonSchema | null;
  schemaText?: string;
  errors: string[];
};

type HydratedSimpleFieldsResult =
  | { ok: true; fields: WorkflowAiSimpleField[] }
  | { ok: false; reason: string };

const ALLOWED_JSON_SCHEMA_TYPES = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);

const SIMPLE_FIELD_FORBIDDEN_KEYS = new Set([
  'enum',
  'const',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'examples',
  'default',
  'title',
]);

const SIMPLE_PRIMITIVE_TYPES = new Set<WorkflowAiSimplePrimitiveType>([
  'string',
  'number',
  'integer',
  'boolean',
]);

const trimString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cloneSchema = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const getHydrationError = (hydrated: HydratedSimpleFieldsResult): string =>
  'reason' in hydrated ? hydrated.reason : 'Simple mode could not hydrate the schema.';

const normalizeMode = (value: unknown): WorkflowAiSchemaMode | null =>
  value === 'simple' || value === 'advanced' ? value : null;

const normalizeSchemaType = (schema: WorkflowJsonSchema | null | undefined): string | null => {
  if (!schema?.type) return null;
  if (Array.isArray(schema.type)) {
    const nonNullTypes = schema.type.filter((type) => type !== 'null');
    if (nonNullTypes.length !== 1) return null;
    return typeof nonNullTypes[0] === 'string' ? nonNullTypes[0] : null;
  }
  return typeof schema.type === 'string' ? schema.type : null;
};

const isNullableSchema = (schema: WorkflowJsonSchema | null | undefined): boolean =>
  Array.isArray(schema?.type) && schema.type.includes('null');

const validateSchemaType = (schema: WorkflowJsonSchema, path: string, errors: string[]) => {
  if (schema.type === undefined) return;
  if (Array.isArray(schema.type)) {
    if (schema.type.length === 0) {
      errors.push(`${path} must declare at least one JSON Schema type.`);
      return;
    }

    const uniqueTypes = Array.from(new Set(schema.type));
    if (uniqueTypes.some((type) => typeof type !== 'string' || !ALLOWED_JSON_SCHEMA_TYPES.has(type))) {
      errors.push(`${path} uses an unsupported JSON Schema type.`);
      return;
    }

    const nonNullTypes = uniqueTypes.filter((type) => type !== 'null');
    if (nonNullTypes.length > 1) {
      errors.push(`${path} may only use a single non-null type, optionally combined with null.`);
    }
    return;
  }

  if (typeof schema.type !== 'string' || !ALLOWED_JSON_SCHEMA_TYPES.has(schema.type)) {
    errors.push(`${path} uses an unsupported JSON Schema type.`);
  }
};

const validateSchemaNode = (
  schema: WorkflowJsonSchema,
  path: string,
  errors: string[],
  options: { rootMustBeObject: boolean }
) => {
  if (!isPlainObject(schema)) {
    errors.push(`${path} must be a JSON object.`);
    return;
  }

  validateSchemaType(schema, path, errors);

  if (path === 'AI output schema' && options.rootMustBeObject && normalizeSchemaType(schema) !== 'object') {
    errors.push('AI output schema must use an object root in v1.');
  }

  if (schema.anyOf) errors.push(`${path} cannot use anyOf in v1.`);
  if (schema.oneOf) errors.push(`${path} cannot use oneOf in v1.`);
  if (schema.allOf) errors.push(`${path} cannot use allOf in v1.`);
  if (schema.$ref) errors.push(`${path} cannot use $ref in v1.`);
  if (schema.definitions) errors.push(`${path} cannot use definitions in v1.`);

  if (schema.required !== undefined && !Array.isArray(schema.required)) {
    errors.push(`${path}.required must be an array of strings.`);
  } else if (Array.isArray(schema.required) && schema.required.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    errors.push(`${path}.required must only contain non-empty strings.`);
  }

  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) {
      errors.push(`${path}.properties must be an object.`);
    } else {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (!isPlainObject(childSchema)) {
          errors.push(`${path}.properties.${key} must be a JSON object.`);
          continue;
        }
        validateSchemaNode(childSchema as WorkflowJsonSchema, `${path}.properties.${key}`, errors, { rootMustBeObject: false });
      }
    }
  }

  if (schema.items !== undefined) {
    if (Array.isArray(schema.items)) {
      errors.push(`${path}.items cannot use tuple array syntax in v1.`);
    } else if (!isPlainObject(schema.items)) {
      errors.push(`${path}.items must be a JSON object.`);
    } else {
      validateSchemaNode(schema.items as WorkflowJsonSchema, `${path}.items`, errors, { rootMustBeObject: false });
    }
  }

  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== 'boolean' &&
    !isPlainObject(schema.additionalProperties)
  ) {
    errors.push(`${path}.additionalProperties must be a boolean or JSON object.`);
  } else if (isPlainObject(schema.additionalProperties)) {
    validateSchemaNode(
      schema.additionalProperties as WorkflowJsonSchema,
      `${path}.additionalProperties`,
      errors,
      { rootMustBeObject: false }
    );
  }

  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    errors.push(`${path}.enum must be an array.`);
  }
  if (schema.description !== undefined && typeof schema.description !== 'string') {
    errors.push(`${path}.description must be a string.`);
  }
};

const hydrateSimpleField = (
  fieldName: string,
  schema: WorkflowJsonSchema,
  requiredNames: Set<string>,
  idPrefix: string
): HydratedSimpleFieldsResult & { field?: WorkflowAiSimpleField } => {
  for (const key of SIMPLE_FIELD_FORBIDDEN_KEYS) {
    if (schema[key] !== undefined) {
      return { ok: false, reason: `Simple mode does not support "${key}" on ${fieldName}.` };
    }
  }

  if (schema.anyOf || schema.oneOf || schema.allOf || schema.$ref || schema.definitions) {
    return { ok: false, reason: `Simple mode does not support advanced JSON Schema composition on ${fieldName}.` };
  }

  if (isNullableSchema(schema)) {
    return { ok: false, reason: `Simple mode does not support nullable fields on ${fieldName}.` };
  }

  const type = normalizeSchemaType(schema);
  if (!type) {
    return { ok: false, reason: `Simple mode requires an explicit field type for ${fieldName}.` };
  }

  const field: WorkflowAiSimpleField = {
    id: `${idPrefix}.${fieldName}`,
    name: fieldName,
    type: type as WorkflowAiSimpleFieldType,
    description: trimString(schema.description),
    required: requiredNames.has(fieldName),
  };

  if (SIMPLE_PRIMITIVE_TYPES.has(type as WorkflowAiSimplePrimitiveType)) {
    return { ok: true, fields: [], field };
  }

  if (type === 'object') {
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
      return { ok: false, reason: `Simple mode does not support map-style object fields on ${fieldName}.` };
    }

    const properties = schema.properties ?? {};
    if (!isPlainObject(properties)) {
      return { ok: false, reason: `Simple mode requires object properties for ${fieldName}.` };
    }

    const childRequiredNames = new Set(Array.isArray(schema.required) ? schema.required : []);
    const children: WorkflowAiSimpleField[] = [];
    for (const [childName, childSchema] of Object.entries(properties)) {
      if (!isPlainObject(childSchema)) {
        return { ok: false, reason: `Simple mode requires ${fieldName}.${childName} to be a JSON object.` };
      }
      const childResult = hydrateSimpleField(childName, childSchema as WorkflowJsonSchema, childRequiredNames, `${idPrefix}.${fieldName}`);
      if (!childResult.ok || !childResult.field) return childResult;
      children.push(childResult.field);
    }

    field.children = children;
    return { ok: true, fields: [], field };
  }

  if (type === 'array') {
    if (!schema.items || Array.isArray(schema.items) || !isPlainObject(schema.items)) {
      return { ok: false, reason: `Simple mode requires array items for ${fieldName}.` };
    }

    const itemSchema = schema.items as WorkflowJsonSchema;
    if (isNullableSchema(itemSchema)) {
      return { ok: false, reason: `Simple mode does not support nullable array items on ${fieldName}.` };
    }

    const itemType = normalizeSchemaType(itemSchema);
    if (!itemType || itemType === 'array') {
      return { ok: false, reason: `Simple mode only supports primitive or object array items on ${fieldName}.` };
    }

    if (itemType === 'object') {
      if (itemSchema.additionalProperties !== undefined && itemSchema.additionalProperties !== false) {
        return { ok: false, reason: `Simple mode does not support map-style array object items on ${fieldName}.` };
      }

      const childRequiredNames = new Set(Array.isArray(itemSchema.required) ? itemSchema.required : []);
      const children: WorkflowAiSimpleField[] = [];
      for (const [childName, childSchema] of Object.entries(itemSchema.properties ?? {})) {
        if (!isPlainObject(childSchema)) {
          return { ok: false, reason: `Simple mode requires ${fieldName} item.${childName} to be a JSON object.` };
        }
        const childResult = hydrateSimpleField(childName, childSchema as WorkflowJsonSchema, childRequiredNames, `${idPrefix}.${fieldName}.items`);
        if (!childResult.ok || !childResult.field) return childResult;
        children.push(childResult.field);
      }

      field.arrayItemType = 'object';
      field.children = children;
      return { ok: true, fields: [], field };
    }

    if (!SIMPLE_PRIMITIVE_TYPES.has(itemType as WorkflowAiSimplePrimitiveType)) {
      return { ok: false, reason: `Simple mode does not support ${itemType} array items on ${fieldName}.` };
    }

    field.arrayItemType = itemType as WorkflowAiSimpleArrayItemType;
    return { ok: true, fields: [], field };
  }

  return { ok: false, reason: `Simple mode does not support ${type} fields on ${fieldName}.` };
};

const hydrateSimpleFieldsFromSchemaInternal = (schema: WorkflowJsonSchema): HydratedSimpleFieldsResult => {
  const errors: string[] = [];
  validateSchemaNode(schema, 'AI output schema', errors, { rootMustBeObject: true });
  if (errors.length > 0) {
    return { ok: false, reason: errors[0] };
  }

  const properties = schema.properties ?? {};
  if (!isPlainObject(properties)) {
    return { ok: false, reason: 'Simple mode requires object properties.' };
  }

  const requiredNames = new Set(Array.isArray(schema.required) ? schema.required : []);
  const fields: WorkflowAiSimpleField[] = [];

  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    if (!isPlainObject(fieldSchema)) {
      return { ok: false, reason: `Simple mode requires ${fieldName} to be a JSON object.` };
    }

    const fieldResult = hydrateSimpleField(fieldName, fieldSchema as WorkflowJsonSchema, requiredNames, 'root');
    if (!fieldResult.ok || !fieldResult.field) return fieldResult;
    fields.push(fieldResult.field);
  }

  return { ok: true, fields };
};

const serializeSimpleField = (field: WorkflowAiSimpleField): WorkflowJsonSchema => {
  const schema: WorkflowJsonSchema = {
    type: field.type,
  };

  const description = trimString(field.description);
  if (description) {
    schema.description = description;
  }

  if (field.type === 'object') {
    const children = Array.isArray(field.children) ? field.children : [];
    const properties: Record<string, WorkflowJsonSchema> = {};
    const required: string[] = [];

    children.forEach((child) => {
      const childName = trimString(child.name);
      if (!childName) return;
      properties[childName] = serializeSimpleField(child);
      if (child.required) required.push(childName);
    });

    schema.properties = properties;
    schema.additionalProperties = false;
    if (required.length > 0) {
      schema.required = required.sort((left, right) => left.localeCompare(right));
    }
  }

  if (field.type === 'array') {
    const itemType = field.arrayItemType ?? 'string';
    if (itemType === 'object') {
      const children = Array.isArray(field.children) ? field.children : [];
      const properties: Record<string, WorkflowJsonSchema> = {};
      const required: string[] = [];

      children.forEach((child) => {
        const childName = trimString(child.name);
        if (!childName) return;
        properties[childName] = serializeSimpleField(child);
        if (child.required) required.push(childName);
      });

      schema.items = {
        type: 'object',
        properties,
        additionalProperties: false,
        ...(required.length > 0
          ? { required: required.sort((left, right) => left.localeCompare(right)) }
          : {}),
      };
    } else {
      schema.items = { type: itemType };
    }
  }

  return schema;
};

export const createWorkflowAiSimpleField = (
  overrides?: Partial<WorkflowAiSimpleField>
): WorkflowAiSimpleField => ({
  id: overrides?.id ?? `field_${Math.random().toString(36).slice(2, 10)}`,
  name: overrides?.name ?? '',
  type: overrides?.type ?? 'string',
  description: overrides?.description,
  required: overrides?.required ?? false,
  children: overrides?.children,
  arrayItemType: overrides?.arrayItemType,
});

export const normalizeWorkflowAiSchemaMode = normalizeMode;

export const parseWorkflowAiSchemaText = (text: string): { schema: WorkflowJsonSchema | null; error?: string } => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { schema: null, error: 'AI output schema JSON is required.' };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isPlainObject(parsed)) {
      return { schema: null, error: 'AI output schema JSON must parse to an object.' };
    }
    return { schema: parsed as WorkflowJsonSchema };
  } catch (error) {
    return {
      schema: null,
      error: error instanceof Error ? error.message : 'Invalid JSON.',
    };
  }
};

export const buildWorkflowAiSimpleSchema = (fields: WorkflowAiSimpleField[]): WorkflowJsonSchema => {
  const properties: Record<string, WorkflowJsonSchema> = {};
  const required: string[] = [];

  fields.forEach((field) => {
    const fieldName = trimString(field.name);
    if (!fieldName) return;
    properties[fieldName] = serializeSimpleField(field);
    if (field.required) required.push(fieldName);
  });

  return {
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required.length > 0
      ? { required: required.sort((left, right) => left.localeCompare(right)) }
      : {}),
  };
};

export const hydrateWorkflowAiSimpleFields = (
  schema: WorkflowJsonSchema | null | undefined
): HydratedSimpleFieldsResult => {
  if (!schema) {
    return { ok: true, fields: [] };
  }

  if (!isPlainObject(schema)) {
    return { ok: false, reason: 'Simple mode requires a JSON object schema.' };
  }

  return hydrateSimpleFieldsFromSchemaInternal(schema);
};

export const validateWorkflowAiSchema = (
  schema: WorkflowJsonSchema | null | undefined,
  mode: WorkflowAiSchemaMode
): string[] => {
  if (!schema || !isPlainObject(schema)) {
    return ['AI output schema is required.'];
  }

  const errors: string[] = [];
  validateSchemaNode(schema, 'AI output schema', errors, { rootMustBeObject: true });
  if (errors.length > 0) return errors;

  if (mode === 'simple') {
    const hydrated = hydrateSimpleFieldsFromSchemaInternal(schema);
    if (!hydrated.ok) {
      const hydrationError = getHydrationError(hydrated);
      return [hydrationError];
    }
  }

  return [];
};

export const resolveWorkflowAiSchemaFromConfig = (config: unknown): WorkflowAiSchemaParseResult => {
  if (!isPlainObject(config)) {
    return {
      mode: null,
      schema: null,
      errors: [],
    };
  }

  const mode = normalizeMode(config.aiOutputSchemaMode);
  if (!mode) {
    return {
      mode: null,
      schema: null,
      errors: [],
    };
  }

  if (mode === 'advanced') {
    const schemaText = typeof config.aiOutputSchemaText === 'string'
      ? config.aiOutputSchemaText
      : JSON.stringify(config.aiOutputSchema ?? {}, null, 2);
    const parsed = parseWorkflowAiSchemaText(schemaText);
    if (!parsed.schema) {
      return {
        mode,
        schema: null,
        schemaText,
        errors: parsed.error ? [parsed.error] : ['AI output schema JSON is required.'],
      };
    }

    const validationErrors = validateWorkflowAiSchema(parsed.schema, mode);
    return {
      mode,
      schema: validationErrors.length > 0 ? null : cloneSchema(parsed.schema),
      schemaText,
      errors: validationErrors,
    };
  }

  const schema = isPlainObject(config.aiOutputSchema)
    ? cloneSchema(config.aiOutputSchema as WorkflowJsonSchema)
    : null;
  const validationErrors = validateWorkflowAiSchema(schema, mode);
  return {
    mode,
    schema: validationErrors.length > 0 ? null : schema,
    errors: validationErrors,
  };
};

export const getWorkflowAiSchemaFallbackText = (schema: WorkflowJsonSchema | null | undefined): string =>
  JSON.stringify(schema ?? { type: 'object', properties: {}, additionalProperties: false }, null, 2);

export const isWorkflowAiInferAction = (actionId: unknown): actionId is 'ai.infer' =>
  typeof actionId === 'string' && actionId === 'ai.infer';
