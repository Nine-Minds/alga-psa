import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ ce: vi.fn(), ee: vi.fn(), ceNotify: vi.fn(), eeNotify: vi.fn() }));
vi.mock('../../../../packages/ee/src/services/chatProviderResolver', () => ({ resolveChatProvider: mocks.ce }));
vi.mock('../../../../ee/server/src/services/chatProviderResolver', () => ({ resolveChatProvider: mocks.ee }));
vi.mock('../../../../packages/ee/src/lib/aiGateway/notifications', () => ({ notifyAiCreditsUnavailable: mocks.ceNotify }));
vi.mock('../../../../ee/server/src/lib/aiGateway/notifications', () => ({ notifyAiCreditsUnavailable: mocks.eeNotify }));
import { inferWorkflowStructuredOutput as ce } from '../../../../packages/ee/src/services/workflowInferenceService';
import { inferWorkflowStructuredOutput as ee } from '../../../../ee/server/src/services/workflowInferenceService';

const request = { tenantId: 'edition-tenant', runId: 'run', stepPath: 'root.ai', prompt: 'Return success',
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } };
beforeEach(() => vi.resetAllMocks());
describe.each([
  { edition: 'CE', infer: ce, resolve: mocks.ce, other: mocks.ee, notify: mocks.ceNotify, otherNotify: mocks.eeNotify },
  { edition: 'EE', infer: ee, resolve: mocks.ee, other: mocks.ce, notify: mocks.eeNotify, otherNotify: mocks.ceNotify },
])('$edition workflow inference', ({ infer, resolve, other, notify, otherNotify }) => {
  it('uses the matching edition provider and validates its response', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '{"ok":true}' } }] });
    resolve.mockResolvedValue({ providerId: 'openrouter', model: 'test', requestOverrides: { resolveTurnOverrides: () => ({}) },
      client: { chat: { completions: { create } } } });
    await expect(infer(request)).resolves.toEqual({ ok: true });
    expect(resolve).toHaveBeenCalledWith('edition-tenant', 'workflow-inference', undefined);
    expect(create).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });
  it('notifies through its edition boundary when credits are unavailable', async () => {
    resolve.mockRejectedValue({ status: 402, error: { code: 'out_of_credits' } });
    await expect(infer(request)).rejects.toMatchObject({ code: 'AI_CREDITS_UNAVAILABLE' });
    expect(notify).toHaveBeenCalledWith('edition-tenant', 'workflow-inference', expect.objectContaining({ reason: 'out_of_credits' }));
    expect(otherNotify).not.toHaveBeenCalled();
  });
});
