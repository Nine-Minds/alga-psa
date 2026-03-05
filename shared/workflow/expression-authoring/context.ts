import type { ExpressionMode } from './modes';

export type SharedExpressionValueType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null'
  | 'unknown';

export interface SharedExpressionSchemaNode {
  type?: string | string[];
  description?: string;
  title?: string;
  properties?: Record<string, SharedExpressionSchemaNode>;
  items?: SharedExpressionSchemaNode;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  anyOf?: SharedExpressionSchemaNode[];
  oneOf?: SharedExpressionSchemaNode[];
  allOf?: SharedExpressionSchemaNode[];
  additionalProperties?: boolean | SharedExpressionSchemaNode;
  definitions?: Record<string, SharedExpressionSchemaNode>;
  $ref?: string;
}

export interface SharedExpressionContextRoot {
  key: string;
  label: string;
  description?: string;
  schema?: SharedExpressionSchemaNode;
  allowInModes?: ExpressionMode[];
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

export interface SharedExpressionPathOption {
  root: string;
  path: string;
  label: string;
  description?: string;
  valueType: SharedExpressionValueType;
  depth: number;
  isLeaf: boolean;
  segments: string[];
}

type SerializableContextRoot = Omit<SharedExpressionContextRoot, 'allowInModes'> & {
  allowInModes?: ExpressionMode[];
};

const compareByKey = <T extends { key: string }>(a: T, b: T) => a.key.localeCompare(b.key);

const normalizeRoot = (root: SharedExpressionContextRoot): SerializableContextRoot => ({
  ...root,
  allowInModes: root.allowInModes ? [...root.allowInModes] : undefined,
});

export const serializeExpressionContextRoots = (
  roots: SharedExpressionContextRoot[],
  spacing = 2
): string => {
  const normalized = roots.map(normalizeRoot).sort(compareByKey);
  return JSON.stringify(normalized, null, spacing);
};

export const deserializeExpressionContextRoots = (serialized: string): SharedExpressionContextRoot[] => {
  const parsed = JSON.parse(serialized) as SerializableContextRoot[];
  return parsed.map((root) => normalizeRoot(root)).sort(compareByKey);
};
