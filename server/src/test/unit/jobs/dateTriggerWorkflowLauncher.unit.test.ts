import { describe, expect, it } from 'vitest';
import { launchDateTriggeredWorkflows } from '@alga-psa/workflows/lib/dateTriggerLauncher';
import {
  configureEditionDateTriggerWorkflowLauncher,
  resolveDateTriggerWorkflowLauncher,
} from '../../../lib/jobs/dateTriggerWorkflowLauncher';

// Unmocked on purpose: the EE launcher must load through the real
// @alga-psa/workflows export map, which exposes ./lib/* for ESM import only.
describe('edition date-trigger workflow launcher', () => {
  it('resolves the real EE launcher module in enterprise edition', () => {
    expect(resolveDateTriggerWorkflowLauncher(true)).toBe(launchDateTriggeredWorkflows);
    expect(configureEditionDateTriggerWorkflowLauncher(true)).toBe(launchDateTriggeredWorkflows);
  });

  it('resolves no launcher in community edition', () => {
    expect(resolveDateTriggerWorkflowLauncher(false)).toBeUndefined();
    expect(configureEditionDateTriggerWorkflowLauncher(false)).toBeUndefined();
  });
});
