import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./assetActions.ts', import.meta.url), 'utf8');
const scanSource = readFileSync(new URL('../../../jobs/src/lib/dateTriggers/sources/assetWarrantyEnd.ts', import.meta.url), 'utf8');

describe('asset warranty date event emitter wiring', () => {
  it('routes create and update events through the shared date emission ledger', () => {
    expect(source).toContain("from '@alga-psa/event-bus/workflow/dateDomainEvents'");
    expect(source).toContain("eventType: 'ASSET_WARRANTY_EXPIRING', entityId: created.asset_id,");
    expect(source).toContain("eventType: 'ASSET_WARRANTY_EXPIRING', entityId: asset_id,");
    expect(source.match(/emitDateDomainEventOnce\(/g)).toHaveLength(2);
    expect(source).toContain('const warrantyDate = toTenantLocalDate(warranty.expiresAt, await getTenantTimezone(tenant) ?? \'UTC\')');
    expect(source).toContain('cycleKey: warrantyDate, occursOn: warrantyDate');
    expect(scanSource).toContain('toTenantLocalDate(r.warranty_end_date, timezone)');
  });
});
