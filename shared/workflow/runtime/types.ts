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
  retryOn: z.array(z.string()).optional()
}).strict();

export type RetryPolicy = z.infer<typeof retryPolicySchema>;

export const onErrorPolicySchema = z.object({
  policy: z.enum(['fail', 'continue'])
}).strict();

export type OnErrorPolicy = z.infer<typeof onErrorPolicySchema>;

export const nodeStepSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().optional(),
  config: z.unknown().optional(),
  retry: retryPolicySchema.optional(),
  onError: onErrorPolicySchema.optional()
}).strict();

export const ifBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal('control.if'),
  condition: exprSchema,
  then: z.array(z.lazy(() => stepSchema)),
  else: z.array(z.lazy(() => stepSchema)).optional()
}).strict();

export const forEachBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal('control.forEach'),
  items: exprSchema,
  itemVar: z.string().min(1),
  concurrency: z.number().int().positive().optional(),
  body: z.array(z.lazy(() => stepSchema)),
  onItemError: z.enum(['continue', 'fail']).optional()
}).strict();

export const tryCatchBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal('control.tryCatch'),
  try: z.array(z.lazy(() => stepSchema)),
  catch: z.array(z.lazy(() => stepSchema)),
  captureErrorAs: z.string().min(1).optional()
}).strict();

export const callWorkflowBlockSchema = z.object({
  id: z.string().min(1),
  type: z.literal('control.callWorkflow'),
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  inputMapping: z.record(exprSchema).optional(),
  outputMapping: z.record(exprSchema).optional()
}).strict();

export const returnStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('control.return')
}).strict();

export const stepSchema = z.lazy(() => z.union([
  nodeStepSchema,
  ifBlockSchema,
  forEachBlockSchema,
  tryCatchBlockSchema,
  callWorkflowBlockSchema,
  returnStepSchema
]));

export type NodeStep = z.infer<typeof nodeStepSchema>;
export type IfBlock = z.infer<typeof ifBlockSchema>;
export type ForEachBlock = z.infer<typeof forEachBlockSchema>;
export type TryCatchBlock = z.infer<typeof tryCatchBlockSchema>;
export type CallWorkflowBlock = z.infer<typeof callWorkflowBlockSchema>;
export type ReturnStep = z.infer<typeof returnStepSchema>;
export type Step = z.infer<typeof stepSchema>;

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
