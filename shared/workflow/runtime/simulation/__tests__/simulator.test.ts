import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerDefaultNodes } from '../../nodes/registerDefaultNodes';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { getNodeTypeRegistry } from '../../registries/nodeTypeRegistry';
import { runWithEvaluationRequestBudget } from '../../expressionEngine';
import { applyTriggerPayloadMapping, simulateWorkflowDefinition } from '../simulator';
import { buildSampleFromJsonSchema } from '../samplePayload';
import type { WorkflowDefinition } from '../../types';
import {
  EvaluationBusyError,
  getExpressionAdmissionStats,
  resetExpressionAdmission,
  runWithAdmission,
} from '../../expressionEngine';

const baseDefinition = (steps: unknown[]): WorkflowDefinition => ({
  id: 'wf-sim-test',
  version: 1,
  name: 'Simulator test workflow',
  payloadSchemaRef: 'payload.SimulatorTest.v1',
  steps: steps as WorkflowDefinition['steps'],
});

beforeAll(() => {
  if (!getNodeTypeRegistry().get('action.call')) {
    registerDefaultNodes();
  }
  const actions = getActionRegistryV2();
  if (!actions.get('test.echo', 1)) {
    actions.register({
      id: 'test.echo',
      version: 1,
      sideEffectful: false,
      idempotency: { mode: 'engineProvided' },
      inputSchema: z.object({ value: z.string().optional() }),
      outputSchema: z.object({ ok: z.boolean(), echoed: z.string(), count: z.number() }),
      handler: async () => {
        throw new Error('test.echo must never execute during simulation');
      },
    });
  }
});

