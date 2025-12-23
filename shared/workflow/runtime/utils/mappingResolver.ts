/**
 * Mapping Resolver
 *
 * Resolves InputMapping values which can be:
 * - Expr: { $expr: "expression" } - Evaluated using the expression engine
 * - SecretRef: { $secret: "SECRET_NAME" } - Resolved from tenant secrets
 * - LiteralValue: Direct values (string, number, boolean, null, array, object)
 */

import type { Expr, MappingValue, InputMapping } from '../types';
import { isExpr, isSecretRef, isLiteralValue } from '../types';
import type { ExpressionContext } from '../expressionEngine';
import { compileExpression } from '../expressionEngine';

/**
 * Interface for resolving tenant secrets.
 * This is injected at runtime to avoid circular dependencies.
 */
export interface SecretResolver {
  /**
   * Resolve a secret by name.
   * @param name - The secret name (e.g., "API_KEY")
   * @param workflowRunId - Optional workflow run ID for audit logging
   * @returns The decrypted secret value
   * @throws Error if secret doesn't exist
   */
  resolve(name: string, workflowRunId?: string): Promise<string>;
}

/**
 * A no-op secret resolver that throws an error when secrets are used.
 * Use this when secrets are not available (e.g., validation context).
 */
export const noOpSecretResolver: SecretResolver = {
  async resolve(name: string): Promise<string> {
    throw new Error(`Secret resolution not available in this context: ${name}`);
  }
};

/**
 * Options for resolving mapping values.
 */
export interface MappingResolverOptions {
  /**
   * Expression context for evaluating $expr values.
   */
  expressionContext: ExpressionContext;

  /**
   * Secret resolver for resolving $secret values.
   * If not provided, secrets will throw an error.
   */
  secretResolver?: SecretResolver;

  /**
   * Workflow run ID for audit logging when resolving secrets.
   */
  workflowRunId?: string;

  /**
   * Track resolved secret paths for redaction.
   * If provided, paths to resolved secrets will be pushed to this array.
   */
  redactionPaths?: string[];
}

/**
 * Resolve a single MappingValue.
 *
 * @param value - The value to resolve (Expr, SecretRef, or literal)
 * @param options - Resolution options
 * @param currentPath - Current JSON path for redaction tracking
 * @returns The resolved value
 */
export async function resolveMappingValue(
  value: MappingValue,
  options: MappingResolverOptions,
  currentPath?: string
): Promise<unknown> {
  // Handle expressions: { $expr: "..." }
  if (isExpr(value)) {
    const compiled = compileExpression(value);
    try {
      return await compiled.evaluate(options.expressionContext);
    } catch (error) {
      throw {
        category: 'ExpressionError',
        message: error instanceof Error ? error.message : String(error),
        path: currentPath
      };
    }
  }

  // Handle secret references: { $secret: "SECRET_NAME" }
  if (isSecretRef(value)) {
    const resolver = options.secretResolver ?? noOpSecretResolver;
    try {
      const secretValue = await resolver.resolve(value.$secret, options.workflowRunId);

      // Track this path for redaction
      if (currentPath && options.redactionPaths) {
        options.redactionPaths.push(currentPath);
      }

      return secretValue;
    } catch (error) {
      throw {
        category: 'ActionError',
        message: `Failed to resolve secret "${value.$secret}": ${error instanceof Error ? error.message : String(error)}`,
        path: currentPath
      };
    }
  }

  // Handle literal values (recursively process arrays and objects)
  if (Array.isArray(value)) {
    const resolved: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const itemPath = currentPath ? `${currentPath}/${i}` : `/${i}`;
      resolved.push(await resolveMappingValue(value[i] as MappingValue, options, itemPath));
    }
    return resolved;
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const keyPath = currentPath ? `${currentPath}/${escapeJsonPointer(key)}` : `/${escapeJsonPointer(key)}`;
      result[key] = await resolveMappingValue(val as MappingValue, options, keyPath);
    }
    return result;
  }

  // Primitive literal values: string, number, boolean, null
  return value;
}

/**
 * Resolve an entire InputMapping.
 *
 * @param mapping - The input mapping to resolve
 * @param options - Resolution options
 * @returns A record of resolved values
 */
export async function resolveInputMapping(
  mapping: InputMapping | undefined,
  options: MappingResolverOptions
): Promise<Record<string, unknown> | null> {
  if (!mapping) return null;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mapping)) {
    const keyPath = `/${escapeJsonPointer(key)}`;
    result[key] = await resolveMappingValue(value, options, keyPath);
  }
  return result;
}

/**
 * Resolve expressions in a value (backward-compatible helper).
 * This is similar to resolveExpressions but uses the mapping resolver.
 *
 * @param value - The value to resolve
 * @param ctx - Expression context
 * @returns The resolved value
 */
export async function resolveExpressionsWithSecrets(
  value: unknown,
  ctx: ExpressionContext,
  secretResolver?: SecretResolver,
  workflowRunId?: string,
  redactionPaths?: string[]
): Promise<unknown> {
  const options: MappingResolverOptions = {
    expressionContext: ctx,
    secretResolver,
    workflowRunId,
    redactionPaths
  };

  return resolveMappingValue(value as MappingValue, options);
}

/**
 * Escape a string for use in a JSON Pointer (RFC 6901).
 */
function escapeJsonPointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Create a secret resolver from the tenant secret provider.
 * This is used by the runtime to create a resolver for a specific tenant.
 */
export function createSecretResolverFromProvider(
  getTenantSecretValue: (name: string, workflowRunId?: string) => Promise<string>
): SecretResolver {
  return {
    async resolve(name: string, workflowRunId?: string): Promise<string> {
      return getTenantSecretValue(name, workflowRunId);
    }
  };
}
