import { beforeEach, describe, expect, it, vi } from 'vitest';

const validateWorkflowDefinitionDraftAction = vi.fn();
const handleWorkflowV2ApiError = vi.fn((error: unknown) => new Response(JSON.stringify({ error: String(error) }), { status: 500 }));
const runWorkflowV2RouteWithAuth = vi.fn(async (_req: unknown, fn: () => Promise<unknown>) => fn());

vi.mock('@alga-psa/workflows/actions', () => ({
  validateWorkflowDefinitionDraftAction
}));

vi.mock('server/src/lib/api/workflowRuntimeV2Api', () => ({
  handleWorkflowV2ApiError,
  runWorkflowV2RouteWithAuth
}));

describe('workflow definition validate route', () => {
  beforeEach(() => {
    validateWorkflowDefinitionDraftAction.mockReset();
    handleWorkflowV2ApiError.mockClear();
    runWorkflowV2RouteWithAuth.mockClear();
  });

  it('forwards the request body to the validation action', async () => {
    validateWorkflowDefinitionDraftAction.mockResolvedValue({ ok: true, errors: [], warnings: [] });
    const { POST } = await import('server/src/app/api/workflow-definitions/validate/route');

    const res = await POST(new Request('http://example.com/api/workflow-definitions/validate', {
      method: 'POST',
      body: JSON.stringify({ definition: { name: 'Test' }, payloadSchemaMode: 'pinned' })
    }) as never);

    expect(runWorkflowV2RouteWithAuth).toHaveBeenCalledTimes(1);
    expect(validateWorkflowDefinitionDraftAction).toHaveBeenCalledWith({
      definition: { name: 'Test' },
      payloadSchemaMode: 'pinned'
    });
    expect(res.status).toBe(200);
  });

  it('routes failures through the shared api error handler', async () => {
    validateWorkflowDefinitionDraftAction.mockRejectedValue(new Error('boom'));
    const { POST } = await import('server/src/app/api/workflow-definitions/validate/route');

    await POST(new Request('http://example.com/api/workflow-definitions/validate', {
      method: 'POST',
      body: JSON.stringify({ definition: { name: 'Test' } })
    }) as never);

    expect(handleWorkflowV2ApiError).toHaveBeenCalled();
  });
});
