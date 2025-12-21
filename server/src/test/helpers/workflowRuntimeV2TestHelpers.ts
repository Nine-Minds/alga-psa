import { z } from 'zod';
import {
  initializeWorkflowRuntimeV2,
  getActionRegistryV2,
  getNodeTypeRegistry,
  getSchemaRegistry,
  type RetryPolicy,
  type Step,
  type WorkflowDefinition
} from '@shared/workflow/runtime';

export const TEST_SCHEMA_REF = 'payload.TestPayload.v1';

export const TEST_SCHEMA = z.object({
  foo: z.string().optional(),
  bar: z.number().optional(),
  items: z.array(z.any()).optional(),
  email: z.record(z.any()).optional(),
  secretRef: z.string().optional(),
  nested: z.record(z.any()).optional()
}).passthrough();

let sideEffectCount = 0;
const retryAttempts = new Map<string, number>();

export function resetTestActionState(): void {
  sideEffectCount = 0;
  retryAttempts.clear();
}

export function getSideEffectCount(): number {
  return sideEffectCount;
}

export function ensureWorkflowRuntimeV2TestRegistrations(): void {
  initializeWorkflowRuntimeV2();

  const schemaRegistry = getSchemaRegistry();
  if (!schemaRegistry.has(TEST_SCHEMA_REF)) {
    schemaRegistry.register(TEST_SCHEMA_REF, TEST_SCHEMA);
  }

  const actionRegistry = getActionRegistryV2();

  if (!actionRegistry.get('test.echo', 1)) {
    actionRegistry.register({
      id: 'test.echo',
      version: 1,
      inputSchema: z.object({ value: z.any() }),
      outputSchema: z.object({ value: z.any() }),
      sideEffectful: false,
      idempotency: { mode: 'engineProvided' },
      ui: { label: 'Test Echo', category: 'Test' },
      handler: async (input) => ({ value: input.value })
    });
  }

  if (!actionRegistry.get('test.sideEffect', 1)) {
    actionRegistry.register({
      id: 'test.sideEffect',
      version: 1,
      inputSchema: z.object({ label: z.string().optional() }),
      outputSchema: z.object({ count: z.number() }),
      sideEffectful: true,
      idempotency: { mode: 'engineProvided' },
      ui: { label: 'Test Side Effect', category: 'Test' },
      handler: async () => {
        sideEffectCount += 1;
        return { count: sideEffectCount };
      }
    });
  }

  if (!actionRegistry.get('test.actionProvided', 1)) {
    actionRegistry.register({
      id: 'test.actionProvided',
      version: 1,
      inputSchema: z.object({ key: z.string(), value: z.any().optional() }),
      outputSchema: z.object({ key: z.string(), value: z.any().optional() }),
      sideEffectful: true,
      idempotency: {
        mode: 'actionProvided',
        key: (input, ctx) => `${ctx.runId}:${input.key}`
      },
      ui: { label: 'Test Action Provided', category: 'Test' },
      handler: async (input) => ({ key: input.key, value: input.value })
    });
  }

  if (!actionRegistry.get('test.fail', 1)) {
    actionRegistry.register({
      id: 'test.fail',
      version: 1,
      inputSchema: z.object({ message: z.string().optional() }),
      outputSchema: z.object({ ok: z.boolean() }).optional(),
      sideEffectful: false,
      idempotency: { mode: 'engineProvided' },
      ui: { label: 'Test Fail', category: 'Test' },
      handler: async (input) => {
        throw new Error(input.message ?? 'forced failure');
      }
    });
  }

  if (!actionRegistry.get('test.retryable', 1)) {
    actionRegistry.register({
      id: 'test.retryable',
      version: 1,
      inputSchema: z.object({ key: z.string() }),
      outputSchema: z.object({ ok: z.boolean(), attempts: z.number() }),
      sideEffectful: true,
      idempotency: { mode: 'engineProvided' },
      ui: { label: 'Test Retryable', category: 'Test' },
      handler: async (input, ctx) => {
        const attemptKey = `${ctx.idempotencyKey}:${input.key}`;
        const attempt = (retryAttempts.get(attemptKey) ?? 0) + 1;
        retryAttempts.set(attemptKey, attempt);
        if (attempt < 2) {
          throw new Error('transient failure');
        }
        return { ok: true, attempts: attempt };
      }
    });
  }

  const nodeRegistry = getNodeTypeRegistry();
  if (!nodeRegistry.get('test.retryNode')) {
    nodeRegistry.register({
      id: 'test.retryNode',
      configSchema: z.object({
        key: z.string(),
        failCount: z.number().int().positive().optional().default(1)
      }),
      defaultRetry: {
        maxAttempts: 2,
        backoffMs: 10,
        retryOn: ['TransientError']
      },
      handler: async (env, config) => {
        const counterKey = `node:${config.key}`;
        const attempt = (retryAttempts.get(counterKey) ?? 0) + 1;
        retryAttempts.set(counterKey, attempt);
        if (attempt <= config.failCount) {
          throw { category: 'TransientError', message: 'retryable failure' };
        }
        return env;
      },
      ui: { label: 'Test Retry Node', category: 'Test' }
    });
  }
}

