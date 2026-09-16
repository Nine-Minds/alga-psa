import { describe, it, expect } from 'vitest';
import { dedupeRecommendations } from '@ee/lib/integrations/entra/diagnostics/recommendations';
import type { DiagnosticsRecommendation } from '@alga-psa/types';

const fail = (code: string, action?: DiagnosticsRecommendation['action']): DiagnosticsRecommendation => ({
  code,
  severity: 'fail',
  text: code,
  action,
});

describe('dedupeRecommendations', () => {
  it('deduplicates identical codes and actions', () => {
    const result = dedupeRecommendations([fail('a'), fail('a'), fail('a')]);
    expect(result).toHaveLength(1);
  });

  it('keeps distinct customer consent URLs for the same code', () => {
    const result = dedupeRecommendations([
      fail('customer_consent_required', { kind: 'open_url', payload: 'https://consent/tenant-1' }),
      fail('customer_consent_required', { kind: 'open_url', payload: 'https://consent/tenant-2' }),
      fail('customer_consent_required', { kind: 'open_url', payload: 'https://consent/tenant-1' }),
    ]);
    expect(result).toHaveLength(2);
  });

  it('orders fail before warn before info while preserving stable order', () => {
    const recs: DiagnosticsRecommendation[] = [
      { code: 'i1', severity: 'info', text: 'info' },
      { code: 'w1', severity: 'warn', text: 'warn' },
      { code: 'f1', severity: 'fail', text: 'fail' },
      { code: 'f2', severity: 'fail', text: 'fail2' },
    ];
    expect(dedupeRecommendations(recs).map((r) => r.code)).toEqual(['f1', 'f2', 'w1', 'i1']);
  });
});
