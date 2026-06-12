import { describe, expect, it } from 'vitest';

import { evaluateFieldMapping } from '@/lib/inboundWebhooks/actions/mappingEvaluator';

describe('inbound webhook field mapping evaluator', () => {
  it('T093: evaluates JSONata expressions against the request body', async () => {
    await expect(
      evaluateFieldMapping(
        {
          alert: {
            id: 'alert-123',
            message: 'Disk full',
            severity: 'critical',
          },
        },
        {
          external_id: 'alert.id',
          title: 'alert.message',
          priority: 'alert.severity',
        },
      ),
    ).resolves.toEqual({
      external_id: 'alert-123',
      title: 'Disk full',
      priority: 'critical',
    });
  });
});
