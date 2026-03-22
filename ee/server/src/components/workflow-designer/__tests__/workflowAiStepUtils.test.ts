import { describe, expect, it } from 'vitest';

import { shouldRenderWorkflowAiSchemaSection } from '../workflowAiStepUtils';

describe('workflowAiStepUtils', () => {
  it('T009: only ai.infer action.call steps render the dedicated AI schema authoring section', () => {
    expect(shouldRenderWorkflowAiSchemaSection('action.call', 'ai.infer')).toBe(true);
    expect(shouldRenderWorkflowAiSchemaSection('action.call', 'tickets.create')).toBe(false);
    expect(shouldRenderWorkflowAiSchemaSection('state.set', 'ai.infer')).toBe(false);
    expect(shouldRenderWorkflowAiSchemaSection(null, null)).toBe(false);
  });
});
