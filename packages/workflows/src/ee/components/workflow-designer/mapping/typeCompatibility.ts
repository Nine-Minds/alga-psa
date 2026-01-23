/**
 * Type Compatibility System for Mapping Editor
 *
 * Provides utilities for checking type compatibility between source and target fields,
 * color coding for visual feedback, and type inference from JSON Schema.
 *
 * §19.1 - Type Compatibility System
 */

/**
 * Type compatibility levels
 */
export enum TypeCompatibility {
  /** Types match exactly */
  EXACT = 'exact',
  /** Types can be coerced (e.g., string → number) */
  COERCIBLE = 'coercible',
  /** Types are incompatible */
  INCOMPATIBLE = 'incompatible',
  /** One or both types are unknown */
  UNKNOWN = 'unknown'
}

/**
 * Color constants for compatibility indicators
 * Using Tailwind color palette values
 */
export const COMPATIBILITY_COLORS = {
  [TypeCompatibility.EXACT]: '#22c55e',      // green-500
  [TypeCompatibility.COERCIBLE]: '#eab308',  // yellow-500
  [TypeCompatibility.INCOMPATIBLE]: '#ef4444', // red-500
  [TypeCompatibility.UNKNOWN]: '#9ca3af'     // gray-400
} as const;

/**
 * Tailwind class names for compatibility indicators
 */
export const COMPATIBILITY_CLASSES = {
  [TypeCompatibility.EXACT]: {
    bg: 'bg-green-100',
    text: 'text-green-700',
    border: 'border-green-300',
    ring: 'ring-green-500'
  },
  [TypeCompatibility.COERCIBLE]: {
    bg: 'bg-yellow-100',
    text: 'text-yellow-700',
    border: 'border-yellow-300',
    ring: 'ring-yellow-500'
  },
  [TypeCompatibility.INCOMPATIBLE]: {
    bg: 'bg-red-100',
    text: 'text-red-700',
    border: 'border-red-300',
    ring: 'ring-red-500'
  },
  [TypeCompatibility.UNKNOWN]: {
    bg: 'bg-gray-100',
    text: 'text-gray-500',
    border: 'border-gray-300',
    ring: 'ring-gray-400'
  }
} as const;

/**
 * Get the color for a compatibility level
 */
export function getCompatibilityColor(compatibility: TypeCompatibility): string {
  return COMPATIBILITY_COLORS[compatibility];
}

/**
 * Get Tailwind classes for a compatibility level
 */
export function getCompatibilityClasses(compatibility: TypeCompatibility) {
  return COMPATIBILITY_CLASSES[compatibility];
}

/**
 * Get human-readable label for accessibility
 */
export function getCompatibilityLabel(compatibility: TypeCompatibility): string {
  switch (compatibility) {
    case TypeCompatibility.EXACT:
      return 'Exact match';
    case TypeCompatibility.COERCIBLE:
      return 'Can be converted';
    case TypeCompatibility.INCOMPATIBLE:
      return 'Incompatible types';
    case TypeCompatibility.UNKNOWN:
      return 'Unknown compatibility';
  }
}

/**
 * Normalize type string for comparison
 * Handles JSON Schema type variations
 */
function normalizeType(type: string | undefined): string | undefined {
  if (!type) return undefined;

  const t = type.toLowerCase().trim();

  // Handle common aliases
  switch (t) {
    case 'int':
    case 'integer':
    case 'float':
    case 'double':
      return 'number';
    case 'bool':
      return 'boolean';
    case 'str':
    case 'text':
      return 'string';
    case 'list':
      return 'array';
    case 'dict':
    case 'map':
    case 'record':
      return 'object';
    case 'null':
    case 'undefined':
    case 'void':
      return 'null';
    case 'any':
    case 'unknown':
    case 'mixed':
      return 'any';
    default:
      return t;
  }
}

/**
 * Check if a type can be coerced to another type
 */