describe('simulateWorkflowDefinition control flow', () => {
  it('takes the then branch and records it', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        {
          id: 'branch',
          type: 'control.if',
          condition: { $expr: 'payload.amount > 10' },
          then: [{ id: 'assign-then', type: 'transform.assign', config: { assign: { 'vars.branch': { $expr: '"then"' } } } }],
          else: [{ id: 'assign-else', type: 'transform.assign', config: { assign: { 'vars.branch': { $expr: '"else"' } } } }],
        },
      ]),
      payload: { amount: 25 },
    });

    expect(result.status).toBe('completed');
    expect(result.finalVars.branch).toBe('then');
    const branchEntry = result.trace.find((entry) => entry.stepId === 'branch');
    expect(branchEntry?.branchTaken).toBe('then');
    expect(result.trace.some((entry) => entry.stepId === 'assign-else')).toBe(false);
  });

  it('takes the else branch when the condition is false', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        {
          id: 'branch',
          type: 'control.if',
          condition: { $expr: 'payload.amount > 10' },
          then: [{ id: 'assign-then', type: 'transform.assign', config: { assign: { 'vars.branch': { $expr: '"then"' } } } }],
          else: [{ id: 'assign-else', type: 'transform.assign', config: { assign: { 'vars.branch': { $expr: '"else"' } } } }],
        },
      ]),
      payload: { amount: 5 },
    });

    expect(result.status).toBe('completed');
    expect(result.finalVars.branch).toBe('else');
  });

  it('fails when the condition is not boolean, matching interpreter semantics', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        { id: 'branch', type: 'control.if', condition: { $expr: 'payload.amount' }, then: [] },
      ]),
      payload: { amount: 5 },
    });

    expect(result.status).toBe('failed');
    expect(result.errors[0]?.message).toContain('must evaluate to a boolean');
  });

  it('iterates forEach exposing the itemVar in vars and loop locals to control-flow expressions', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        { id: 'seed', type: 'transform.assign', config: { assign: { 'vars.entry': { $expr: '"preserved"' }, 'vars.collected': { $expr: '[]' } } } },
        {
          id: 'loop',
          type: 'control.forEach',
          items: { $expr: 'payload.items' },
          itemVar: 'entry',
          body: [
            {
              // Bare loop locals (entry/index/isLast) resolve in control-flow
              // expression contexts, exactly like the Temporal interpreter.
              id: 'mark-last',
              type: 'control.if',
              condition: { $expr: 'isLast and entry = "c" and index = 2' },
              then: [{ id: 'saw-last', type: 'transform.assign', config: { assign: { 'vars.sawLast': { $expr: 'true' } } } }],
            },
            {
              // Node handlers see the itemVar through vars.*, not as a bare local.
              id: 'collect',
              type: 'transform.assign',
              config: { assign: { 'vars.collected': { $expr: 'append(vars.collected, vars.entry)' } } },
            },
          ],
        },
      ]),
      payload: { items: ['a', 'b', 'c'] },
    });

    expect(result.status).toBe('completed');
    expect(result.finalVars.collected).toEqual(['a', 'b', 'c']);
    expect(result.finalVars.sawLast).toBe(true);
    expect(result.finalVars.entry).toBe('preserved');
    expect(result.finalVars.__forEach).toBeUndefined();
  });

  it('enforces the forEach iteration budget', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        {
          id: 'loop',
          type: 'control.forEach',
          items: { $expr: 'payload.items' },
          itemVar: 'entry',
          body: [{ id: 'noop', type: 'transform.assign', config: { assign: { 'vars.last': { $expr: 'entry' } } } }],
        },
      ]),
      payload: { items: [1, 2, 3, 4, 5] },
      options: { maxForEachIterations: 3 },
    });

    expect(result.status).toBe('failed');
    expect(result.errors[0]?.message).toContain('iteration budget');
  });

  it('continues past failed iterations when onItemError is continue', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        { id: 'seed', type: 'transform.assign', config: { assign: { 'vars.done': { $expr: '[]' } } } },
        {
          id: 'loop',
          type: 'control.forEach',
          items: { $expr: 'payload.items' },
          itemVar: 'entry',
          onItemError: 'continue',
          body: [
            {
              id: 'guarded',
              type: 'control.if',
              condition: { $expr: 'entry = "bad"' },
              then: [
                {
                  id: 'boom',
                  type: 'action.call',
                  config: { actionId: 'test.echo', version: 1, inputMapping: {} },
                },
              ],
              else: [
                { id: 'record', type: 'transform.assign', config: { assign: { 'vars.done': { $expr: 'append(vars.done, vars.entry)' } } } },
              ],
            },
          ],
        },
      ]),
      payload: { items: ['ok1', 'bad', 'ok2'] },
      fixtures: { boom: { $error: { message: 'synthetic action failure' } } },
    });

    expect(result.status).toBe('completed');
    expect(result.finalVars.done).toEqual(['ok1', 'ok2']);
    expect(result.trace.some((entry) => entry.handledBy === 'forEach-continue')).toBe(true);
  });

  it('routes failures in try to catch and captures the error', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        {
          id: 'guard',
          type: 'control.tryCatch',
          captureErrorAs: 'caught',
          try: [
            { id: 'boom', type: 'action.call', config: { actionId: 'test.echo', version: 1, inputMapping: {} } },
            { id: 'unreached', type: 'transform.assign', config: { assign: { 'vars.unreached': { $expr: 'true' } } } },
          ],
          catch: [
            { id: 'recover', type: 'transform.assign', config: { assign: { 'vars.recovered': { $expr: 'true' } } } },
          ],
        },
      ]),
      fixtures: { boom: { $error: { message: 'synthetic failure', category: 'ActionError' } } },
    });

    expect(result.status).toBe('completed');
    expect(result.finalVars.recovered).toBe(true);
    expect(result.finalVars.unreached).toBeUndefined();
    expect((result.finalVars.caught as Record<string, unknown>).message).toBe('synthetic failure');
  });

  it('stops at control.return and skips later steps', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        { id: 'first', type: 'transform.assign', config: { assign: { 'vars.first': { $expr: 'true' } } } },
        { id: 'stop', type: 'control.return' },
        { id: 'after', type: 'transform.assign', config: { assign: { 'vars.after': { $expr: 'true' } } } },
      ]),
    });

    expect(result.status).toBe('completed');
    expect(result.finalVars.first).toBe(true);
    expect(result.finalVars.after).toBeUndefined();
  });

  it('enforces the total step budget', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        {
          id: 'loop',
          type: 'control.forEach',
          items: { $expr: 'payload.items' },
          itemVar: 'entry',
          body: [{ id: 'work', type: 'transform.assign', config: { assign: { 'vars.last': { $expr: 'vars.entry' } } } }],
        },
      ]),
      payload: { items: Array.from({ length: 50 }, (_, i) => i) },
      options: { maxSteps: 10 },
    });

    expect(result.status).toBe('failed');
    expect(result.errors[0]?.message).toContain('maximum of 10 steps');
  });
});

