/**
 * Mapping Validator
 *
 * Validates InputMapping values for publish validation.
 * Checks expression syntax, secret reference validity, and type compatibility.
 */

import type { PublishError, MappingValue, InputMapping } from '../types';
import { isExpr, isSecretRef } from '../types';
import { validateExpressionSource } from '../expressionEngine';
import { secretNameSchema } from '../../secrets/types';

/**
 * Options for mapping validation.
 */
export interface MappingValidationOptions {
  /**
   * Step path for error reporting (e.g., "root.steps[0]")
   */
  stepPath: string;

  /**
   * Step ID for error reporting
   */
  stepId: string;

  /**
   * Field name being validated (e.g., "inputMapping")
   */
  fieldName: string;

  /**
   * Optional set of known secret names to validate against.
   * If provided, will warn about references to unknown secrets.
   */
  knownSecrets?: Set<string>;

  /**
   * Optional action input schema to validate required fields.
   */
  requiredFields?: string[];
}

/**
 * Result of mapping validation.
 */
export interface MappingValidationResult {
  errors: PublishError[];
  warnings: PublishError[];
  /**
   * Set of secret names referenced in the mapping.
   * Useful for checking if all secrets exist before publishing.
   */
  secretRefs: Set<string>;
}

type JsonSchema = Record<string, unknown>;

const isObjectLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validate a single MappingValue.
 *
 * @param value - The value to validate
 * @param keyPath - The JSON path to this value (e.g., "inputMapping.to")
 * @param options - Validation options
 * @param result - Result accumulator
 */
