import { describe, expect, it } from 'vitest';

import {
  isTerminalEntraRunStatus,
  resolveEntraClientSyncStartState,
  shouldShowEntraSyncAction,
} from './clientDetailsEntraSyncAction';

describe('shouldShowEntraSyncAction', () => {
  it('returns false when client sync flag is disabled', () => {
    expect(shouldShowEntraSyncAction('enterprise', false, { entra_tenant_id: 'entra-1' })).toBe(false);
  });

  it('returns false when edition is not enterprise', () => {
    expect(shouldShowEntraSyncAction('community', true, { entra_tenant_id: 'entra-1' })).toBe(false);
    expect(shouldShowEntraSyncAction(undefined, true, { entra_tenant_id: 'entra-1' })).toBe(false);
  });

  it('T126: returns true for mapped clients and false for unmapped clients', () => {
    expect(shouldShowEntraSyncAction('enterprise', true, { entra_tenant_id: 'entra-mapped' })).toBe(true);
    expect(shouldShowEntraSyncAction('enterprise', true, { entra_tenant_id: '' })).toBe(false);
    expect(shouldShowEntraSyncAction('enterprise', true, { entra_tenant_id: null })).toBe(false);
    expect(shouldShowEntraSyncAction('enterprise', true, null)).toBe(false);
  });

  it('T127: resolves run-id state and non-terminal polling status for client-level sync feedback', () => {
    expect(resolveEntraClientSyncStartState('run-127')).toEqual({
      runId: 'run-127',
      statusMessage: 'Run run-127: queued',
      shouldPoll: true,
    });
    expect(resolveEntraClientSyncStartState(null)).toEqual({
      runId: null,
      statusMessage: 'Entra sync started for this client.',
      shouldPoll: false,
    });

    expect(isTerminalEntraRunStatus('running')).toBe(false);
    expect(isTerminalEntraRunStatus('completed')).toBe(true);
    expect(isTerminalEntraRunStatus('failed')).toBe(true);
    expect(isTerminalEntraRunStatus('partial')).toBe(true);
  });

  it('T140: disabling client sync action flag hides entrypoint while preserving existing run-id status representation', () => {
    expect(
      shouldShowEntraSyncAction('enterprise', false, { entra_tenant_id: 'entra-tenant-140' })
    ).toBe(false);

    expect(resolveEntraClientSyncStartState('run-140-history')).toEqual({
      runId: 'run-140-history',
      statusMessage: 'Run run-140-history: queued',
      shouldPoll: true,
    });
  });
});