describe('simulateWorkflowDefinition action stubbing', () => {
  it('prefers a step-id fixture, evaluates the real input mapping, and honors saveAs', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        {
          id: 'call',
          type: 'action.call',
          config: {
            actionId: 'test.echo',
            version: 1,
            inputMapping: { value: { $expr: 'payload.name & "!"' } },
            saveAs: 'vars.echoResult',
          },
        },
      ]),
      payload: { name: 'alga' },
      fixtures: { call: { ok: true, echoed: 'fixture', count: 7 } },
    });

    expect(result.status).toBe('completed');
    expect(result.finalVars.echoResult).toEqual({ ok: true, echoed: 'fixture', count: 7 });
    expect(result.invocations).toHaveLength(1);
    expect(result.invocations[0]).toMatchObject({
      actionId: 'test.echo',
      input: { value: 'alga!' },
      outputSource: 'fixture',
    });
  });

  it('falls back to an actionId fixture', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        { id: 'call', type: 'action.call', config: { actionId: 'test.echo', version: 1, saveAs: 'vars.out' } },
      ]),
      fixtures: { 'test.echo': { ok: true, echoed: 'by-action-id', count: 1 } },
    });

    expect(result.status).toBe('completed');
    expect((result.finalVars.out as Record<string, unknown>).echoed).toBe('by-action-id');
  });

  it('falls back to a schema-shaped placeholder when no fixture exists', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        { id: 'call', type: 'action.call', config: { actionId: 'test.echo', version: 1, saveAs: 'vars.out' } },
      ]),
    });

    expect(result.status).toBe('completed');
    expect(result.invocations[0]?.outputSource).toBe('schema');
    const out = result.finalVars.out as Record<string, unknown>;
    expect(typeof out.ok).toBe('boolean');
    expect(typeof out.echoed).toBe('string');
    expect(typeof out.count).toBe('number');
  });

  it('stubs {} with a warning for unknown actions', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        { id: 'call', type: 'action.call', config: { actionId: 'test.unknown', version: 1, saveAs: 'vars.out' } },
      ]),
    });

    expect(result.status).toBe('completed');
    expect(result.finalVars.out).toEqual({});
    expect(result.invocations[0]?.outputSource).toBe('empty');
    expect(result.warnings.some((warning) => warning.message.includes('test.unknown'))).toBe(true);
  });

  it('honors onError continue for failing actions', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        {
          id: 'boom',
          type: 'action.call',
          config: { actionId: 'test.echo', version: 1, onError: { policy: 'continue' } },
        },
        { id: 'after', type: 'transform.assign', config: { assign: { 'vars.after': { $expr: 'true' } } } },
      ]),
      fixtures: { boom: { $error: { message: 'continues anyway' } } },
    });

    expect(result.status).toBe('completed');
    expect(result.finalVars.after).toBe(true);
    expect(result.trace.some((entry) => entry.handledBy === 'onError-continue')).toBe(true);
  });

  it('resolves $secret references to placeholders with a warning', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        {
          id: 'call',
          type: 'action.call',
          config: {
            actionId: 'test.echo',
            version: 1,
            inputMapping: { value: { $secret: 'API_KEY' } },
            saveAs: 'vars.out',
          },
        },
      ]),
      fixtures: { call: { ok: true, echoed: 'x', count: 0 } },
    });

    expect(result.status).toBe('completed');
    expect(result.invocations[0]?.input).toEqual({ value: '[simulated-secret:API_KEY]' });
    expect(result.warnings.some((warning) => warning.message.includes('API_KEY'))).toBe(true);
  });
});

