import { describe, expect, it } from 'vitest';
import { applianceWorkflowId, mapDescriptionToStatus, redactWorkflowResult } from '@ee/lib/applianceConsole/workflowClient';

describe('appliance workflow status mapping', () => {
  const id = applianceWorkflowId('reissue-install-code', 'tenant-1', 'audit-9');

  it('builds a deterministic id per audit row', () => {
    expect(id).toBe('appliance-reissue-install-code:tenant-1:audit-9');
  });

  it('reports running without touching the result', async () => {
    const status = await mapDescriptionToStatus(id, 'RUNNING', 'audit-9', async () => {
      throw new Error('should not be called');
    });
    expect(status).toEqual({ workflow_id: id, state: 'running', audit_log_id: 'audit-9' });
  });

  it('surfaces the workflow result when completed', async () => {
    const status = await mapDescriptionToStatus(id, 'COMPLETED', 'audit-9', async () => ({ install_code: 'ABCD', email_sent: true }));
    expect(status).toEqual({
      workflow_id: id,
      state: 'completed',
      result: { install_code: 'ABCD', email_sent: true },
      audit_log_id: 'audit-9',
    });
  });

  it('unwraps the activity failure message when the workflow failed', async () => {
    // WorkflowFailedError → ActivityFailure → ApplicationFailure (the C4 message)
    const failure = Object.assign(new Error('Workflow execution failed'), {
      cause: Object.assign(new Error('Activity task failed'), {
        cause: new Error('C4 /install-codes/reissue failed (404): No registered tenant found'),
      }),
    });
    const status = await mapDescriptionToStatus(id, 'FAILED', null, async () => {
      throw failure;
    });
    expect(status.state).toBe('failed');
    expect(status.error).toBe('C4 /install-codes/reissue failed (404): No registered tenant found');
    expect(status.audit_log_id).toBeNull();
  });

  it('treats timeouts and cancellations as failed with a readable status', async () => {
    const status = await mapDescriptionToStatus(id, 'TIMED_OUT', 'audit-9', async () => undefined);
    expect(status).toMatchObject({ state: 'failed', error: 'Workflow ended with status timed_out' });
  });
});

describe('redactWorkflowResult', () => {
  it('hides one-time secrets but keeps the rest', () => {
    expect(redactWorkflowResult({ jwt: 'eyJ', code: 'ABCD', install_code: 'WXYZ', expires_at: 1, email_sent: true })).toEqual({
      jwt: '[redacted]',
      code: '[redacted]',
      install_code: '[redacted]',
      expires_at: 1,
      email_sent: true,
    });
    expect(redactWorkflowResult(null)).toBeNull();
    expect(redactWorkflowResult('plain')).toBe('plain');
  });
});
