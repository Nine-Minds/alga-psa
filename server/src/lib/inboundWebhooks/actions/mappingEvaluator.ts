import { evaluateExpressionSource } from '@alga-psa/workflows/runtime/expressionEngine';

export interface EvaluateFieldMappingOptions {
  timeoutMs?: number;
}

export async function evaluateFieldMapping(
  body: unknown,
  fieldMapping: Record<string, string>,
  options: EvaluateFieldMappingOptions = {},
): Promise<Record<string, unknown>> {
  const mappedValues: Record<string, unknown> = {};

  for (const [fieldName, expression] of Object.entries(fieldMapping)) {
    mappedValues[fieldName] = await evaluateExpressionSource(
      expression,
      {
        body,
        payload: body,
      },
      options.timeoutMs,
    );
  }

  return mappedValues;
}
