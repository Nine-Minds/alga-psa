import { z } from 'zod';

export const exprSchema = z.object({
  $expr: z.string().optional().default('')  // Allow undefined/empty for drafts; runtime validates
}).passthrough().transform((val) => {
  // Normalize: keep only $expr, discard other keys (like empty string keys from corrupted data)
  return { $expr: val.$expr ?? '' };
});

export type Expr = z.infer<typeof exprSchema>;

/**
 * Secret reference type for use in workflow inputMapping.
 * References a tenant secret by name: { $secret: "SECRET_NAME" }
 */
export const secretRefSchema = z.object({
  $secret: z.string().min(1)
}).strict();

export type SecretRef = z.infer<typeof secretRefSchema>;

/**
 * Check if a value is a SecretRef.
 */
export function isSecretRef(value: unknown): value is SecretRef {
  return secretRefSchema.safeParse(value).success;
}

/**
 * Literal value types supported in input mapping.
 */
export const literalValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.unknown())
]);

export type LiteralValue = z.infer<typeof literalValueSchema>;

/**
 * Check if a value is a literal (not an expression or secret ref).
 */
export function isLiteralValue(value: unknown): value is LiteralValue {
  // A literal is anything that's not an Expr or SecretRef
  if (value === null) return true;
  if (typeof value !== 'object') return true;
  if (Array.isArray(value)) return true;
  const obj = value as Record<string, unknown>;
  return !('$expr' in obj) && !('$secret' in obj);
}

/**
 * MappingValue is the union of all types that can be used in inputMapping.
 * - Expr: Expression to evaluate at runtime (e.g., { $expr: "payload.name" })
 * - SecretRef: Reference to a tenant secret (e.g., { $secret: "API_KEY" })
 * - LiteralValue: Static value (e.g., "hello", 42, true, null)
 */
export const mappingValueSchema = z.union([
  exprSchema,
  secretRefSchema,
  literalValueSchema
]);

export type MappingValue = z.infer<typeof mappingValueSchema>;

/**
 * InputMapping type for action.call config.
 * Maps target field names to MappingValue (expression, secret, or literal).
 */
export const inputMappingSchema = z.record(mappingValueSchema);

export type InputMapping = z.infer<typeof inputMappingSchema>;

/**
 * Check if a value is an Expr.
 */
export function isExpr(value: unknown): value is Expr {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return '$expr' in obj && typeof obj.$expr === 'string';
}

export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().positive(),
  backoffMs: z.number().int().nonnegative(),
  backoffMultiplier: z.number().positive().optional().default(2),
  jitter: z.boolean().optional().default(true),
  maxDelayMs: z.number().int().positive().optional(),
  retryOn: z.array(z.string()).optional()
}).strict();

export type RetryPolicy = z.input<typeof retryPolicySchema>;

export const onErrorPolicySchema = z.object({
  policy: z.enum(['fail', 'continue'])
}).strict();

export type OnErrorPolicy = z.infer<typeof onErrorPolicySchema>;

export type ControlStepType =
  | 'control.if'
  | 'control.forEach'
  | 'control.tryCatch'
  | 'control.callWorkflow'
  | 'control.return';

export type NodeStepType = Exclude<string, ControlStepType>;

export type NodeStep = {
  id: string;
  type: NodeStepType;
  name?: string;
  config?: unknown;
  retry?: RetryPolicy;
  onError?: OnErrorPolicy;
};

export type IfBlock = {
  id: string;
  type: 'control.if';
  condition: Expr;
  then: Step[];
  else?: Step[];
};

export type ForEachBlock = {
  id: string;
  type: 'control.forEach';
  items: Expr;
  itemVar: string;
  concurrency?: number;
  body: Step[];
  onItemError?: 'continue' | 'fail';
};

export type TryCatchBlock = {
  id: string;
  type: 'control.tryCatch';
  try: Step[];
  catch: Step[];
  captureErrorAs?: string;
};

export type CallWorkflowBlock = {
  id: string;
  type: 'control.callWorkflow';
  workflowId: string;
  workflowVersion: number;
  inputMapping?: Record<string, Expr>;
  outputMapping?: Record<string, Expr>;
  retry?: RetryPolicy;
  onError?: OnErrorPolicy;
};

export type ReturnStep = {
  id: string;
  type: 'control.return';
};

export type Step = NodeStep | IfBlock | ForEachBlock | TryCatchBlock | CallWorkflowBlock | ReturnStep;

