import { afterEach, describe, expect, it } from 'vitest';
import { resolveWorkflowEventCorrelation } from '../workflowEventCorrelation';

const ENV_KEY = 'WORKFLOW_RUNTIME_V2_EVENT_CORRELATION_PATHS_JSON';
const ORIGINAL_ENV = process.env[ENV_KEY];

describe('resolveWorkflowEventCorrelation', () => {
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = ORIGINAL_ENV;
    }
  });

  it('prefers an explicit correlation key', () => {
    const resolution = resolveWorkflowEventCorrelation({
      eventName: 'TICKET_CREATED',
      payload: { ticketId: 'ticket-1' },
      explicitCorrelationKey: ' explicit-key ',
    });
    expect(resolution).toEqual({
      key: 'explicit-key',
      keys: ['explicit-key'],
      source: 'explicit',
      detail: 'event.workflow_correlation_key',
    });
  });

  it('derives from built-in default paths without any env config', () => {
    delete process.env[ENV_KEY];
    const resolution = resolveWorkflowEventCorrelation({
      eventName: 'TICKET_COMMENT_ADDED',
      payload: { ticketId: 'ticket-42' },
    });
    expect(resolution.key).toBe('ticket-42');
    expect(resolution.keys).toEqual(['ticket-42']);
    expect(resolution.source).toBe('derived');
    expect(resolution.detail).toBe('paths:ticketId (default)');
  });

  it('derives every available path value, not just the first', () => {
    delete process.env[ENV_KEY];
    const resolution = resolveWorkflowEventCorrelation({
      eventName: 'INVOICE_FINALIZED',
      payload: { invoiceId: 'inv-7', clientId: 'client-3' },
    });
    // A wait keyed on clientId must be reachable even though invoiceId is
    // always present (it is a required payload field).
    expect(resolution.key).toBe('inv-7');
    expect(resolution.keys).toEqual(['inv-7', 'client-3']);
    expect(resolution.source).toBe('derived');
    expect(resolution.detail).toBe('paths:invoiceId,clientId (default)');
  });

  it('dedupes repeated values across event-specific and wildcard paths', () => {
    delete process.env[ENV_KEY];
    const resolution = resolveWorkflowEventCorrelation({
      eventName: 'TICKET_CREATED',
      payload: { ticketId: 'ticket-9', clientId: 'client-2' },
    });
    // ticketId appears in both the event-specific and wildcard lists; the
    // wildcard also derives clientId.
    expect(resolution.keys).toEqual(['ticket-9', 'client-2']);
  });

  it('derives via wildcard defaults for unlisted event types', () => {
    delete process.env[ENV_KEY];
    const resolution = resolveWorkflowEventCorrelation({
      eventName: 'SOME_FUTURE_EVENT',
      payload: { invoiceId: 'inv-7' },
    });
    expect(resolution.key).toBe('inv-7');
    expect(resolution.keys).toEqual(['inv-7']);
    expect(resolution.source).toBe('derived');
  });

  it('lets env config replace the defaults', () => {
    process.env[ENV_KEY] = JSON.stringify({ PING: ['nested.id'] });
    const resolution = resolveWorkflowEventCorrelation({
      eventName: 'PING',
      payload: { nested: { id: 'n-1' } },
    });
    expect(resolution.key).toBe('n-1');
    expect(resolution.keys).toEqual(['n-1']);
    expect(resolution.detail).toBe('paths:nested.id (env)');
  });

  it('returns missing when no path yields a value', () => {
    delete process.env[ENV_KEY];
    const resolution = resolveWorkflowEventCorrelation({
      eventName: 'TICKET_CREATED',
      payload: { foo: 'bar' },
    });
    expect(resolution.key).toBeNull();
    expect(resolution.keys).toEqual([]);
    expect(resolution.source).toBe('missing');
  });
});
