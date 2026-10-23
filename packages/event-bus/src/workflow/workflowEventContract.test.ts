import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  WorkflowEventContractError,
  checkWorkflowEventPayload,
  enforceWorkflowEventContract,
  getWorkflowEventContractMode,
} from './workflowEventContract';

describe('workflow event contract (emit-time validation, plan step F)', () => {
  beforeEach(() => warn.mockClear());
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to enforce in test, warn in development and off elsewhere', () => {
    expect(getWorkflowEventContractMode({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe('enforce');
    expect(getWorkflowEventContractMode({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe('warn');
    expect(getWorkflowEventContractMode({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe('off');
    expect(getWorkflowEventContractMode({} as NodeJS.ProcessEnv)).toBe('off');
    expect(
      getWorkflowEventContractMode({ NODE_ENV: 'production', WORKFLOW_EVENT_CONTRACT_MODE: 'warn' } as NodeJS.ProcessEnv)
    ).toBe('warn');
  });

  it('rejects an invalid catalogued payload and names the schema', () => {
    const check = checkWorkflowEventPayload('TICKET_CREATED', {});
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.schemaRef).toBe('payload.TicketCreated.v1');
  });

  it('test mode (enforce): an invalid payload throws WorkflowEventContractError', () => {
    expect(() => enforceWorkflowEventContract('TICKET_CREATED', {}, 'enforce')).toThrow(WorkflowEventContractError);
  });

  it('dev mode (warn): an invalid payload logs a warning and does not throw', () => {
    expect(() => enforceWorkflowEventContract('TICKET_CREATED', {}, 'warn')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('TICKET_CREATED');
  });

  it('prod mode (off): an invalid payload is ignored silently', () => {
    expect(() => enforceWorkflowEventContract('TICKET_CREATED', {}, 'off')).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores event types that are not catalogued in every mode', () => {
    for (const mode of ['enforce', 'warn', 'off'] as const) {
      expect(() => enforceWorkflowEventContract('USER_CREATED', {}, mode)).not.toThrow();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('EventBus.publish throws on a drifted catalogued payload in test mode instead of swallowing it', async () => {
    vi.stubEnv('WORKFLOW_EVENT_CONTRACT_MODE', 'enforce');
    const { EventBus } = await import('../eventBus');
    const bus = EventBus.getInstance();
    await expect(
      bus.publish({ eventType: 'TICKET_CREATED', payload: { tenantId: 't' } } as never)
    ).rejects.toBeInstanceOf(WorkflowEventContractError);
  });
});