describe('simulateWorkflowDefinition waits and child workflows', () => {
  it('pauses at event.wait without a fixture', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        {
          id: 'wait',
          type: 'event.wait',
          config: { eventName: 'TICKET_UPDATED', correlationKey: { $expr: 'payload.ticketId' } },
        },
        { id: 'after', type: 'transform.assign', config: { assign: { 'vars.after': { $expr: 'true' } } } },
      ]),
      payload: { ticketId: 't-1' },
    });

    expect(result.status).toBe('paused-at-wait');
    expect(result.finalVars.after).toBeUndefined();
    expect(result.trace.find((entry) => entry.stepId === 'wait')?.outcome).toBe('would-wait');
  });

  it('resumes event.wait from a fixture and applies assign', async () => {
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        {
          id: 'wait',
          type: 'event.wait',
          config: {
            eventName: 'TICKET_UPDATED',
            correlationKey: { $expr: 'payload.ticketId' },
            assign: { 'vars.newStatus': { $expr: 'vars.event.status' } },
          },
        },
      ]),
      payload: { ticketId: 't-1' },
      fixtures: { wait: { status: 'closed' } },
    });

    expect(result.status).toBe('completed');
    expect(result.finalVars.eventName).toBe('TICKET_UPDATED');
    expect(result.finalVars.newStatus).toBe('closed');
  });

  it('pauses at control.callWorkflow without a fixture and applies outputMapping with one', async () => {
    const definition = baseDefinition([
      {
        id: 'child',
        type: 'control.callWorkflow',
        workflowId: 'child-wf',
        workflowVersion: 2,
        inputMapping: { ticketId: { $expr: 'payload.ticketId' } },
        outputMapping: { 'vars.childScore': { $expr: 'childRun.vars.score' } },
      },
    ]);

    const paused = await simulateWorkflowDefinition({ definition, payload: { ticketId: 't-9' } });
    expect(paused.status).toBe('paused-at-wait');

    const resumed = await simulateWorkflowDefinition({
      definition,
      payload: { ticketId: 't-9' },
      fixtures: { child: { vars: { score: 42 } } },
    });
    expect(resumed.status).toBe('completed');
    expect(resumed.finalVars.childScore).toBe(42);
    expect(resumed.trace.find((entry) => entry.stepId === 'child')?.evaluatedInput).toEqual({ ticketId: 't-9' });
  });
});

describe('applyTriggerPayloadMapping', () => {
  it('maps event payload into the workflow payload with dotted-key expansion', async () => {
    const definition: WorkflowDefinition = {
      ...baseDefinition([]),
      trigger: {
        type: 'event',
        eventName: 'TICKET_CREATED',
        payloadMapping: {
          'ticket.id': { $expr: 'event.payload.ticketId' },
          'ticket.from': { $expr: 'event.payload.requesterEmail' },
          eventName: { $expr: 'event.name' },
        },
      },
    };

    const mapped = await applyTriggerPayloadMapping({
      definition,
      eventName: 'TICKET_CREATED',
      eventPayload: { ticketId: 't-42', requesterEmail: 'bob@customer.com' },
    });

    expect(mapped.mappingApplied).toBe(true);
    expect(mapped.payload).toEqual({
      ticket: { id: 't-42', from: 'bob@customer.com' },
      eventName: 'TICKET_CREATED',
    });
  });

  it('passes the payload through when there is no mapping', async () => {
    const mapped = await applyTriggerPayloadMapping({
      definition: baseDefinition([]),
      eventName: 'TICKET_CREATED',
      eventPayload: { ticketId: 't-42' },
    });
    expect(mapped.mappingApplied).toBe(false);
    expect(mapped.payload).toEqual({ ticketId: 't-42' });
  });
});

