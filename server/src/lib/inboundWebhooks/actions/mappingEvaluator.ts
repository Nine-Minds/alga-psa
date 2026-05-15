import { evaluateExpressionSource } from '@alga-psa/workflows/runtime/expressionEngine';

export interface EvaluateFieldMappingOptions {
  timeoutMs?: number;
}

export class InboundFieldMappingEvaluationError extends Error {
  public readonly fieldName: string;
  public readonly expression: string;
  public readonly cause: unknown;

  constructor(fieldName: string, expression: string, cause: unknown) {
    super(`Field "${fieldName}" expression "${expression}" failed: ${describeFieldEvaluationCause(cause)}`);
    this.name = 'InboundFieldMappingEvaluationError';
    this.fieldName = fieldName;
    this.expression = expression;
    this.cause = cause;
  }
}

function describeFieldEvaluationCause(cause: unknown): string {
  if (cause instanceof Error && cause.message) {
    return cause.message;
  }
  if (cause && typeof cause === 'object') {
    const causeObj = cause as Record<string, unknown>;
    // JSONata errors carry { code, message, token, value, position }
    const parts: string[] = [];
    if (typeof causeObj.message === 'string' && causeObj.message) parts.push(causeObj.message);
    if (typeof causeObj.code === 'string') parts.push(`code=${causeObj.code}`);
    if (typeof causeObj.token === 'string') parts.push(`token="${causeObj.token}"`);
    if (typeof causeObj.value !== 'undefined') parts.push(`value=${String(causeObj.value)}`);
    if (typeof causeObj.position !== 'undefined') parts.push(`position=${String(causeObj.position)}`);
    if (parts.length > 0) {
      return parts.join(' ');
    }
    try {
      return JSON.stringify(cause);
    } catch {
      return Object.prototype.toString.call(cause);
    }
  }
  return String(cause);
}

export async function evaluateFieldMapping(
  body: unknown,
  fieldMapping: Record<string, string>,
  options: EvaluateFieldMappingOptions = {},
): Promise<Record<string, unknown>> {
  const context = body && typeof body === 'object' ? (body as Record<string, unknown>) : { value: body };
  const entries = Object.entries(fieldMapping);
  const results = await Promise.all(
    entries.map(async ([fieldName, expression]) => {
      try {
        return await evaluateExpressionSource(expression, context, options.timeoutMs);
      } catch (error) {
        // JSONata expressions that resolve to undefined are flagged by the expression
        // engine as "not JSON-serializable". For inbound mappings we treat a missing
        // path as undefined so the dispatcher's required/optional checks can run.
        if (error instanceof Error && error.message === 'Expression result is not JSON-serializable') {
          return undefined;
        }
        throw new InboundFieldMappingEvaluationError(fieldName, expression, error);
      }
    }),
  );

  const mappedValues: Record<string, unknown> = {};
  entries.forEach(([fieldName], index) => {
    mappedValues[fieldName] = results[index];
  });
  return mappedValues;
}
