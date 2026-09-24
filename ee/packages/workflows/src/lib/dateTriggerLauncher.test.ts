import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ published: vi.fn(), launch: vi.fn(), safeParse: vi.fn() }));
vi.mock('@alga-psa/workflows/persistence', () => ({ listPublishedWorkflowDefinitions: mocks.published }));
vi.mock('@alga-psa/workflows/runtime/core', () => ({
  initializeWorkflowRuntimeV2: vi.fn(),
  getSchemaRegistry: () => ({ has: () => true, get: () => ({ safeParse: mocks.safeParse }) }),
}));
vi.mock('./workflowRunLauncher', () => ({ launchPublishedWorkflowRun: mocks.launch }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { buildDateTriggerFireKey, getDateTriggerOccurrenceRange, launchDateTriggeredWorkflows } from './dateTriggerLauncher';

describe('date trigger launcher', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.safeParse.mockReturnValue({ success: true }); });

  it('builds signed-offset ranges with the three-day lookback and stable fire keys', () => {
    expect(getDateTriggerOccurrenceRange('2026-09-23', -30)).toEqual({ fromDate: '2026-10-20', toDate: '2026-10-23' });
    expect(getDateTriggerOccurrenceRange('2026-09-23', 0)).toEqual({ fromDate: '2026-09-20', toDate: '2026-09-23' });
    expect(getDateTriggerOccurrenceRange('2026-09-23', 7)).toEqual({ fromDate: '2026-09-13', toDate: '2026-09-16' });
    expect(buildDateTriggerFireKey('wf', 'client.anniversary', 'client', '2026-10-23', -30)).toBe('date:wf:client.anniversary:client:2026-10-23:-30');
  });

  it('validates payloads before launching and respects localTime', async () => {
    const findOccurrences = vi.fn().mockResolvedValue([{ entityId: 'client-1', clientId: 'client-1', occursOn: '2026-10-23', cycleKey: '2026-10-23', payload: { clientId: 'client-1', clientName: 'Acme', yearsAsClient: 3, anniversarySource: 'client_since' } }]);
    const source = { id: 'client.anniversary', payloadSchemaRef: 'payload.ClientAnniversary.v1', findOccurrences } as any;
    const workflow = { workflow_id: 'wf-1' };
    const definition = { trigger: { type: 'date', source: source.id, offsetDays: -30, localTime: '08:00' }, payloadSchemaRef: source.payloadSchemaRef };
    mocks.published.mockResolvedValue([{ workflow, definition }]);
    const base = { tenantId: 'tenant', today: '2026-09-23', now: new Date('2026-09-23T14:00:00Z'), timezone: 'UTC', knex: {} as any, sources: [source] };
    mocks.safeParse.mockReturnValueOnce({ success: false });
    await launchDateTriggeredWorkflows(base);
    expect(mocks.launch).not.toHaveBeenCalled();
    mocks.safeParse.mockReturnValue({ success: true });
    await launchDateTriggeredWorkflows({ ...base, now: new Date('2026-09-23T06:00:00Z') });
    expect(mocks.launch).not.toHaveBeenCalled();
    await launchDateTriggeredWorkflows(base);
    expect(mocks.launch).toHaveBeenCalledTimes(1);
  });

  it('catches up only occurrences whose fire date is within the three-day window', async () => {
    const findOccurrences = vi.fn().mockResolvedValue([
      { entityId: 'old', clientId: 'c', occursOn: '2026-10-19', cycleKey: '2026-10-19', payload: {} },
      { entityId: 'edge', clientId: 'c', occursOn: '2026-10-20', cycleKey: '2026-10-20', payload: {} },
      { entityId: 'future', clientId: 'c', occursOn: '2026-10-24', cycleKey: '2026-10-24', payload: {} },
    ]);
    const source = { id: 'client.anniversary', payloadSchemaRef: 'payload.ClientAnniversary.v1', findOccurrences } as any;
    mocks.published.mockResolvedValue([{
      workflow: { workflow_id: 'wf-1' },
      definition: { trigger: { type: 'date', source: source.id, offsetDays: -30, localTime: '00:00' }, payloadSchemaRef: source.payloadSchemaRef },
    }]);
    await launchDateTriggeredWorkflows({
      tenantId: 'tenant', today: '2026-09-23', now: new Date('2026-09-23T12:00:00Z'), timezone: 'UTC', knex: {} as any, sources: [source],
    });
    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expect(mocks.launch.mock.calls[0][1].triggerFireKey).toContain(':edge:2026-10-20:-30');
  });

  it('caps launches at 500 for one tenant tick', async () => {
    const occurrences = Array.from({ length: 501 }, (_, index) => ({
      entityId: `client-${index}`, clientId: `client-${index}`, occursOn: '2026-09-23', cycleKey: '2026-09-23', payload: {},
    }));
    const source = {
      id: 'client.anniversary', payloadSchemaRef: 'payload.ClientAnniversary.v1',
      findOccurrences: vi.fn().mockResolvedValue(occurrences),
    } as any;
    mocks.published.mockResolvedValue([{
      workflow: { workflow_id: 'wf-1' },
      definition: { trigger: { type: 'date', source: source.id, offsetDays: 0, localTime: '00:00' }, payloadSchemaRef: source.payloadSchemaRef },
    }]);
    await launchDateTriggeredWorkflows({
      tenantId: 'tenant', today: '2026-09-23', now: new Date('2026-09-23T12:00:00Z'), timezone: 'UTC', knex: {} as any, sources: [source],
    });
    expect(mocks.launch).toHaveBeenCalledTimes(500);
  });

  it('continues to later workflows when one launch fails', async () => {
    const source = {
      id: 'client.anniversary', payloadSchemaRef: 'payload.ClientAnniversary.v1',
      findOccurrences: vi.fn().mockResolvedValue([{ entityId: 'client-1', clientId: 'client-1', occursOn: '2026-09-23', cycleKey: '2026-09-23', payload: {} }]),
    } as any;
    mocks.published.mockResolvedValue(['wf-1', 'wf-2'].map((workflow_id) => ({
      workflow: { workflow_id },
      definition: { trigger: { type: 'date', source: source.id, offsetDays: 0, localTime: '00:00' }, payloadSchemaRef: source.payloadSchemaRef },
    })));
    mocks.launch.mockRejectedValueOnce(new Error('first workflow unavailable')).mockResolvedValueOnce({ runId: 'run-2', workflowVersion: 1 });

    await launchDateTriggeredWorkflows({
      tenantId: 'tenant', today: '2026-09-23', now: new Date('2026-09-23T12:00:00Z'), timezone: 'UTC', knex: {} as any, sources: [source],
    });

    expect(mocks.launch).toHaveBeenCalledTimes(2);
  });
});
