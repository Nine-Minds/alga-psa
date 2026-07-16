import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initializeWorkflowRuntimeV2 } from '../init';
import { validateWorkflowDefinition } from '../validation/publishValidation';
import {
  DEFAULT_WORKFLOW_EVENT_CORRELATION_PATHS,
  WORKFLOW_EVENT_CORRELATION_PATHS_ENV,
  getWorkflowEventCorrelationPaths
} from '../correlationDefaults';
import type { WorkflowDefinition } from '../types';

const ORIGINAL_ENV = process.env[WORKFLOW_EVENT_CORRELATION_PATHS_ENV];

function definitionWithEventWait(eventName: string): WorkflowDefinition {
  return {
    id: 'wf-correlation-test',
    version: 1,
    name: 'Correlation validation test',
    payloadSchemaRef: 'payload.WorkflowEvent.v1',
    steps: [
      {
        id: 'wait-for-event',
        type: 'event.wait',
        config: {
          eventName,
          correlationKey: { $expr: 'payload.ticketId' },
          timeoutMs: 60000
        }
      }
    ]
  } as WorkflowDefinition;
}

describe('correlationDefaults', () => {
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env[WORKFLOW_EVENT_CORRELATION_PATHS_ENV];
    } else {
      process.env[WORKFLOW_EVENT_CORRELATION_PATHS_ENV] = ORIGINAL_ENV;
    }
  });

  it('returns built-in defaults when the env override is unset', () => {
    delete process.env[WORKFLOW_EVENT_CORRELATION_PATHS_ENV];
    const resolution = getWorkflowEventCorrelationPaths('TICKET_COMMENT_ADDED');
    expect(resolution.source).toBe('default');
    expect(resolution.paths[0]).toBe('ticketId');
    expect(resolution.paths).toEqual(
      expect.arrayContaining(DEFAULT_WORKFLOW_EVENT_CORRELATION_PATHS['*'])
    );
  });

  it('applies wildcard defaults to unknown event types', () => {
    delete process.env[WORKFLOW_EVENT_CORRELATION_PATHS_ENV];
    const resolution = getWorkflowEventCorrelationPaths('SOME_FUTURE_EVENT');
    expect(resolution.source).toBe('default');
    expect(resolution.paths).toEqual(DEFAULT_WORKFLOW_EVENT_CORRELATION_PATHS['*']);
  });

  it('lets the env override replace the defaults entirely', () => {
    process.env[WORKFLOW_EVENT_CORRELATION_PATHS_ENV] = JSON.stringify({
      PING: ['custom.path']
    });
    expect(getWorkflowEventCorrelationPaths('PING')).toEqual({
      paths: ['custom.path'],
      source: 'env'
    });
    expect(getWorkflowEventCorrelationPaths('TICKET_CREATED')).toEqual({
      paths: [],
      source: 'none'
    });
  });

  it('falls back to defaults when the env override is unparseable', () => {
    process.env[WORKFLOW_EVENT_CORRELATION_PATHS_ENV] = 'not-json';
    const resolution = getWorkflowEventCorrelationPaths('TICKET_CREATED');
    expect(resolution.source).toBe('default');
    expect(resolution.paths[0]).toBe('ticketId');
  });
});

describe('publish validation of event.wait correlation', () => {
  beforeAll(() => {
    initializeWorkflowRuntimeV2();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env[WORKFLOW_EVENT_CORRELATION_PATHS_ENV];
    } else {
      process.env[WORKFLOW_EVENT_CORRELATION_PATHS_ENV] = ORIGINAL_ENV;
    }
  });

  it('errors when the waited event has no derivation paths', () => {
    process.env[WORKFLOW_EVENT_CORRELATION_PATHS_ENV] = JSON.stringify({
      PING: ['ticket.id']
    });
    const result = validateWorkflowDefinition(definitionWithEventWait('TICKET_CREATED'));
    const uncorrelatable = result.errors.filter((e) => e.code === 'EVENT_WAIT_UNCORRELATABLE');
    expect(uncorrelatable).toHaveLength(1);
    expect(uncorrelatable[0].message).toContain('TICKET_CREATED');
    expect(result.ok).toBe(false);
  });

  it('warns with the derivation contract when paths exist', () => {
    delete process.env[WORKFLOW_EVENT_CORRELATION_PATHS_ENV];
    const result = validateWorkflowDefinition(definitionWithEventWait('TICKET_COMMENT_ADDED'));
    expect(result.errors.filter((e) => e.code === 'EVENT_WAIT_UNCORRELATABLE')).toHaveLength(0);
    const contractWarnings = result.warnings.filter((e) => e.code === 'EVENT_WAIT_CORRELATION_CONTRACT');
    expect(contractWarnings).toHaveLength(1);
    expect(contractWarnings[0].message).toContain('ticketId');
  });
});
