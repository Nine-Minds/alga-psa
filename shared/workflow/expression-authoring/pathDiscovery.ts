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

const decodeJsonPointerSegment = (segment: string): string =>
  segment.replace(/~1/g, '/').replace(/~0/g, '~');

const resolveLocalSchemaRef = (
  ref: string | undefined,
  rootSchema: SharedExpressionSchemaNode | undefined
): SharedExpressionSchemaNode | undefined => {
  if (!ref || !rootSchema) return undefined;
  if (ref === '#') return rootSchema;
  if (!ref.startsWith('#/')) return undefined;

  const parts = ref.slice(2).split('/').map(decodeJsonPointerSegment);
  let current: unknown = rootSchema;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current && typeof current === 'object'
    ? (current as SharedExpressionSchemaNode)
    : undefined;
};

const resolveSchema = (
  schema: SharedExpressionSchemaNode | undefined,
  rootSchema?: SharedExpressionSchemaNode,
  seenRefs = new Set<string>()
): SharedExpressionSchemaNode | undefined => {
  if (!schema) return undefined;
  const root = rootSchema ?? schema;

  if (schema.$ref && !seenRefs.has(schema.$ref)) {
    seenRefs.add(schema.$ref);
    const referenced = resolveLocalSchemaRef(schema.$ref, root);
    if (referenced) {
      return resolveSchema(referenced, root, seenRefs);
    }
  }

  if (schema.anyOf?.length) {
    const nonNull = schema.anyOf.find((variant) => normalizeSchemaType(variant) !== 'null');
    if (nonNull) {
      return resolveSchema(nonNull, root, seenRefs);
    }
  }

  if (schema.oneOf?.length) {
    return resolveSchema(schema.oneOf[0], root, seenRefs);
  }

  if (schema.allOf?.length) {
    return resolveSchema(schema.allOf[0], root, seenRefs);
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
  schema: SharedExpressionSchemaNode | undefined,
  rootSchema: SharedExpressionSchemaNode | undefined = root.schema
): SharedExpressionPathOption => {
  const path = joinPath(root.key, segments);
  const resolvedSchema = resolveSchema(schema, rootSchema);

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
    const nextRootSchema =
      root.key === 'vars' && parentSegments.length === 0 && propertySchema && typeof propertySchema === 'object'
        ? propertySchema
        : rootSchema;
    options.push(createOption(root, nextSegments, propertySchema, nextRootSchema));
    pushNestedOptions(options, root, nextSegments, propertySchema, nextRootSchema);
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
