/**
 * Why a workflow payload is not valid, field by field, in a shape the Run dialog can put next to
 * the fields: what kind of problem it is (missing, wrong type, wrong format…) and the limits
 * involved, instead of a validator's English message. Server-side zod issues and the dialog's own
 * JSON-schema check both produce this, so both read the same way.
 */
export type WorkflowPayloadIssueKind =
  | 'required'
  | 'type'
  | 'format'
  | 'choice'
  | 'too_small'
  | 'too_big'
  | 'unknown_field'
  | 'invalid';

export type WorkflowPayloadIssue = {
  /** Where in the payload, e.g. ['ticket', 'messageId'] or ['items', 0]. */
  path: Array<string | number>;
  kind: WorkflowPayloadIssueKind;
  /** For 'type': the expected JSON type (string, number, boolean, object, array). */
  expected?: string;
  /** For 'format': uuid, email, date-time, date, time, url. */
  format?: string;
  /** For 'too_small' / 'too_big': the limit, and what it counts. */
  limit?: number;
  sizeOf?: 'string' | 'number' | 'array';
  /** For 'choice': the allowed values. */
  options?: string[];
  /** The validator's own message, for anything not covered above. */
  message?: string;
};

type ZodIssueLike = {
  code?: string;
  path?: Array<string | number>;
  message?: string;
  expected?: unknown;
  received?: unknown;
  validation?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  type?: unknown;
  options?: unknown;
  keys?: unknown;
  unionErrors?: Array<{ issues?: ZodIssueLike[] }>;
};

const ZOD_STRING_FORMATS: Record<string, string> = {
  uuid: 'uuid',
  email: 'email',
  datetime: 'date-time',
  date: 'date',
  time: 'time',
  url: 'url',
};

const toLimit = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  return undefined;
};

const toSizeOf = (value: unknown): WorkflowPayloadIssue['sizeOf'] =>
  value === 'string' || value === 'number' || value === 'array' ? value : value === 'bigint' ? 'number' : undefined;

const normalizeOne = (issue: ZodIssueLike, basePath: Array<string | number>): WorkflowPayloadIssue[] => {
  const path = [...basePath, ...(issue.path ?? [])];
  switch (issue.code) {
    case 'invalid_type':
      if (issue.received === 'undefined' || issue.received === 'null') {
        return [{ path, kind: 'required' }];
      }
      return [{ path, kind: 'type', expected: typeof issue.expected === 'string' ? issue.expected : undefined }];
    case 'invalid_string': {
      const validation = typeof issue.validation === 'string' ? issue.validation : undefined;
      const format = validation ? ZOD_STRING_FORMATS[validation] : undefined;
      return format
        ? [{ path, kind: 'format', format }]
        : [{ path, kind: 'invalid', message: issue.message }];
    }
    case 'invalid_date':
      return [{ path, kind: 'format', format: 'date-time' }];
    case 'too_small': {
      const sizeOf = toSizeOf(issue.type);
      const limit = toLimit(issue.minimum);
      // A required text field left empty fails as "at least 1 character": say it's missing.
      if (sizeOf === 'string' && limit === 1) return [{ path, kind: 'required' }];
      return [{ path, kind: 'too_small', limit, sizeOf }];
    }
    case 'too_big':
      return [{ path, kind: 'too_big', limit: toLimit(issue.maximum), sizeOf: toSizeOf(issue.type) }];
    case 'invalid_enum_value':
    case 'invalid_literal': {
      const options = Array.isArray(issue.options)
        ? issue.options.map(String)
        : issue.expected !== undefined ? [String(issue.expected)] : undefined;
      return [{ path, kind: 'choice', options }];
    }
    case 'unrecognized_keys':
      return (Array.isArray(issue.keys) ? issue.keys : []).map((key) => ({
        path: [...path, String(key)],
        kind: 'unknown_field' as const,
      }));
    case 'invalid_union': {
      // Report the alternative that came closest: the one with the fewest problems.
      const branches = (issue.unionErrors ?? [])
        .map((branch) => normalizeWorkflowPayloadZodIssues(branch.issues ?? [], basePath))
        .filter((branch) => branch.length > 0)
        .sort((left, right) => left.length - right.length);
      return branches[0] ?? [{ path, kind: 'invalid', message: issue.message }];
    }
    default:
      return [{ path, kind: 'invalid', message: issue.message }];
  }
};

/** Zod issues (from `safeParse(...).error.issues`) as payload issues, one per field problem. */
export const normalizeWorkflowPayloadZodIssues = (
  issues: ReadonlyArray<ZodIssueLike>,
  basePath: Array<string | number> = []
): WorkflowPayloadIssue[] => issues.flatMap((issue) => normalizeOne(issue, basePath));

/**
 * Why a manual run did not start because of its payload. `appliesTo` says which payload the paths
 * point into: what the dialog sent ('input'), or the workflow payload the trigger mapping produced
 * from it ('mappedPayload'), which the dialog can only list, not put next to its fields.
 */
export type WorkflowPayloadValidationFailure = {
  appliesTo: 'input' | 'mappedPayload';
  issues: WorkflowPayloadIssue[];
};

/**
 * Which payload problems to show the person who started a manual run. When the dialog's payload
 * went straight to the workflow, the workflow's issues point at its fields. When a trigger mapping
 * turned it into the workflow payload, the issues point at the mapped payload instead; checking the
 * submitted event payload against its own schema then finds the dialog fields to fix, if any.
 */
export const describeManualRunPayloadFailure = (input: {
  mappedIssues: ReadonlyArray<ZodIssueLike>;
  submittedPayload: Record<string, unknown>;
  submittedIsMapped: boolean;
  sourceSchema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: ZodIssueLike[] } } } | null;
}): WorkflowPayloadValidationFailure => {
  if (!input.submittedIsMapped) {
    return { appliesTo: 'input', issues: normalizeWorkflowPayloadZodIssues(input.mappedIssues) };
  }
  const sourceValidation = input.sourceSchema?.safeParse(input.submittedPayload);
  if (sourceValidation && !sourceValidation.success && sourceValidation.error?.issues.length) {
    return { appliesTo: 'input', issues: normalizeWorkflowPayloadZodIssues(sourceValidation.error.issues) };
  }
  return { appliesTo: 'mappedPayload', issues: normalizeWorkflowPayloadZodIssues(input.mappedIssues) };
};
