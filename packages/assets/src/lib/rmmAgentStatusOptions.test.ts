import { describe, expect, it } from 'vitest';
import { RMM_AGENT_STATUS_OPTIONS } from './rmmAgentStatusOptions';

describe('RMM_AGENT_STATUS_OPTIONS', () => {
  it('includes overdue (and preserves existing online/offline/unknown values)', () => {
    const values = RMM_AGENT_STATUS_OPTIONS.map((o) => o.value);
    expect(values).toEqual(['online', 'offline', 'overdue', 'unknown']);
  });
});

