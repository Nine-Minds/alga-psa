export type SharedValidationSeverity = 'error' | 'warning' | 'info';

export type SharedValidationRange = {
  startOffset: number;
  endOffset: number;
};

export interface SharedExpressionValidationDiagnostic {
  severity: SharedValidationSeverity;
  message: string;
  code?: string;
  source?: string;
  path?: string;
  root?: string;
  range?: SharedValidationRange;
}

export interface SharedExpressionValidationResult {
  valid: boolean;
  diagnostics: SharedExpressionValidationDiagnostic[];
}

const SEVERITY_ORDER: Record<SharedValidationSeverity, number> = {
  error: 3,
  warning: 2,
  info: 1,
};

export const normalizeValidationSeverity = (value: unknown): SharedValidationSeverity => {
  if (value === 'error' || value === 'warning' || value === 'info') {
    return value;
  }
  return 'info';
};

export const createValidationDiagnostic = (
  diagnostic: Partial<SharedExpressionValidationDiagnostic> & Pick<SharedExpressionValidationDiagnostic, 'message'>
): SharedExpressionValidationDiagnostic => ({
  severity: normalizeValidationSeverity(diagnostic.severity),
  message: diagnostic.message,
  code: diagnostic.code,
  source: diagnostic.source,
  path: diagnostic.path,
  root: diagnostic.root,
  range: diagnostic.range,
});

const compareDiagnostics = (
  a: SharedExpressionValidationDiagnostic,
  b: SharedExpressionValidationDiagnostic
): number => {
  const severityOrder = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
  if (severityOrder !== 0) return severityOrder;

  const pathA = a.path ?? '';
  const pathB = b.path ?? '';
  const pathOrder = pathA.localeCompare(pathB);
  if (pathOrder !== 0) return pathOrder;

  return a.message.localeCompare(b.message);
};

export const createValidationResult = (
  diagnostics: SharedExpressionValidationDiagnostic[]
): SharedExpressionValidationResult => {
  const normalized = diagnostics.map(createValidationDiagnostic).sort(compareDiagnostics);
  const hasErrors = normalized.some((diagnostic) => diagnostic.severity === 'error');
  return {
    valid: !hasErrors,
    diagnostics: normalized,
  };
};

export const mergeValidationResults = (
  ...results: Array<SharedExpressionValidationResult | null | undefined>
): SharedExpressionValidationResult => {
  const diagnostics = results.flatMap((result) => result?.diagnostics ?? []);
  return createValidationResult(diagnostics);
};