export function buildWorkflowDefinition(params: {
  name?: string;
  version?: number;
  payloadSchemaRef?: string;
  trigger?: WorkflowDefinition['trigger'];
  steps: Step[];
}): Omit<WorkflowDefinition, 'id'> {
  return {
    version: params.version ?? 1,
    name: params.name ?? 'Test Workflow',
    description: 'Test workflow',
    payloadSchemaRef: params.payloadSchemaRef ?? TEST_SCHEMA_REF,
    trigger: params.trigger,
    steps: params.steps
  };
}

export function actionCallStep(params: {
  id: string;
  actionId: string;
  version?: number;
  args: Record<string, unknown>;
  saveAs?: string;
  onError?: { policy: 'fail' | 'continue' };
  idempotencyKeyExpr?: { $expr: string };
  retry?: RetryPolicy;
}): Step {
  return {
    id: params.id,
    type: 'action.call',
    retry: params.retry,
    config: {
      actionId: params.actionId,
      version: params.version ?? 1,
      args: params.args,
      saveAs: params.saveAs,
      onError: params.onError,
      idempotencyKey: params.idempotencyKeyExpr
    }
  } as Step;
}

export function assignStep(id: string, assign: Record<string, { $expr: string }>): Step {
  return {
    id,
    type: 'transform.assign',
    config: { assign }
  } as Step;
}

export function stateSetStep(id: string, state: string): Step {
  return {
    id,
    type: 'state.set',
    config: { state }
  } as Step;
}

export function eventWaitStep(id: string, params: {
  eventName: string;
  correlationKeyExpr: { $expr: string };
  timeoutMs?: number;
  assign?: Record<string, { $expr: string }>;
}): Step {
  return {
    id,
    type: 'event.wait',
    config: {
      eventName: params.eventName,
      correlationKey: params.correlationKeyExpr,
      timeoutMs: params.timeoutMs,
      assign: params.assign
    }
  } as Step;
}

export function ifStep(id: string, condition: { $expr: string }, thenSteps: Step[], elseSteps?: Step[]): Step {
  return {
    id,
    type: 'control.if',
    condition,
    then: thenSteps,
    else: elseSteps
  } as Step;
}

export function forEachStep(id: string, params: { items: { $expr: string }; itemVar: string; body: Step[]; onItemError?: 'continue' | 'fail'; }): Step {
  return {
    id,
    type: 'control.forEach',
    items: params.items,
    itemVar: params.itemVar,
    body: params.body,
    onItemError: params.onItemError
  } as Step;
}

export function tryCatchStep(id: string, params: { trySteps: Step[]; catchSteps: Step[]; captureErrorAs?: string; }): Step {
  return {
    id,
    type: 'control.tryCatch',
    try: params.trySteps,
    catch: params.catchSteps,
    captureErrorAs: params.captureErrorAs
  } as Step;
}

export function callWorkflowStep(id: string, params: { workflowId: string; workflowVersion: number; inputMapping?: Record<string, { $expr: string }>; outputMapping?: Record<string, { $expr: string }>; }): Step {
  return {
    id,
    type: 'control.callWorkflow',
    workflowId: params.workflowId,
    workflowVersion: params.workflowVersion,
    inputMapping: params.inputMapping,
    outputMapping: params.outputMapping
  } as Step;
}

export function returnStep(id: string): Step {
  return {
    id,
    type: 'control.return'
  } as Step;
}
