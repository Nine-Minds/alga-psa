import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionContext } from '../../../../../../shared/workflow/runtime/registries/actionRegistry';

vi.mock('@alga-psa/db/workDate', () => ({
  computeWorkDateFields: vi.fn(() => ({ localDate: '2026-01-01' })),
  resolveUserTimeZone: vi.fn(() => 'America/New_York'),
}));

const inference = { loaded: vi.fn(), run: vi.fn() };
const outputSchema = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
  additionalProperties: false,
};

const context: ActionContext = {
  runId: 'run-1',
  stepPath: 'root.steps[0]',
  stepConfig: {
    actionId: 'ai.infer',
    version: 1,
    aiOutputSchemaMode: 'simple',
    aiOutputSchema: outputSchema,
  },
  tenantId: 'tenant-1',
  idempotencyKey: 'idem-1',
  attempt: 1,
  nowIso: () => '2026-01-01T00:00:00.000Z',
  env: {},
};

describe('workflow runtime entrypoint boundaries', () => {
  beforeEach(() => {
    vi.resetModules();
    inference.loaded.mockClear();
    inference.run.mockReset();
    vi.doMock('../../../../../../packages/ee/src/services/workflowInferenceService', () => {
      inference.loaded();
      return { inferWorkflowStructuredOutput: inference.run };
    });
  });

  it('core initializes workflow actions without registering AI or loading its provider', async () => {
    const runtime = await import('../core');
    runtime.initializeWorkflowRuntimeV2();

    expect(runtime.isWorkflowRuntimeV2Initialized()).toBe(true);
    expect(runtime.getActionRegistryV2().get('ninjaone.devices.find', 1)).toBeDefined();
    expect(runtime.getActionRegistryV2().get('ai.infer', 1)).toBeUndefined();
    expect(inference.loaded).not.toHaveBeenCalled();
  }, 30_000);

  it.each(['bootstrap', 'worker'] as const)(
    '%s registers AI without loading its provider, then delegates inference on execution',
    async (entry) => {
      const runtime = await import(entry === 'bootstrap' ? '../bootstrap' : '../worker');
      runtime.initializeWorkflowRuntimeV2();
      runtime.initializeWorkflowRuntimeV2();

      expect(runtime.isWorkflowRuntimeV2Initialized()).toBe(true);
      const action = runtime.getActionRegistryV2().get('ai.infer', 1);
      expect(action).toBeDefined();
      expect(inference.loaded).not.toHaveBeenCalled();

      inference.run.mockResolvedValue({ summary: 'Ticket summary' });
      await expect(action!.handler({ prompt: 'Summarize this ticket.' }, context))
        .resolves.toEqual({ summary: 'Ticket summary' });

      expect(inference.loaded).toHaveBeenCalledOnce();
      expect(inference.run).toHaveBeenCalledWith({
        prompt: 'Summarize this ticket.',
        schema: outputSchema,
        tenantId: context.tenantId,
        runId: context.runId,
        stepPath: context.stepPath,
      });
    }
  );

  it.each(['bootstrap', 'worker'] as const)(
    '%s preserves AI provider failures on execution',
    async (entry) => {
      const unavailable = new Error('AI provider unavailable');
      inference.run.mockRejectedValue(unavailable);

      const runtime = await import(entry === 'bootstrap' ? '../bootstrap' : '../worker');
      runtime.initializeWorkflowRuntimeV2();

      expect(runtime.getActionRegistryV2().get('ninjaone.devices.find', 1)).toBeDefined();
      const action = runtime.getActionRegistryV2().get('ai.infer', 1);
      expect(action).toBeDefined();
      await expect(action!.handler({ prompt: 'Summarize this ticket.' }, context))
        .rejects.toBe(unavailable);
    }
  );
});
