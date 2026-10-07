import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';

import {
  buildWorkflowRunHref,
  describeWorkflowRunLaunchFailure,
} from '../workflowRunDialogUtils';
import {
  isWorkflowEngineUnavailableMessage,
  mapWorkflowServerError,
} from '../workflowServerErrors';

const translate = ((_key: string, options?: Record<string, unknown>) =>
  String(options?.defaultValue ?? '')) as unknown as TFunction;

describe('run start feedback', () => {
  it('links to the run studio route for a run id', () => {
    expect(buildWorkflowRunHref('run-1')).toBe('/msp/workflows/runs/run-1');
  });

  it('explains an unreachable workflow engine in plain language and keeps the raw detail', () => {
    const failure = describeWorkflowRunLaunchFailure(
      translate,
      { reason: 'runtime_unavailable', message: 'Failed to connect before the deadline' },
      'run-7'
    );
    expect(failure.runId).toBe('run-7');
    expect(failure.title).toBe('The workflow engine could not be reached');
    expect(failure.description).not.toContain('deadline');
    expect(failure.technicalDetail).toBe('Failed to connect before the deadline');
  });

  it('describes other launch failures and still links to the run', () => {
    const failure = describeWorkflowRunLaunchFailure(
      translate,
      { reason: 'launch_failed', message: 'Workflow type not registered' },
      'run-8'
    );
    expect(failure.runId).toBe('run-8');
    expect(failure.title).toBe('The run could not start');
    expect(failure.technicalDetail).toBe('Workflow type not registered');
  });

  it('maps raw Temporal connection errors to a human-readable server error', () => {
    expect(isWorkflowEngineUnavailableMessage('Failed to connect before the deadline')).toBe(true);
    expect(isWorkflowEngineUnavailableMessage('14 UNAVAILABLE: Name resolution failed for target dns:temporal:7233')).toBe(true);
    expect(isWorkflowEngineUnavailableMessage('Workflow is paused')).toBe(false);

    expect(mapWorkflowServerError(translate, new Error('Failed to connect before the deadline'), 'fallback'))
      .toMatch(/^The workflow engine could not be reached\./);
    expect(mapWorkflowServerError(translate, new Error('Workflow is paused'), 'fallback')).toBe('Workflow is paused');
  });
});
