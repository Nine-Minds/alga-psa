import type { ExpressionMode } from './modes';
import type {
  SharedExpressionContextRoot,
  SharedExpressionPathOption,
  SharedExpressionSchemaNode,
  SharedExpressionValueType,
} from './context';

const ARRAY_SEGMENT = '[]';

const normalizeSchemaType = (schema: SharedExpressionSchemaNode | undefined): SharedExpressionValueType => {
  if (!schema?.type) return 'unknown';
  const rawType = Array.isArray(schema.type)
    ? schema.type.find((entry) => entry !== 'null') ?? schema.type[0]
    : schema.type;
  if (
    rawType === 'string' ||
    rawType === 'number' ||
    rawType === 'integer' ||
    rawType === 'boolean' ||
    rawType === 'object' ||
    rawType === 'array' ||
    rawType === 'null'
  ) {
    return rawType;
  }
  return 'unknown';
};

const resolveSchema = (
  schema: SharedExpressionSchemaNode | undefined,
  rootSchema?: SharedExpressionSchemaNode
): SharedExpressionSchemaNode | undefined => {
  if (!schema) return undefined;

  if (schema.$ref && rootSchema?.definitions) {
    const refKey = schema.$ref.replace('#/definitions/', '');
    const referenced = rootSchema.definitions[refKey];
    if (referenced) {
      return resolveSchema(referenced, rootSchema);
    }
  }

  if (schema.anyOf?.length) {
    const nonNull = schema.anyOf.find((variant) => normalizeSchemaType(variant) !== 'null');
    if (nonNull) {
      return resolveSchema(nonNull, rootSchema);
    }
  }

  if (schema.oneOf?.length) {
    return resolveSchema(schema.oneOf[0], rootSchema);
  }

  if (schema.allOf?.length) {
    return resolveSchema(schema.allOf[0], rootSchema);
  }

  return schema;
};

const joinPath = (root: string, segments: string[]): string =>
  segments.reduce((acc, segment) => (segment === ARRAY_SEGMENT ? `${acc}${ARRAY_SEGMENT}` : `${acc}.${segment}`), root);

const hasChildNodes = (schema: SharedExpressionSchemaNode | undefined): boolean => {
  if (!schema) return false;
  const normalized = resolveSchema(schema, schema);
  if (!normalized) return false;
  if (normalized.properties && Object.keys(normalized.properties).length > 0) return true;
  if (normalized.items) return true;
  if (normalized.additionalProperties && typeof normalized.additionalProperties === 'object') return true;
  return false;
};

const createOption = (
  root: SharedExpressionContextRoot,
  segments: string[],
  schema: SharedExpressionSchemaNode | undefined
): SharedExpressionPathOption => {
  const path = joinPath(root.key, segments);
  const resolvedSchema = resolveSchema(schema, root.schema);

  return {
    root: root.key,
    path,
    label: path,
    description: resolvedSchema?.description,
    valueType: normalizeSchemaType(resolvedSchema),
    depth: segments.length,
    isLeaf: !hasChildNodes(resolvedSchema),
    segments: [root.key, ...segments],
  };
};

const pushObjectPropertyOptions = (
  options: SharedExpressionPathOption[],
  root: SharedExpressionContextRoot,
  parentSegments: string[],
  schema: SharedExpressionSchemaNode,
  rootSchema: SharedExpressionSchemaNode
) => {
  const propertyEntries = Object.entries(schema.properties ?? {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [propertyName, propertySchema] of propertyEntries) {
    const nextSegments = [...parentSegments, propertyName];
    options.push(createOption(root, nextSegments, propertySchema));
    pushNestedOptions(options, root, nextSegments, propertySchema, rootSchema);
  }
};

const pushArrayItemOptions = (
  options: SharedExpressionPathOption[],
  root: SharedExpressionContextRoot,
  parentSegments: string[],
  schema: SharedExpressionSchemaNode,
  rootSchema: SharedExpressionSchemaNode
) => {
  const resolvedArray = resolveSchema(schema, rootSchema);
  const itemSchema = resolvedArray?.items ? resolveSchema(resolvedArray.items, rootSchema) : undefined;
  if (!itemSchema) return;

  const itemSegments = [...parentSegments, ARRAY_SEGMENT];
  options.push(createOption(root, itemSegments, itemSchema));
  pushNestedOptions(options, root, itemSegments, itemSchema, rootSchema);
};

const pushNestedOptions = (
  options: SharedExpressionPathOption[],
  root: SharedExpressionContextRoot,
  currentSegments: string[],
  schema: SharedExpressionSchemaNode,
  rootSchema: SharedExpressionSchemaNode
) => {
  const resolved = resolveSchema(schema, rootSchema);
  if (!resolved) return;

  const type = normalizeSchemaType(resolved);
  if (type === 'object') {
    pushObjectPropertyOptions(options, root, currentSegments, resolved, rootSchema);
    if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
      const mapSegments = [...currentSegments, '*'];
      options.push(createOption(root, mapSegments, resolved.additionalProperties));
      pushNestedOptions(options, root, mapSegments, resolved.additionalProperties, rootSchema);
    }
    return;
  }

  if (type === 'array') {
    pushArrayItemOptions(options, root, currentSegments, resolved, rootSchema);
  }
};

export type BuildPathOptionsParams = {
  mode?: ExpressionMode;
  includeRootPaths?: boolean;
};

export const buildPathOptionsFromContextRoots = (
  roots: SharedExpressionContextRoot[],
  params: BuildPathOptionsParams = {}
): SharedExpressionPathOption[] => {
  const includeRootPaths = params.includeRootPaths ?? true;

  const options: SharedExpressionPathOption[] = [];
  const sortedRoots = [...roots].sort((a, b) => a.key.localeCompare(b.key));

  for (const root of sortedRoots) {
    if (params.mode && root.allowInModes && !root.allowInModes.includes(params.mode)) {
      continue;
    }

    if (includeRootPaths) {
      options.push(createOption(root, [], root.schema));
    }

    if (!root.schema) continue;
    pushNestedOptions(options, root, [], root.schema, root.schema);
  }

  return options;
};