function validateMappingValue(
  value: MappingValue,
  keyPath: string,
  options: MappingValidationOptions,
  result: MappingValidationResult
): void {
  // Handle expressions: { $expr: "..." }
  if (isExpr(value)) {
    if (!value.$expr || value.$expr.trim() === '') {
      result.errors.push({
        severity: 'error',
        stepPath: options.stepPath,
        stepId: options.stepId,
        code: 'EMPTY_EXPRESSION',
        message: `Empty expression at ${keyPath}`
      });
      return;
    }

    try {
      validateExpressionSource(value.$expr);
    } catch (error) {
      result.errors.push({
        severity: 'error',
        stepPath: options.stepPath,
        stepId: options.stepId,
        code: 'INVALID_EXPRESSION',
        message: `Invalid expression at ${keyPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
    return;
  }

  // Handle secret references: { $secret: "SECRET_NAME" }
  if (isSecretRef(value)) {
    const secretName = value.$secret;

    // Validate secret name format
    const nameValidation = secretNameSchema.safeParse(secretName);
    if (!nameValidation.success) {
      result.errors.push({
        severity: 'error',
        stepPath: options.stepPath,
        stepId: options.stepId,
        code: 'INVALID_SECRET_NAME',
        message: `Invalid secret name format at ${keyPath}: ${nameValidation.error.issues[0]?.message ?? 'Invalid format'}`
      });
      return;
    }

    // Track the secret reference
    result.secretRefs.add(secretName);

    // Warn if secret is not in the known list (optional check)
    if (options.knownSecrets && !options.knownSecrets.has(secretName)) {
      result.warnings.push({
        severity: 'warning',
        stepPath: options.stepPath,
        stepId: options.stepId,
        code: 'UNKNOWN_SECRET',
        message: `Secret "${secretName}" referenced at ${keyPath} may not exist`
      });
    }
    return;
  }

  // Handle literal values (recursively validate nested objects/arrays)
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validateMappingValue(item as MappingValue, `${keyPath}[${index}]`, options, result);
    });
    return;
  }

  if (value !== null && typeof value === 'object') {
    // Check for invalid special keys
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$') && key !== '$expr' && key !== '$secret') {
        result.warnings.push({
          severity: 'warning',
          stepPath: options.stepPath,
          stepId: options.stepId,
          code: 'UNKNOWN_SPECIAL_KEY',
          message: `Unknown special key "${key}" at ${keyPath}.${key} - did you mean $expr or $secret?`
        });
      }
      validateMappingValue(obj[key] as MappingValue, `${keyPath}.${key}`, options, result);
    }
    return;
  }

  // Primitive literals (string, number, boolean, null) are always valid
}

function resolveSchemaRef(schema: JsonSchema, root: JsonSchema): JsonSchema {
  if (!schema || typeof schema !== 'object') return schema;
  const ref = (schema as { $ref?: string }).$ref;
  if (!ref || !root || typeof root !== 'object') return schema;
  if (!ref.startsWith('#/definitions/')) return schema;
  const key = ref.split('/').pop() ?? '';
  const definitions = (root as { definitions?: Record<string, JsonSchema> }).definitions;
  const resolved = definitions?.[key];
  if (!resolved) return schema;
  return resolveSchemaRef(resolved, root);
}

function mergeAllOf(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const allOf = (schema as { allOf?: JsonSchema[] }).allOf;
  if (!Array.isArray(allOf) || allOf.length === 0) return schema;
  const base: JsonSchema = { ...schema };
  delete (base as { allOf?: JsonSchema[] }).allOf;

  const merged: JsonSchema = { ...base };
  for (const part of allOf) {
    const resolved = resolveSchemaRef(part, root);
    const mergedResolved = mergeAllOf(resolved, root);
    const props = (mergedResolved as { properties?: Record<string, JsonSchema> }).properties;
    if (props) {
      merged.properties = {
        ...(merged as { properties?: Record<string, JsonSchema> }).properties,
        ...props
      };
    }
    const required = (mergedResolved as { required?: string[] }).required;
    if (required) {
      merged.required = Array.from(new Set([
        ...((merged as { required?: string[] }).required ?? []),
        ...required
      ]));
    }
  }
  return merged;
}

function normalizeSchema(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const resolved = resolveSchemaRef(schema, root);
  const merged = mergeAllOf(resolved, root);
  return merged;
}

function isObjectSchema(schema: JsonSchema): boolean {
  const type = (schema as { type?: string | string[] }).type;
  if (type === 'object') return true;
  if (Array.isArray(type) && type.includes('object')) return true;
  return !!(schema as { properties?: Record<string, JsonSchema> }).properties;
}

function shouldRecurseIntoValue(value: unknown): value is Record<string, unknown> {
  if (!isObjectLike(value)) return false;
  if (isExpr(value) || isSecretRef(value)) return false;
  if (Array.isArray(value)) return false;
  return true;
}

function validateRequiredAgainstSchema(
  mapping: InputMapping | undefined,
  schema: JsonSchema | undefined,
  options: MappingValidationOptions
): PublishError[] {
  const errors: PublishError[] = [];
  if (!schema) return errors;
  const rootSchema = schema;
  const rootMapping = mapping ?? {};

  const validateObject = (currentSchema: JsonSchema, currentMapping: Record<string, unknown>, pathPrefix: string) => {
    const normalized = normalizeSchema(currentSchema, rootSchema);
    if (!isObjectSchema(normalized)) return;

    const properties = (normalized as { properties?: Record<string, JsonSchema> }).properties ?? {};
    const required = (normalized as { required?: string[] }).required ?? [];

    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(currentMapping, key)) {
        errors.push({
          severity: 'error',
          stepPath: options.stepPath,
          stepId: options.stepId,
          code: 'MISSING_REQUIRED_MAPPING',
          message: `Required field "${pathPrefix}.${key}" is not mapped in ${options.fieldName}`
        });
      }
    }

    for (const [key, propSchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(currentMapping, key)) continue;
      const value = currentMapping[key];
      if (!shouldRecurseIntoValue(value)) continue;
      validateObject(propSchema, value, `${pathPrefix}.${key}`);
    }
  };

  validateObject(rootSchema, rootMapping as Record<string, unknown>, options.fieldName);

  return errors;
}

/**
 * Validate an InputMapping.
 *
 * @param mapping - The mapping to validate
 * @param options - Validation options
 * @returns Validation result with errors, warnings, and secret references
 */
export function validateInputMapping(
  mapping: InputMapping | undefined,
  options: MappingValidationOptions
): MappingValidationResult {
  const result: MappingValidationResult = {
    errors: [],
    warnings: [],
    secretRefs: new Set()
  };

  if (!mapping) {
    // Check if there are required fields that aren't mapped
    if (options.requiredFields && options.requiredFields.length > 0) {
      for (const field of options.requiredFields) {
        result.errors.push({
          severity: 'error',
          stepPath: options.stepPath,
          stepId: options.stepId,
          code: 'MISSING_REQUIRED_MAPPING',
          message: `Required field "${field}" is not mapped in ${options.fieldName}`
        });
      }
    }
    return result;
  }

  // Check for required fields
  if (options.requiredFields) {
    const mappedFields = new Set(Object.keys(mapping));
    for (const field of options.requiredFields) {
      if (!mappedFields.has(field)) {
        result.errors.push({
          severity: 'error',
          stepPath: options.stepPath,
          stepId: options.stepId,
          code: 'MISSING_REQUIRED_MAPPING',
          message: `Required field "${field}" is not mapped in ${options.fieldName}`
        });
      }
    }
  }

  // Validate each mapping entry
  for (const [key, value] of Object.entries(mapping)) {
    const keyPath = `${options.fieldName}.${key}`;
    validateMappingValue(value, keyPath, options, result);
  }

  return result;
}

/**
 * Validate required mappings against a JSON schema (deep required fields).
 * Only enforces nested required fields when the parent is mapped as an object literal.
 */
export function validateInputMappingSchema(
  mapping: InputMapping | undefined,
  schema: JsonSchema | undefined,
  options: MappingValidationOptions
): PublishError[] {
  return validateRequiredAgainstSchema(mapping, schema, options);
}

/**
 * Collect all secret references from a mapping (non-validating).
 * Useful for quick extraction without full validation.
 *
 * @param mapping - The mapping to scan
 * @returns Set of secret names referenced
 */
export function collectSecretRefs(mapping: InputMapping | undefined): Set<string> {
  const refs = new Set<string>();
  if (!mapping) return refs;

  const scan = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;

    if (isSecretRef(value as MappingValue)) {
      refs.add((value as { $secret: string }).$secret);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(scan);
      return;
    }

    Object.values(value as Record<string, unknown>).forEach(scan);
  };

  Object.values(mapping).forEach(scan);
  return refs;
}

/**
 * Collect all secret references from an arbitrary config object.
 * Scans deeply for { $secret: "..." } patterns.
 *
 * @param config - The config object to scan
 * @returns Set of secret names referenced
 */
export function collectSecretRefsFromConfig(config: unknown): Set<string> {
  const refs = new Set<string>();

  const scan = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;

    if (isSecretRef(value as MappingValue)) {
      refs.add((value as { $secret: string }).$secret);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(scan);
      return;
    }

    Object.values(value as Record<string, unknown>).forEach(scan);
  };

  scan(config);
  return refs;
}
