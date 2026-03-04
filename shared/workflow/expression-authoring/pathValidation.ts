import type { SharedExpressionPathOption } from './context';
import type { ExpressionMode } from './modes';
import {
  createValidationDiagnostic,
  createValidationResult,
  mergeValidationResults,
  type SharedExpressionValidationResult,
} from './validation';

const TEMPLATE_TOKEN_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const EXPRESSION_PATH_PATTERN = /\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\])*)\b/g;

const normalizePath = (value: string): string => value.trim();

const compilePathPattern = (path: string): RegExp | null => {
  if (!path.includes('*')) return null;
  const escaped = path
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\*/g, '[^.\\[\\]]+');
  return new RegExp(`^${escaped}$`);
};

const isKnownPath = (path: string, options: SharedExpressionPathOption[]): boolean => {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) return true;
  for (const option of options) {
    if (option.path === normalizedPath) return true;
    const dynamicPattern = compilePathPattern(option.path);
    if (dynamicPattern?.test(normalizedPath)) {
      return true;
    }
  }
  return false;
};

const createUnknownPathDiagnostic = (
  path: string,
  source: ExpressionMode
) =>
  createValidationDiagnostic({
    severity: 'info',
    code: 'unknown-path',
    source: `shared-path-validation:${source}`,
    path,
    message: `Unknown path "${path}" for current context.`,
  });

export const extractTemplateTokenPaths = (template: string): string[] => {
  const paths: string[] = [];
  for (const match of template.matchAll(new RegExp(TEMPLATE_TOKEN_PATTERN))) {
    const token = normalizePath(match[1] ?? '');
    if (!token) continue;
    paths.push(token);
  }
  return paths;
};

export const extractExpressionReferencePaths = (expression: string): string[] => {
  const stripped = expression.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, ' ');
  const references = new Set<string>();
  for (const match of stripped.matchAll(new RegExp(EXPRESSION_PATH_PATTERN))) {
    const candidate = normalizePath(match[1] ?? '');
    if (!candidate.includes('.')) continue;
    references.add(candidate);
  }
  return [...references];
};

const validatePaths = (
  paths: string[],
  mode: ExpressionMode,
  options: SharedExpressionPathOption[]
): SharedExpressionValidationResult => {
  const diagnostics = paths
    .filter((path) => !isKnownPath(path, options))
    .map((path) => createUnknownPathDiagnostic(path, mode));
  return createValidationResult(diagnostics);
};

export const validateSourcePaths = (params: {
  source: string;
  mode: ExpressionMode;
  options: SharedExpressionPathOption[];
}): SharedExpressionValidationResult => {
  const value = params.source ?? '';
  if (!value.trim()) {
    return createValidationResult([]);
  }

  if (params.mode === 'path-only') {
    return validatePaths([value], params.mode, params.options);
  }

  if (params.mode === 'template') {
    return validatePaths(extractTemplateTokenPaths(value), params.mode, params.options);
  }

  return mergeValidationResults(
    validatePaths(extractExpressionReferencePaths(value), params.mode, params.options),
    createValidationResult([])
  );
};
