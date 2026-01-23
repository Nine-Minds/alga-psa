import { describe, it, expect, beforeAll, vi } from 'vitest';
import { z } from 'zod';
import {
  compileExpression,
  validateExpressionSource
} from '@shared/workflow/runtime/expressionEngine';
import { resolveExpressions } from '@shared/workflow/runtime/utils/expressionResolver';
import { applyAssignments } from '@shared/workflow/runtime/utils/assignmentUtils';
import { applyRedactions, enforceSnapshotSize } from '@shared/workflow/runtime/utils/redactionUtils';
import { computeBackoffMs } from '@shared/workflow/runtime/utils/retryUtils';
import { buildStepsPath, parseNodePath } from '@shared/workflow/runtime/utils/nodePathUtils';
import { validateWorkflowDefinition } from '@shared/workflow/runtime/validation/publishValidation';
import { getSchemaRegistry, getNodeTypeRegistry } from '@shared/workflow/runtime';
import { generateIdempotencyKey } from '@shared/workflow/runtime/utils/idempotencyUtils';
import { ensureWorkflowRuntimeV2TestRegistrations, TEST_SCHEMA_REF } from '../helpers/workflowRuntimeV2TestHelpers';

const baseEnv = {
  v: 1,
  run: {
    id: 'run-1',
    workflowId: 'wf-1',
    workflowVersion: 1,
    startedAt: new Date().toISOString()
  },
  payload: {
    foo: 'bar',
    value: 42,
    secretRef: 'super-secret',
    nested: { a: { b: 'c' } },
    list: [{ secretRef: 'abc' }]
  },
  meta: {},
  vars: {},
  error: undefined
};

beforeAll(() => {
  ensureWorkflowRuntimeV2TestRegistrations();
});

