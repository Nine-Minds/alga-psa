import { describe, expect, it } from 'vitest';

import { ListWorkflowRunsInput, UpdateWorkflowDefinitionMetadataInput } from './workflow-runtime-v2-schemas';

describe('UpdateWorkflowDefinitionMetadataInput', () => {
  it('accepts a pause toggle with blank optional numbers, which clear the setting', () => {
    // The designer sends null for an empty "Concurrency limit" field (placeholder: Unlimited).
    expect(UpdateWorkflowDefinitionMetadataInput.parse({
      workflowId: 'wf-1',
      isPaused: true,
      concurrencyLimit: null,
      failureRateThreshold: null,
      failureRateMinRuns: '',
    })).toEqual({
      workflowId: 'wf-1',
      isPaused: true,
      concurrencyLimit: null,
      failureRateThreshold: null,
      failureRateMinRuns: null,
    });
  });

  it('leaves omitted settings undefined so the stored values are kept', () => {
    const parsed = UpdateWorkflowDefinitionMetadataInput.parse({ workflowId: 'wf-1', isPaused: false });
    expect(parsed.concurrencyLimit).toBeUndefined();
    expect(parsed.failureRateThreshold).toBeUndefined();
  });

  it('coerces numeric strings and still rejects invalid numbers', () => {
    expect(UpdateWorkflowDefinitionMetadataInput.parse({ workflowId: 'wf-1', concurrencyLimit: '3', failureRateThreshold: '0.5' }))
      .toMatchObject({ concurrencyLimit: 3, failureRateThreshold: 0.5 });
    expect(() => UpdateWorkflowDefinitionMetadataInput.parse({ workflowId: 'wf-1', concurrencyLimit: -1 })).toThrow();
    expect(() => UpdateWorkflowDefinitionMetadataInput.parse({ workflowId: 'wf-1', failureRateThreshold: 2 })).toThrow();
  });
});

describe('optional numeric list inputs', () => {
  it('keep their defaults and accept null', () => {
    expect(ListWorkflowRunsInput.parse({})).toMatchObject({ limit: 50, cursor: 0 });
    expect(ListWorkflowRunsInput.parse({ limit: '25', cursor: 10 })).toMatchObject({ limit: 25, cursor: 10 });
    expect(() => ListWorkflowRunsInput.parse({ limit: null })).not.toThrow();
  });
});
