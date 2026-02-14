import { describe, expect, it } from 'vitest';
import type { Asset, RmmAgentStatus } from './asset.interfaces';

describe('RmmAgentStatus', () => {
  it('accepts overdue and preserves existing statuses', () => {
    const statuses: RmmAgentStatus[] = ['online', 'offline', 'overdue', 'unknown'];
    expect(statuses).toEqual(['online', 'offline', 'overdue', 'unknown']);

    const asset: Partial<Asset> = { agent_status: 'overdue' };
    expect(asset.agent_status).toBe('overdue');
  });
});

