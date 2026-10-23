import { describe, expect, it } from 'vitest';

import { readWorkflowIdFromEditorPath, workflowEditorPath } from '../workflowEditorRoute';

describe('workflow editor route helpers', () => {
  it('reads the workflow id from an editor address', () => {
    expect(readWorkflowIdFromEditorPath('/msp/workflow-editor/wf-1')).toBe('wf-1');
    expect(readWorkflowIdFromEditorPath('/msp/workflow-editor/wf%201/')).toBe('wf 1');
  });

  it('returns null for /new and non-editor paths', () => {
    expect(readWorkflowIdFromEditorPath('/msp/workflow-editor/new')).toBeNull();
    expect(readWorkflowIdFromEditorPath('/msp/workflow-editor')).toBeNull();
    expect(readWorkflowIdFromEditorPath('/msp/workflows/runs/run-1')).toBeNull();
    expect(readWorkflowIdFromEditorPath(null)).toBeNull();
  });

  it('builds editor addresses', () => {
    expect(workflowEditorPath('wf 1')).toBe('/msp/workflow-editor/wf%201');
    expect(workflowEditorPath(null)).toBe('/msp/workflow-editor/new');
  });
});
