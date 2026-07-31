/**
 * Catalog of the custom functions available inside workflow `$expr`
 * expressions (on top of JSONata's built-ins). The expression engine
 * registers implementations from this catalog, so the metadata below can
 * never drift from what actually runs.
 */
export type WorkflowExpressionFunctionDef = {
  name: string;
  signature: string;
  description: string;
  example: string;
  implementation: (...args: never[]) => unknown;
};

export const WORKFLOW_EXPRESSION_FUNCTIONS: readonly WorkflowExpressionFunctionDef[] = [
  {
    name: 'nowIso',
    signature: 'nowIso() -> string',
    description: 'Current timestamp as an ISO-8601 string.',
    example: '{ "$expr": "nowIso()" }',
    implementation: () => new Date().toISOString(),
  },
  {
    name: 'coalesce',
    signature: 'coalesce(...values) -> any',
    description: 'First argument that is neither null nor undefined, else null.',
    example: '{ "$expr": "coalesce(payload.nickname, payload.name, \\"unknown\\")" }',
    implementation: (...args: unknown[]) => {
      for (const arg of args) {
        if (arg !== null && arg !== undefined) return arg;
      }
      return null;
    },
  },
  {
    name: 'len',
    signature: 'len(value: string | array) -> number',
    description: 'Length of a string or array; 0 for anything else.',
    example: '{ "$expr": "len(payload.items) > 0" }',
    implementation: (value: unknown) => {
      if (typeof value === 'string' || Array.isArray(value)) {
        return value.length;
      }
      return 0;
    },
  },
  {
    name: 'toString',
    signature: 'toString(value) -> string',
    description: 'String form of any value; empty string for null/undefined.',
    example: '{ "$expr": "toString(payload.count) & \\" items\\"" }',
    implementation: (value: unknown) => {
      if (value === null || value === undefined) return '';
      return String(value);
    },
  },
  {
    name: 'append',
    signature: 'append(list, value) -> array',
    description:
      'Concatenate onto a list. Non-array lists are wrapped ([] for null/undefined); array values are spread.',
    example: '{ "$expr": "append(vars.seen, payload.ticketId)" }',
    implementation: (list: unknown, value: unknown) => {
      const base = Array.isArray(list) ? list : list === null || list === undefined ? [] : [list];
      const toAdd = Array.isArray(value) ? value : [value];
      return base.concat(toAdd);
    },
  },
] as const;

export const WORKFLOW_RUNTIME_ALLOWED_FUNCTIONS = WORKFLOW_EXPRESSION_FUNCTIONS.map(
  (fn) => fn.name
) as readonly string[];

export type WorkflowRuntimeAllowedFunction = (typeof WORKFLOW_RUNTIME_ALLOWED_FUNCTIONS)[number];

/** Metadata-only view for API surfaces like the authoring guide. */
export function listWorkflowExpressionFunctions(): Array<{
  name: string;
  signature: string;
  description: string;
  example: string;
}> {
  return WORKFLOW_EXPRESSION_FUNCTIONS.map(({ name, signature, description, example }) => ({
    name,
    signature,
    description,
    example,
  }));
}
