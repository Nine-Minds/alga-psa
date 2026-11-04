import { describe, expect, it } from 'vitest';
import { createWorkflowWorkerMetrics } from './metrics';

describe('workflow worker metrics', () => {
  it('registers both counters with the documented label sets', async () => {
    const metrics = createWorkflowWorkerMetrics({ collectDefaults: false });
    metrics.recordLaunchSkip({ tenant: 't1', workflowId: 'w1', eventName: 'PING', reason: 'schema_mismatch', intentional: false });
    metrics.recordLaunch({ tenant: 't1', workflowId: 'w1', eventName: 'PING' });

    const text = await metrics.registry.metrics();
    expect(text).toContain(
      'alga_workflow_event_launch_skips_total{tenant="t1",workflow_id="w1",event_name="PING",reason="schema_mismatch",intentional="false"} 1'
    );
    expect(text).toContain('alga_workflow_event_launches_total{tenant="t1",workflow_id="w1",event_name="PING"} 1');
  });

  it('keeps registries independent per instance', async () => {
    const a = createWorkflowWorkerMetrics({ collectDefaults: false });
    const b = createWorkflowWorkerMetrics({ collectDefaults: false });
    a.recordLaunch({ tenant: 't', workflowId: 'w', eventName: 'E' });
    expect(await b.registry.metrics()).not.toContain('{tenant="t"');
  });
});
