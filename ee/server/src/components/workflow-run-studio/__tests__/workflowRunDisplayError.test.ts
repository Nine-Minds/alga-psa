import { describe, expect, it } from 'vitest';

import { buildRunDisplayError, buildStepDisplayError, getWorkflowErrorCode, getWorkflowRunLaunchFailure } from '../workflowRunDisplayError';

const failedStep = {
  step_id: 'step-runtime-1',
  run_id: 'run-1',
  step_path: 'root.steps[0]',
  definition_step_id: 'parse-invalid',
  status: 'FAILED',
  attempt: 1,
  error_json: { message: 'Activity task failed' },
  started_at: '2026-05-10T12:00:00.000Z',
};

const failedInvocation = {
  invocation_id: 'invocation-1',
  run_id: 'run-1',
  step_path: 'root.steps[0]',
  action_id: 'transform.parse_json',
  action_version: 1,
  status: 'FAILED',
  attempt: 1,
  error_message: "JSON parse failed: Expected property name or '}' in JSON at position 1",
  created_at: '2026-05-10T12:00:00.000Z',
};

describe('workflow run display errors', () => {
  it('prefers failed action invocation messages over generic step errors', () => {
    const displayError = buildStepDisplayError(failedStep, [failedInvocation]);

    expect(displayError).toMatchObject({
      message: "JSON parse failed: Expected property name or '}' in JSON at position 1",
      category: 'transform.parse_json',
      technicalMessage: 'Activity task failed',
      stepPath: 'root.steps[0]',
    });
  });

  it('uses failed action invocation messages for run-level error summaries', () => {
    const displayError = buildRunDisplayError(
      {
        node_path: 'root.steps[0]',
        error_json: {
          message: 'Activity task failed',
          nodePath: 'root.steps[0]',
        },
      },
      [failedStep],
      [failedInvocation]
    );

    expect(displayError).toMatchObject({
      message: "JSON parse failed: Expected property name or '}' in JSON at position 1",
      category: 'transform.parse_json',
      technicalMessage: 'Activity task failed',
      stepPath: 'root.steps[0]',
    });
  });

  it('surfaces regex action-level messages before generic wrapper text', () => {
    const displayError = buildRunDisplayError(
      {
        node_path: 'root.steps[3]',
        error_json: {
          message: 'Activity task failed',
          nodePath: 'root.steps[3]',
        },
      },
      [
        {
          ...failedStep,
          step_path: 'root.steps[3]',
        },
      ],
      [
        {
          ...failedInvocation,
          step_path: 'root.steps[3]',
          action_id: 'transform.regex_match',
          error_message: 'transform.regex_match: invalid regex pattern "(": Unterminated group',
        },
      ]
    );

    expect(displayError).toMatchObject({
      message: 'transform.regex_match: invalid regex pattern "(": Unterminated group',
      category: 'transform.regex_match',
      technicalMessage: 'Activity task failed',
      stepPath: 'root.steps[3]',
    });
  });

  it('surfaces the structured error code from invocation error_json', () => {
    const displayError = buildStepDisplayError(failedStep, [
      {
        ...failedInvocation,
        error_json: { category: 'ActionError', code: 'CONFLICT', message: 'Duplicate record' },
      },
    ]);

    expect(displayError?.code).toBe('CONFLICT');
  });

  it('falls back to the error_json category when no code is present', () => {
    expect(getWorkflowErrorCode({ category: 'TimeoutError', message: 'timed out' })).toBe('TimeoutError');
    expect(getWorkflowErrorCode({ message: 'plain' })).toBeNull();
    expect(getWorkflowErrorCode(null)).toBeNull();
  });

  it('leaves code null when the invocation has no error_json', () => {
    const displayError = buildStepDisplayError(failedStep, [failedInvocation]);
    expect(displayError?.code ?? null).toBeNull();
  });
});

describe('getWorkflowRunLaunchFailure', () => {
  const engineDown = (message: string) => /failed to connect before the deadline/i.test(message);

  it('classifies a launch-stage failure caused by an unreachable engine', () => {
    expect(getWorkflowRunLaunchFailure(
      { error_json: { stage: 'launch', message: 'Failed to connect before the deadline' } },
      engineDown
    )).toEqual({ reason: 'runtime_unavailable', message: 'Failed to connect before the deadline' });
  });

  it('classifies other launch-stage failures and ignores runs that reached the engine', () => {
    expect(getWorkflowRunLaunchFailure({ error_json: { stage: 'launch', message: 'Workflow version missing' } }, engineDown))
      .toEqual({ reason: 'launch_failed', message: 'Workflow version missing' });
    expect(getWorkflowRunLaunchFailure({ error_json: { message: 'Step failed' } }, engineDown)).toBeNull();
    expect(getWorkflowRunLaunchFailure(null, engineDown)).toBeNull();
  });
});
