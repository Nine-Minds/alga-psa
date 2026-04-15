import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./expiration.ts', import.meta.url), 'utf8');

describe('contract expiration report definition recurring timing basis', () => {
  it('treats expiration as assignment-end reporting rather than invoice service-period reporting', () => {
    expect(source).toContain("description: 'Track upcoming contract assignment expirations and renewal opportunities independent of invoice service-period timing'");
    expect(source).toContain("table: 'client_contracts'");
    expect(source).toContain("{ field: 'end_date', operator: 'gte', value: '{{today}}' }");
    expect(source).toContain("{ field: 'end_date', operator: 'lte', value: '{{in_90_days}}' }");
    expect(source).not.toContain('invoice_charge_details');
    expect(source).not.toContain('service_period_end');
  });
});
