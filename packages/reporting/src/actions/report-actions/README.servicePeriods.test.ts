import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./README.md', import.meta.url), 'utf8');

describe('report actions README recurring timing guidance', () => {
  it('documents canonical recurring service-period reporting semantics and rollout defaults', () => {
    expect(source).toContain('Recurring billing reporting is no longer allowed to assume that invoice header dates are the only recurring timing truth.');
    expect(source).toContain('they should prefer canonical `service_period_start` / `service_period_end` values when those detail rows exist');
    expect(source).toContain('Historical or manual rows that do not yet have canonical recurring detail metadata may still fall back to invoice-date semantics.');
    expect(source).toContain('Client billing schedule previews should be described as invoice-window previews for client-cadence lines.');
    expect(source).toContain('Contract-anniversary cadence remains a later capability');
  });
});
