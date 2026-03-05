export const WORKFLOW_RUNTIME_ALLOWED_FUNCTIONS = [
  'nowIso',
  'coalesce',
  'len',
  'toString',
  'append',
] as const;

export type WorkflowRuntimeAllowedFunction = (typeof WORKFLOW_RUNTIME_ALLOWED_FUNCTIONS)[number];