describe('buildSampleFromJsonSchema', () => {
  it('synthesizes format-aware values for object schemas', () => {
    const sample = buildSampleFromJsonSchema({
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        email: { type: 'string', format: 'email' },
        status: { type: 'string', enum: ['open', 'closed'] },
        count: { type: 'integer' },
        nested: { type: 'object', properties: { flag: { type: 'boolean' } } },
        tags: { type: 'array', items: { type: 'string' } },
      },
    }) as Record<string, unknown>;

    expect(sample.id).toBe('00000000-0000-0000-0000-000000000000');
    expect(sample.email).toBe('sample@example.com');
    expect(sample.status).toBe('open');
    expect(sample.count).toBe(0);
    expect(sample.nested).toEqual({ flag: false });
    expect(sample.tags).toEqual(['sample-string']);
  });
});

describe('simulateWorkflowDefinition expression admission', () => {
  afterEach(() => resetExpressionAdmission());

  const tryCatchAround = (steps: unknown[]) =>
    baseDefinition([{ id: 'guard', type: 'control.tryCatch', try: steps, catch: [] }]);

  it('fails closed with EvaluationBusyError (not a step failure) when no evaluation slot frees up', async () => {
    resetExpressionAdmission({ maxConcurrency: 1, queueTimeoutMs: 20 });
    let release!: () => void;
    const holder = runWithAdmission({}, () => new Promise<void>((resolve) => (release = resolve)));
    expect(getExpressionAdmissionStats().active).toBe(1);

    // Wrapped in tryCatch on purpose: a busy evaluator must not be swallowed as an ordinary ExpressionError.
    await expect(
      simulateWorkflowDefinition({
        definition: tryCatchAround([
          { id: 'assign', type: 'transform.assign', config: { assign: { 'vars.x': { $expr: '1 + 1' } } } },
        ]),
        payload: {},
      })
    ).rejects.toBeInstanceOf(EvaluationBusyError);

    release();
    await holder;
    expect(getExpressionAdmissionStats().active).toBe(0);
  });

  it('simulates normally and returns every slot when capacity is available', async () => {
    resetExpressionAdmission({ maxConcurrency: 1, queueTimeoutMs: 20 });
    const result = await simulateWorkflowDefinition({
      definition: baseDefinition([
        { id: 'a', type: 'transform.assign', config: { assign: { 'vars.x': { $expr: '1 + 1' } } } },
        { id: 'b', type: 'transform.assign', config: { assign: { 'vars.y': { $expr: 'vars.x + 1' } } } },
      ]),
      payload: {},
    });
    expect(result.status).toBe('completed');
    expect(result.finalVars).toMatchObject({ x: 2, y: 3 });
    expect(getExpressionAdmissionStats().active).toBe(0);
  });
});

describe('simulateWorkflowDefinition request-level expression ceiling', () => {
  afterEach(() => resetExpressionAdmission());

  it('ends a simulation that loops over many cheap expressions with an ExpressionError step failure (not a 429)', async () => {
    let cpu = 0;
    const result = await runWithEvaluationRequestBudget(
      { cpuBudgetMs: 100, wallBudgetMs: 60_000, cpuNow: () => (cpu += 10) },
      () =>
        simulateWorkflowDefinition({
          definition: baseDefinition([
            {
              id: 'loop',
              type: 'control.forEach',
              items: { $expr: 'payload.items' },
              itemVar: 'item',
              body: [{ id: 'assign', type: 'transform.assign', config: { assign: { 'vars.x': { $expr: '1 + 1' } } } }],
            },
          ]),
          payload: { items: Array.from({ length: 90 }, (_, i) => i) },
        })
    );
    expect(result.status).toBe('failed');
    // surfaced as a failed step with the budget message, exactly like any other expression error
    expect(result.errors[0]?.message).toMatch(/Request expression budget exceeded/);
    expect(result.trace.some((entry: any) => entry.outcome === 'error')).toBe(true);
  });
});
