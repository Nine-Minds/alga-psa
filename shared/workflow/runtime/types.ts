import { z } from 'zod';

export const exprSchema = z.object({
  $expr: z.string().min(1)
}).strict();

export type Expr = z.infer<typeof exprSchema>;

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

export const nodeStepSchema: z.ZodType<NodeStep> = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().optional(),
  config: z.unknown().optional(),
  retry: retryPolicySchema.optional(),
  onError: onErrorPolicySchema.optional()
}).strict();

export const ifBlockSchema: z.ZodType<IfBlock> = z.object({
  id: z.string().min(1),
  type: z.literal('control.if'),
  condition: exprSchema,
  then: z.array(z.lazy(() => stepSchema)),
  else: z.array(z.lazy(() => stepSchema)).optional()
}).strict();

export const forEachBlockSchema: z.ZodType<ForEachBlock> = z.object({
  id: z.string().min(1),
  type: z.literal('control.forEach'),
  items: exprSchema,
  itemVar: z.string().min(1),
  concurrency: z.number().int().positive().optional(),
  body: z.array(z.lazy(() => stepSchema)),
  onItemError: z.enum(['continue', 'fail']).optional()
}).strict();

export const tryCatchBlockSchema: z.ZodType<TryCatchBlock> = z.object({
  id: z.string().min(1),
  type: z.literal('control.tryCatch'),
  try: z.array(z.lazy(() => stepSchema)),
  catch: z.array(z.lazy(() => stepSchema)),
  captureErrorAs: z.string().min(1).optional()
}).strict();

export const callWorkflowBlockSchema: z.ZodType<CallWorkflowBlock> = z.object({
  id: z.string().min(1),
  type: z.literal('control.callWorkflow'),
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  inputMapping: z.record(exprSchema).optional(),
  outputMapping: z.record(exprSchema).optional(),
  retry: retryPolicySchema.optional(),
  onError: onErrorPolicySchema.optional()
}).strict();

export const returnStepSchema: z.ZodType<ReturnStep> = z.object({
  id: z.string().min(1),
  type: z.literal('control.return')
}).strict();

export const stepSchema: z.ZodType<Step> = z.lazy(() => z.union([
  nodeStepSchema,
  ifBlockSchema,
  forEachBlockSchema,
  tryCatchBlockSchema,
  callWorkflowBlockSchema,
  returnStepSchema
]));

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