export const nodeStepSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1).refine(
    t => !t.startsWith('control.'),
    { message: 'Node step type cannot start with "control." - use a control block schema instead' }
  ),
  name: z.string().optional(),
  config: z.unknown().optional(),
  retry: retryPolicySchema.optional(),
  onError: onErrorPolicySchema.optional()
}).strict();

export const ifBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal('control.if'),
  condition: exprSchema,
  then: z.array(z.lazy(() => stepSchema)) as z.ZodType<Step[]>,
  else: (z.array(z.lazy(() => stepSchema)) as z.ZodType<Step[]>).optional()
}).strict();

export const forEachBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal('control.forEach'),
  items: exprSchema,
  itemVar: z.string().min(1),
  concurrency: z.number().int().positive().optional(),
  body: z.array(z.lazy(() => stepSchema)) as z.ZodType<Step[]>,
  onItemError: z.enum(['continue', 'fail']).optional()
}).strict();

export const tryCatchBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal('control.tryCatch'),
  try: z.array(z.lazy(() => stepSchema)) as z.ZodType<Step[]>,
  catch: z.array(z.lazy(() => stepSchema)) as z.ZodType<Step[]>,
  captureErrorAs: z.string().min(1).optional()
}).strict();

export const callWorkflowBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal('control.callWorkflow'),
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  inputMapping: z.record(exprSchema).optional(),
  outputMapping: z.record(exprSchema).optional(),
  retry: retryPolicySchema.optional(),
  onError: onErrorPolicySchema.optional()
}).strict();

export const returnStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('control.return')
}).strict();

// Custom step schema that routes to the correct schema based on type
const stepSchemaInner = z.unknown().transform((val, ctx) => {
  const obj = val as Record<string, unknown>;
  const type = obj?.type as string | undefined;

  if (!type) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Step must have a type field' });
    return z.NEVER;
  }

  let result: z.SafeParseReturnType<unknown, Step>;

  switch (type) {
    case 'control.if':
      result = ifBlockSchema.safeParse(val);
      break;
    case 'control.forEach':
      result = forEachBlockSchema.safeParse(val);
      break;
    case 'control.tryCatch':
      result = tryCatchBlockSchema.safeParse(val);
      break;
    case 'control.callWorkflow':
      result = callWorkflowBlockSchema.safeParse(val);
      break;
    case 'control.return':
      result = returnStepSchema.safeParse(val);
      break;
    default:
      result = nodeStepSchema.safeParse(val);
  }

  if (!result.success) {
    result.error.issues.forEach(issue => ctx.addIssue(issue));
    return z.NEVER;
  }

  return result.data;
});

export const stepSchema: z.ZodType<Step> = z.lazy(() => stepSchemaInner) as z.ZodType<Step>;

export const workflowDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().optional(),
  payloadSchemaRef: z.string().min(1),
  trigger: z.object({
    type: z.literal('event'),
    eventName: z.string().min(1)
  }).optional(),
  steps: z.array(stepSchema)
}).strict();

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const envelopeErrorSchema = z.object({
  name: z.string().optional(),
  message: z.string(),
  stack: z.string().optional(),
  nodePath: z.string().optional(),
  at: z.string(),
  data: z.unknown().optional()
}).strict();

export const envelopeSchema = z.object({
  v: z.literal(1),
  run: z.object({
    id: z.string(),
    workflowId: z.string(),
    workflowVersion: z.number(),
    startedAt: z.string()
  }).strict(),
  payload: z.unknown(),
  meta: z.object({
    state: z.string().optional(),
    traceId: z.string().optional(),
    tags: z.record(z.string()).optional(),
    redactions: z.array(z.string()).optional()
  }).strict(),
  vars: z.record(z.unknown()),
  error: envelopeErrorSchema.optional()
}).strict();

export type Envelope = z.infer<typeof envelopeSchema>;

export type WorkflowTrigger = {
  type: 'event';
  eventName: string;
};

export type WorkflowRunStatus = 'RUNNING' | 'WAITING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
export type WorkflowRunStepStatus = 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'RETRY_SCHEDULED' | 'CANCELED';
export type WorkflowRunWaitType = 'event' | 'retry' | 'human' | 'timeout';

export type WorkflowErrorCategory =
  | 'ValidationError'
  | 'ExpressionError'
  | 'TransientError'
  | 'ActionError'
  | 'TimeoutError';

export type PublishError = {
  severity: 'error' | 'warning';
  stepPath: string;
  stepId?: string;
  code: string;
  message: string;
};