describe('workflow runtime v2 unit tests', () => {
  it('Expression engine evaluates a literal and returns a JSON-serializable value. Mocks: non-target dependencies.', async () => {
    const compiled = compileExpression({ $expr: '1' });
    const result = await compiled.evaluate({ payload: {}, vars: {}, meta: {} });
    expect(result).toBe(1);
  });

  it('Expression engine reads payload fields via path selectors. Mocks: non-target dependencies.', async () => {
    const compiled = compileExpression({ $expr: 'payload.foo' });
    const result = await compiled.evaluate({ payload: { foo: 'bar' }, vars: {}, meta: {} });
    expect(result).toBe('bar');
  });

  it('Expression engine reads vars/meta/error context values. Mocks: non-target dependencies.', async () => {
    const compiled = compileExpression({ $expr: 'vars.count & ":" & meta.state & ":" & error.message' });
    const result = await compiled.evaluate({
      payload: {},
      vars: { count: 2 },
      meta: { state: 'READY' },
      error: { message: 'oops' }
    });
    expect(result).toBe('2:READY:oops');
  });

  it('Expression engine exposes only allowlisted helpers (nowIso and safe helpers). Mocks: non-target dependencies.', async () => {
    const compiled = compileExpression({ $expr: 'len(payload.items) = 2 and toString(payload.num) = "7" and coalesce(payload.none, "ok") = "ok"' });
    const result = await compiled.evaluate({ payload: { items: [1, 2], num: 7 }, vars: {}, meta: {} });
    expect(result).toBe(true);
  });

  it('Expression engine rejects user-defined functions. Mocks: non-target dependencies.', () => {
    expect(() => compileExpression({ $expr: 'evil()' })).toThrow(/disallowed/i);
  });

  it('Expression engine blocks access to Node.js/global objects. Mocks: non-target dependencies.', async () => {
    const compiled = compileExpression({ $expr: 'process' });
    await expect(compiled.evaluate({ payload: {}, vars: {}, meta: {} })).rejects.toThrow(/not JSON-serializable/i);
  });

  it('Expression engine enforces evaluation timeout at 25ms. Mocks: non-target dependencies.', async () => {
    const compiled = compileExpression({ $expr: 'payload.foo' });
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(30);
    await expect(compiled.evaluate({ payload: { foo: 'bar' }, vars: {}, meta: {} })).rejects.toThrow(/exceeded/i);
    nowSpy.mockRestore();
  });

  it('Expression engine enforces max output size of 256KB. Mocks: non-target dependencies.', async () => {
    const bigValue = 'x'.repeat(300 * 1024);
    const compiled = compileExpression({ $expr: 'payload.big' });
    await expect(compiled.evaluate({ payload: { big: bigValue }, vars: {}, meta: {} })).rejects.toThrow(/max output size/i);
  });

  it('Expression engine rejects non-JSON-serializable outputs (e.g., Date/function). Mocks: non-target dependencies.', async () => {
    const compiled = compileExpression({ $expr: 'payload.fn' });
    await expect(compiled.evaluate({ payload: { fn: () => null }, vars: {}, meta: {} })).rejects.toThrow(/not JSON-serializable/i);
  });

  it('Expression engine compile fails on invalid syntax. Mocks: non-target dependencies.', () => {
    expect(() => validateExpressionSource('payload.')).toThrow();
  });

  it('Expression engine compile succeeds on valid syntax. Mocks: non-target dependencies.', () => {
    expect(() => validateExpressionSource('payload.foo')).not.toThrow();
  });

  it('Expression resolver evaluates Expr inside nested objects recursively. Mocks: non-target dependencies.', async () => {
    const result = await resolveExpressions({ a: { b: { $expr: 'payload.foo' } } }, { payload: { foo: 'bar' }, vars: {}, meta: {} });
    expect(result).toEqual({ a: { b: 'bar' } });
  });

  it('Expression resolver evaluates Expr inside arrays recursively. Mocks: non-target dependencies.', async () => {
    const result = await resolveExpressions([{ $expr: 'payload.foo' }, 2], { payload: { foo: 'bar' }, vars: {}, meta: {} });
    expect(result).toEqual(['bar', 2]);
  });

  it('Expression resolver leaves non-Expr values unchanged. Mocks: non-target dependencies.', async () => {
    const result = await resolveExpressions({ a: 1, b: 'x' }, { payload: {}, vars: {}, meta: {} });
    expect(result).toEqual({ a: 1, b: 'x' });
  });

  it('Transform assign applies multiple path updates atomically. Mocks: non-target dependencies.', () => {
    const updated = applyAssignments(baseEnv as any, {
      'payload.foo': 'baz',
      'vars.count': 3
    });
    expect(updated.payload.foo).toBe('baz');
    expect(updated.vars.count).toBe(3);
  });

  it('Transform assign rolls back all updates on any path failure. Mocks: non-target dependencies.', () => {
    const original = JSON.parse(JSON.stringify(baseEnv));
    expect(() => applyAssignments(baseEnv as any, {
      'payload.foo': 'baz',
      'bad.path': 'oops'
    })).toThrow(/Assignment path must be scoped/i);
    expect(baseEnv).toEqual(original);
  });

  it('Transform assign rejects writes to disallowed payload paths. Mocks: non-target dependencies.', () => {
    expect(() => applyAssignments(baseEnv as any, { 'bad.path': 'nope' })).toThrow(/Assignment path must be scoped/i);
  });

  it('Transform assign supports writing to vars paths. Mocks: non-target dependencies.', () => {
    const updated = applyAssignments(baseEnv as any, { 'vars.note': 'ok' });
    expect(updated.vars.note).toBe('ok');
  });

  it('Redaction masks JSON pointer fields in payload snapshots. Mocks: non-target dependencies.', () => {
    const result = applyRedactions({ secret: 'value', other: 'ok' }, ['/secret']);
    expect(result).toEqual({ secret: '[REDACTED]', other: 'ok' });
  });

  it('Redaction always masks secretRef fields regardless of pointer list. Mocks: non-target dependencies.', () => {
    const result = applyRedactions({ secretRef: 'token', nested: { secretRef: 'child' } }, []);
    expect(result).toEqual({ secretRef: '[REDACTED]', nested: { secretRef: '[REDACTED]' } });
  });

  it('Redaction handles arrays of objects without leaking secrets. Mocks: non-target dependencies.', () => {
    const result = applyRedactions([{ secretRef: 'token' }], []);
    expect(result).toEqual([{ secretRef: '[REDACTED]' }]);
  });

  it('Redaction handles deeply nested objects without errors. Mocks: non-target dependencies.', () => {
    const result = applyRedactions({ a: { b: { secretRef: 'token' } } }, ['/a/b/secretRef']);
    expect(result).toEqual({ a: { b: { secretRef: '[REDACTED]' } } });
  });

  it('Retry backoff computes delay using base and multiplier. Mocks: non-target dependencies.', () => {
    const delay = computeBackoffMs({ maxAttempts: 3, backoffMs: 100, backoffMultiplier: 2, jitter: false }, 2, () => 0.5);
    expect(delay).toBe(200);
  });

  it('Retry backoff applies jitter within expected bounds. Mocks: non-target dependencies.', () => {
    const delay = computeBackoffMs({ maxAttempts: 3, backoffMs: 100, jitter: true }, 1, () => 0);
    expect(delay).toBe(80);
  });

  it('Retry backoff caps delay at maxDelayMs. Mocks: non-target dependencies.', () => {
    const delay = computeBackoffMs({ maxAttempts: 3, backoffMs: 100, backoffMultiplier: 10, maxDelayMs: 150, jitter: false }, 3, () => 0.5);
    expect(delay).toBe(150);
  });

  it('Snapshot truncation enforces max size and adds truncation marker. Mocks: non-target dependencies.', () => {
    const big = { data: 'x'.repeat(300 * 1024) };
    const truncated = enforceSnapshotSize(big, 256 * 1024);
    expect((truncated as any).truncated).toBe(true);
  });

  it('Node path builder produces stable paths for nested steps. Mocks: non-target dependencies.', () => {
    const path = buildStepsPath('root.steps[0].then', 2);
    const segments = parseNodePath(path);
    expect(path).toBe('root.steps[0].then.steps[2]');
    expect(segments.length).toBeGreaterThan(0);
  });

  it('Workflow definition validation detects duplicate Step.id values. Mocks: non-target dependencies.', () => {
    const definition = {
      id: 'wf',
      version: 1,
      name: 'Dup',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [
        { id: 'dup', type: 'state.set', config: { state: 'A' } },
        { id: 'dup', type: 'state.set', config: { state: 'B' } }
      ]
    } as any;
    const result = validateWorkflowDefinition(definition);
    expect(result.ok).toBe(false);
    expect(result.errors.some((err) => err.code === 'DUPLICATE_STEP_ID')).toBe(true);
  });

  it('Schema registry resolves known refs and errors on unknown refs. Mocks: non-target dependencies.', () => {
    const registry = getSchemaRegistry();
    const ref = `payload.UnitTest.${Date.now()}`;
    registry.register(ref, z.object({ foo: z.string() }));
    expect(registry.get(ref)).toBeDefined();
    expect(() => registry.get(`${ref}.missing`)).toThrow();
  });

  it('Zod-to-JSON schema conversion produces required fields list. Mocks: non-target dependencies.', () => {
    const registry = getSchemaRegistry();
    const ref = `payload.UnitTestRequired.${Date.now()}`;
    registry.register(ref, z.object({ foo: z.string(), bar: z.number().optional() }));
    const schema = registry.toJsonSchema(ref) as {
      required?: string[];
      $ref?: string;
      definitions?: Record<string, { required?: string[] }>;
    };
    const definitionKey = schema.$ref?.replace('#/definitions/', '');
    const required = schema.required ?? (definitionKey ? schema.definitions?.[definitionKey]?.required : undefined);
    expect(required).toContain('foo');
  });

  it('Publish validation error formatting includes stepPath and message. Mocks: non-target dependencies.', () => {
    const definition = {
      id: 'wf',
      version: 1,
      name: 'Invalid',
      payloadSchemaRef: TEST_SCHEMA_REF,
      steps: [
        { id: 'step-1', type: 'unknown.node', config: {} }
      ]
    } as any;
    const result = validateWorkflowDefinition(definition);
    expect(result.ok).toBe(false);
    expect(result.errors[0].stepPath).toBe('root.steps[0]');
    expect(result.errors[0].message).toMatch(/Unknown node type/i);
  });

  it('Idempotency key normalization is stable for identical inputs. Mocks: non-target dependencies.', () => {
    const key1 = generateIdempotencyKey('run', 'root.steps[0]', 'test.echo', 1, { value: 1 });
    const key2 = generateIdempotencyKey('run', 'root.steps[0]', 'test.echo', 1, { value: 1 });
    expect(key1).toBe(key2);
  });

  it('State.set handler writes meta.state consistently. Mocks: non-target dependencies.', async () => {
    const registry = getNodeTypeRegistry();
    const node = registry.get('state.set');
    if (!node) throw new Error('state.set not registered');
    const env = { ...baseEnv, meta: {} } as any;
    const result = await node.handler(env, { state: 'READY' }, {} as any);
    expect(result.meta.state).toBe('READY');
  });
});