function canCoerce(sourceType: string, targetType: string): boolean {
  // Number to string: always works
  if (sourceType === 'number' && targetType === 'string') return true;

  // Boolean to string: always works
  if (sourceType === 'boolean' && targetType === 'string') return true;

  // String to number: possible if parseable
  if (sourceType === 'string' && targetType === 'number') return true;

  // String to boolean: possible (truthy/falsy check)
  if (sourceType === 'string' && targetType === 'boolean') return true;

  // Number to boolean: possible (truthy/falsy)
  if (sourceType === 'number' && targetType === 'boolean') return true;

  // Date string to date object is common
  if (sourceType === 'string' && targetType === 'date') return true;

  return false;
}

/**
 * Check if two types are exactly compatible
 */
function isExactMatch(sourceType: string, targetType: string): boolean {
  if (sourceType === targetType) return true;

  // 'any' matches anything
  if (sourceType === 'any' || targetType === 'any') return true;

  return false;
}

/**
 * Determine the compatibility between source and target types
 *
 * @param sourceType - The type of the source field (e.g., from payload/vars)
 * @param targetType - The expected type of the target field (from action schema)
 * @returns The compatibility level
 */
export function getTypeCompatibility(
  sourceType: string | undefined,
  targetType: string | undefined
): TypeCompatibility {
  // If either type is unknown, return UNKNOWN
  if (!sourceType || !targetType) {
    return TypeCompatibility.UNKNOWN;
  }

  const normalizedSource = normalizeType(sourceType);
  const normalizedTarget = normalizeType(targetType);

  if (!normalizedSource || !normalizedTarget) {
    return TypeCompatibility.UNKNOWN;
  }

  // Check for exact match
  if (isExactMatch(normalizedSource, normalizedTarget)) {
    return TypeCompatibility.EXACT;
  }

  // Check for coercible types
  if (canCoerce(normalizedSource, normalizedTarget)) {
    return TypeCompatibility.COERCIBLE;
  }

  // Handle nullable types
  if (normalizedSource === 'null' && normalizedTarget !== 'null') {
    // null to non-null is coercible (may use default)
    return TypeCompatibility.COERCIBLE;
  }

  // Handle optional/union types that might include null
  if (normalizedTarget.includes('|')) {
    const targetTypes = normalizedTarget.split('|').map(t => t.trim());
    // Check if any of the union members are compatible
    for (const t of targetTypes) {
      const compat = getTypeCompatibility(sourceType, t);
      if (compat === TypeCompatibility.EXACT) return TypeCompatibility.EXACT;
      if (compat === TypeCompatibility.COERCIBLE) return TypeCompatibility.COERCIBLE;
    }
  }

  // Array element type checking
  if (normalizedSource.startsWith('array<') && normalizedTarget.startsWith('array<')) {
    const sourceElement = normalizedSource.slice(6, -1);
    const targetElement = normalizedTarget.slice(6, -1);
    return getTypeCompatibility(sourceElement, targetElement);
  }

  // Object to any object is exact if both are objects
  if (normalizedSource === 'object' && normalizedTarget === 'object') {
    return TypeCompatibility.EXACT;
  }

  // Array to any array is exact if both are arrays
  if (normalizedSource === 'array' && normalizedTarget === 'array') {
    return TypeCompatibility.EXACT;
  }

  return TypeCompatibility.INCOMPATIBLE;
}

/**
 * JSON Schema type definition (subset)
 */
export interface JsonSchemaType {
  type?: string | string[];
  format?: string;
  items?: JsonSchemaType;
  properties?: Record<string, JsonSchemaType>;
  enum?: unknown[];
  oneOf?: JsonSchemaType[];
  anyOf?: JsonSchemaType[];
  allOf?: JsonSchemaType[];
  $ref?: string;
  nullable?: boolean;
}

/**
 * Infer a simplified type string from a JSON Schema definition
 *
 * @param schema - JSON Schema type definition
 * @returns A normalized type string
 */
