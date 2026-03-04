export const EXPRESSION_MODES = ['path-only', 'template', 'expression'] as const;

export type ExpressionMode = (typeof EXPRESSION_MODES)[number];

export const isExpressionMode = (value: unknown): value is ExpressionMode =>
  typeof value === 'string' && (EXPRESSION_MODES as readonly string[]).includes(value);
