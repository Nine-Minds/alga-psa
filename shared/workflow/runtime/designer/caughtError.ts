/**
 * The error a Catch branch can read, as the runtime binds it: `error` (and `vars.<captureErrorAs>`
 * when the Try/Catch names one) hold the failed step's runtime error. The shape follows the
 * runtime's normalized error (ee/temporal-workflows workflow-runtime-v2-run-workflow.ts
 * `normalizeRuntimeError`, and the simulator's `stepError`): category, message, nodePath, at, plus
 * code and details when the failing action supplied them. There is no `name` or `stack`.
 *
 * Every designer surface that lists error fields (Insert field, Reference mode, the data panel,
 * expression autocomplete) builds from this one definition.
 */
export type WorkflowCaughtErrorField = {
  name: 'message' | 'category' | 'code' | 'nodePath' | 'at' | 'details';
  type: 'string' | 'object';
  description: string;
  /** Always present on a caught error (code and details depend on the failing action). */
  alwaysPresent: boolean;
};

export const WORKFLOW_CAUGHT_ERROR_FIELDS: readonly WorkflowCaughtErrorField[] = [
  { name: 'message', type: 'string', description: 'What went wrong', alwaysPresent: true },
  { name: 'code', type: 'string', description: 'Error code from the failing action, e.g. NOT_FOUND', alwaysPresent: false },
  { name: 'category', type: 'string', description: 'Kind of error, e.g. ActionError or ValidationError', alwaysPresent: true },
  { name: 'nodePath', type: 'string', description: 'Which step failed', alwaysPresent: true },
  { name: 'at', type: 'string', description: 'When it failed (ISO 8601)', alwaysPresent: true },
  { name: 'details', type: 'object', description: 'Extra details from the failing action', alwaysPresent: false },
];

export const WORKFLOW_CAUGHT_ERROR_SCHEMA = {
  type: 'object',
  description: 'The error caught by this Try/Catch',
  properties: Object.fromEntries(
    WORKFLOW_CAUGHT_ERROR_FIELDS.map((field) => [field.name, { type: field.type, description: field.description }])
  ),
  required: WORKFLOW_CAUGHT_ERROR_FIELDS.filter((field) => field.alwaysPresent).map((field) => field.name),
} as const;
