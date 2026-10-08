import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getByIdMock } = vi.hoisted(() => ({ getByIdMock: vi.fn() }));

vi.mock('@alga-psa/workflows/persistence', () => ({
  WorkflowRunModelV2: { getById: getByIdMock },
}));

import {
  MAX_WORKFLOW_CAUSATION_DEPTH,
  evaluateWorkflowSelfTrigger,
} from '../workflowSelfTriggerGuard';

const knex = {} as any;
const tenant = 'tenant-1';

function run(workflowId: string, causationDepth?: unknown) {
  return {
    run_id: 'run-1',
    workflow_id: workflowId,
    trigger_metadata_json: causationDepth === undefined ? null : { causationDepth },
  };
}

describe('evaluateWorkflowSelfTrigger', () => {
  beforeEach(() => {
    getByIdMock.mockReset();
  });

  it('exposes a depth cap of 5', () => {
    expect(MAX_WORKFLOW_CAUSATION_DEPTH).toBe(5);
  });

  it.each([undefined, null, '', '   '])('allows at depth 0 with no origin run (%j)', async (origin) => {
    const decision = await evaluateWorkflowSelfTrigger(knex, {
      tenant,
      originExecutionId: origin as any,
      candidateWorkflowId: 'wf-a',
    });
    expect(decision).toEqual({ allow: true, causationDepth: 0 });
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  it('looks the origin run up by id within the tenant', async () => {
    getByIdMock.mockResolvedValue(run('wf-b'));
    await evaluateWorkflowSelfTrigger(knex, {
      tenant,
      originExecutionId: ' run-1 ',
      candidateWorkflowId: 'wf-a',
    });
    expect(getByIdMock).toHaveBeenCalledWith(knex, 'run-1', tenant);
  });

  it('skips with self_trigger when the origin run belongs to the same workflow', async () => {
    getByIdMock.mockResolvedValue(run('wf-a'));
    const decision = await evaluateWorkflowSelfTrigger(knex, {
      tenant,
      originExecutionId: 'run-1',
      candidateWorkflowId: 'wf-a',
    });
    expect(decision).toEqual({ allow: false, reason: 'self_trigger', causationDepth: 1 });
  });

  it('allows a different workflow with depth = origin depth + 1', async () => {
    getByIdMock.mockResolvedValue(run('wf-b', 2));
    const decision = await evaluateWorkflowSelfTrigger(knex, {
      tenant,
      originExecutionId: 'run-1',
      candidateWorkflowId: 'wf-a',
    });
    expect(decision).toEqual({ allow: true, causationDepth: 3 });
  });

  it('treats a missing or non-numeric causationDepth as 0', async () => {
    getByIdMock.mockResolvedValue(run('wf-b', 'nope'));
    expect(
      await evaluateWorkflowSelfTrigger(knex, { tenant, originExecutionId: 'r', candidateWorkflowId: 'wf-a' })
    ).toEqual({ allow: true, causationDepth: 1 });
  });

  it('allows the last permitted depth (origin 4 -> 5)', async () => {
    getByIdMock.mockResolvedValue(run('wf-b', MAX_WORKFLOW_CAUSATION_DEPTH - 1));
    const decision = await evaluateWorkflowSelfTrigger(knex, {
      tenant,
      originExecutionId: 'r',
      candidateWorkflowId: 'wf-a',
    });
    expect(decision).toEqual({ allow: true, causationDepth: MAX_WORKFLOW_CAUSATION_DEPTH });
  });

  it('skips with causation_depth_exceeded beyond the cap (origin 5 -> 6)', async () => {
    getByIdMock.mockResolvedValue(run('wf-b', MAX_WORKFLOW_CAUSATION_DEPTH));
    const decision = await evaluateWorkflowSelfTrigger(knex, {
      tenant,
      originExecutionId: 'r',
      candidateWorkflowId: 'wf-a',
    });
    expect(decision).toEqual({
      allow: false,
      reason: 'causation_depth_exceeded',
      causationDepth: MAX_WORKFLOW_CAUSATION_DEPTH + 1,
    });
  });

  it('reports self_trigger ahead of depth exceeded for the same workflow', async () => {
    getByIdMock.mockResolvedValue(run('wf-a', 9));
    const decision = await evaluateWorkflowSelfTrigger(knex, {
      tenant,
      originExecutionId: 'r',
      candidateWorkflowId: 'wf-a',
    });
    expect(decision).toMatchObject({ allow: false, reason: 'self_trigger' });
  });

  it('allows at depth 0 when the origin run is unknown (null)', async () => {
    getByIdMock.mockResolvedValue(null);
    expect(
      await evaluateWorkflowSelfTrigger(knex, { tenant, originExecutionId: 'ghost', candidateWorkflowId: 'wf-a' })
    ).toEqual({ allow: true, causationDepth: 0 });
  });

  it('allows at depth 0 when the lookup rejects', async () => {
    getByIdMock.mockRejectedValue(new Error('db down'));
    expect(
      await evaluateWorkflowSelfTrigger(knex, { tenant, originExecutionId: 'ghost', candidateWorkflowId: 'wf-a' })
    ).toEqual({ allow: true, causationDepth: 0 });
  });
});
