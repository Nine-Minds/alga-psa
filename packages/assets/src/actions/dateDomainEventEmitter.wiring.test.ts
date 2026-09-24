import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./assetActions.ts', import.meta.url), 'utf8');

describe('asset warranty date event emitter wiring', () => {
  it('routes create and update events through the shared date emission ledger', () => {
    expect(source).toContain("import { emitDateDomainEventOnce } from '@alga-psa/jobs/date-triggers';");
    expect(source).toContain("eventType: 'ASSET_WARRANTY_EXPIRING', entityId: created.asset_id,");
    expect(source).toContain("eventType: 'ASSET_WARRANTY_EXPIRING', entityId: asset_id,");
    expect(source.match(/emitDateDomainEventOnce\(/g)).toHaveLength(2);
    expect(source).toContain('cycleKey: warranty.expiresAt.slice(0, 10)');
  });
});