export function inferTypeFromJsonSchema(schema: JsonSchemaType | undefined): string | undefined {
  if (!schema) return undefined;

  // Handle type arrays (e.g., ["string", "null"])
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter(t => t !== 'null');
    if (types.length === 0) return 'null';
    if (types.length === 1) {
      const baseType = normalizeType(types[0]);
      if (schema.type.includes('null') || schema.nullable) {
        return `${baseType}|null`;
      }
      return baseType;
    }
    return types.map(t => normalizeType(t)).join('|');
  }

  // Handle single type
  if (schema.type) {
    let baseType = normalizeType(schema.type);

    // Handle format modifiers
    if (schema.format) {
      switch (schema.format) {
        case 'date':
        case 'date-time':
          baseType = 'date';
          break;
        case 'email':
        case 'uri':
        case 'hostname':
        case 'ipv4':
        case 'ipv6':
          baseType = 'string';
          break;
        case 'int32':
        case 'int64':
        case 'float':
        case 'double':
          baseType = 'number';
          break;
      }
    }

    // Handle array items
    if (baseType === 'array' && schema.items) {
      const elementType = inferTypeFromJsonSchema(schema.items);
      if (elementType) {
        return `array<${elementType}>`;
      }
    }

    // Handle nullable
    if (schema.nullable) {
      return `${baseType}|null`;
    }

    return baseType;
  }

  // Handle enum
  if (schema.enum && schema.enum.length > 0) {
    const firstValue = schema.enum[0];
    return typeof firstValue;
  }

  // Handle oneOf/anyOf
  if (schema.oneOf || schema.anyOf) {
    const variants = schema.oneOf || schema.anyOf || [];
    const types = variants
      .map(v => inferTypeFromJsonSchema(v))
      .filter((t): t is string => t !== undefined);
    if (types.length === 0) return undefined;
    if (types.length === 1) return types[0];
    return [...new Set(types)].join('|');
  }

  // Handle $ref (simplified - just return 'object')
  if (schema.$ref) {
    return 'object';
  }

  return undefined;
}

/**
 * Get a display-friendly type name
 */
export function getDisplayTypeName(type: string | undefined): string {
  if (!type) return 'unknown';

  const normalized = normalizeType(type);
  if (!normalized) return type;

  // Handle union types
  if (normalized.includes('|')) {
    const types = normalized.split('|').filter(t => t !== 'null');
    if (types.length === 0) return 'null';
    const display = types.map(t => getDisplayTypeName(t)).join(' | ');
    if (normalized.includes('null')) {
      return `${display}?`;
    }
    return display;
  }

  // Handle array types
  if (normalized.startsWith('array<')) {
    const element = normalized.slice(6, -1);
    return `${getDisplayTypeName(element)}[]`;
  }

  // Capitalize first letter for display
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/**
 * Sort fields by compatibility with a target type
 * Returns a new sorted array (does not mutate input)
 */
export function sortByCompatibility<T extends { type?: string }>(
  fields: T[],
  targetType: string | undefined
): T[] {
  if (!targetType) return [...fields];

  return [...fields].sort((a, b) => {
    const compatA = getTypeCompatibility(a.type, targetType);
    const compatB = getTypeCompatibility(b.type, targetType);

    // Order: EXACT < COERCIBLE < UNKNOWN < INCOMPATIBLE
    const order = {
      [TypeCompatibility.EXACT]: 0,
      [TypeCompatibility.COERCIBLE]: 1,
      [TypeCompatibility.UNKNOWN]: 2,
      [TypeCompatibility.INCOMPATIBLE]: 3
    };

    return order[compatA] - order[compatB];
  });
}

/**
 * Group fields by compatibility level
 */
export function groupByCompatibility<T extends { type?: string }>(
  fields: T[],
  targetType: string | undefined
): Record<TypeCompatibility, T[]> {
  const groups: Record<TypeCompatibility, T[]> = {
    [TypeCompatibility.EXACT]: [],
    [TypeCompatibility.COERCIBLE]: [],
    [TypeCompatibility.UNKNOWN]: [],
    [TypeCompatibility.INCOMPATIBLE]: []
  };

  for (const field of fields) {
    const compat = getTypeCompatibility(field.type, targetType);
    groups[compat].push(field);
  }

  return groups;
}
