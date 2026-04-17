import { describe, expect, it } from 'vitest';
import { RMM_AGENT_STATUS_VALUES } from './rmmAgentStatusOptions';

describe('RMM_AGENT_STATUS_VALUES', () => {
  it('includes overdue (and preserves existing online/offline/unknown values)', () => {
    expect(RMM_AGENT_STATUS_VALUES).toEqual(['online', 'offline', 'overdue', 'unknown']);
  });
});
