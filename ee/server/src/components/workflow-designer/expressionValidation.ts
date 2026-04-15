import {
  buildWorkflowExpressionPathOptions,
  validateSourcePaths,
  type SharedExpressionPathOption,
  type SharedExpressionSchemaNode,
  type SharedExpressionValidationDiagnostic,
} from '@alga-psa/workflows/expression-authoring';

export type WorkflowStepOutputValidationContext = {
  saveAs: string;
  outputSchema: SharedExpressionSchemaNode;
};

export type WorkflowExpressionValidationContext = {
  payloadSchema: SharedExpressionSchemaNode | null;
  steps: WorkflowStepOutputValidationContext[];
  forEach?: {
    itemVar: string;
    indexVar: string;
  };
  inCatchBlock?: boolean;
};

export type StepExpressionValidation = {
  field: string;
  diagnostic: SharedExpressionValidationDiagnostic;
};

export const buildWorkflowValidationPathOptions = (
  context: WorkflowExpressionValidationContext
): SharedExpressionPathOption[] => {
  const varsByName = context.steps.reduce<Record<string, SharedExpressionSchemaNode>>((acc, stepOutput) => {
    acc[stepOutput.saveAs] = stepOutput.outputSchema;
    return acc;
  }, {});

  return buildWorkflowExpressionPathOptions({
    payloadSchema: context.payloadSchema ?? undefined,
    varsByName,
    includeErrorRoot: Boolean(context.inCatchBlock),
    forEach: context.forEach
      ? {
          itemVar: context.forEach.itemVar,
          indexVar: context.forEach.indexVar,
        }
      : undefined,
  });
};

export const validateStepExpressions = (
  config: Record<string, unknown>,
  context: WorkflowExpressionValidationContext
): StepExpressionValidation[] => {
  const results: StepExpressionValidation[] = [];
  const options = buildWorkflowValidationPathOptions(context);

  const appendDiagnostics = (field: string, source: string) => {
    const validationResult = validateSourcePaths({
      source,
      mode: 'expression',
      options,
    });

    for (const diagnostic of validationResult.diagnostics) {
      results.push({
        field,
        diagnostic,
      });
    }
  };

  const checkValue = (value: unknown, path: string) => {
    if (typeof value === 'string' && value.includes('${')) {
      appendDiagnostics(path, value);
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    if ('$expr' in (value as Record<string, unknown>)) {
      const expr = (value as { $expr?: string }).$expr;
      if (typeof expr === 'string' && expr.length > 0) {
        appendDiagnostics(path, expr);
      }
      return;
    }
    if (Array.isArray(value)) {
      return;
    }
    Object.entries(value).forEach(([key, nested]) => {
      checkValue(nested, `${path}.${key}`);
    });
  };

  Object.entries(config).forEach(([key, value]) => {
    if (key === 'inputMapping') {
      return;
    }
    checkValue(value, key);
  });

  return results;
};

export const partitionStepExpressionValidations = (validations: StepExpressionValidation[]) => ({
  errors: validations.filter((validation) => validation.diagnostic.severity === 'error'),
  warnings: validations.filter((validation) => validation.diagnostic.severity === 'warning'),
  info: validations.filter((validation) => validation.diagnostic.severity === 'info'),
});
