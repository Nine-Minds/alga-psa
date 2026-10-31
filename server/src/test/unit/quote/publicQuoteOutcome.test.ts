/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  resolveRequestLocale: async () => 'en',
  getServerTranslation: async () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
}));

import {
  mapResolveFailureToOutcome,
  outcomeCopyKey,
  outcomeHttpStatus,
  sameOriginLogoUrl,
  type PublicQuoteOutcome,
} from '../../../lib/quote/publicQuoteOutcome';
import PublicQuoteOutcomeView from '../../../app/quote/[token]/PublicQuoteOutcomeView';

describe('resolve status -> outcome', () => {
  it('maps every failure status', () => {
    expect(mapResolveFailureToOutcome('not_found')).toBe('unknown');
    expect(mapResolveFailureToOutcome('expired')).toBe('expired');
    expect(mapResolveFailureToOutcome('revoked')).toBe('revoked');
    expect(mapResolveFailureToOutcome('superseded')).toBe('superseded');
    expect(mapResolveFailureToOutcome('decided')).toBe('decided');
    expect(mapResolveFailureToOutcome('rate_limited')).toBe('rate_limited');
  });

  it('unknown and revoked are indistinguishable (same copy, same HTTP status family)', () => {
    expect(outcomeCopyKey('unknown')).toBe(outcomeCopyKey('revoked'));
    expect(outcomeCopyKey('rate_limited')).toBe(outcomeCopyKey('unknown'));
  });

  it('PDF route statuses', () => {
    expect(outcomeHttpStatus('unknown')).toBe(404);
    expect(outcomeHttpStatus('rate_limited')).toBe(429);
    expect(outcomeHttpStatus('expired')).toBe(410);
  });

  it('only same-origin logos are allowed', () => {
    expect(sameOriginLogoUrl('https://cdn.example.com/x.png')).toBeNull();
    expect(sameOriginLogoUrl('//cdn.example.com/x.png')).toBeNull();
    expect(sameOriginLogoUrl('/api/logo.png')).toBe('/api/logo.png');
    expect(sameOriginLogoUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });
});

describe('PublicQuoteOutcomeView', () => {
  const outcomes: PublicQuoteOutcome[] = ['unknown', 'expired', 'revoked', 'superseded', 'decided', 'rate_limited'];

  it.each(outcomes)('%s renders generic copy, a contact path and a sign-in link, with no tenant or quote data', async (outcome) => {
    const element = await PublicQuoteOutcomeView({ outcome });
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('Reply to the email you received');
    expect(html).toContain('/auth/client-portal/signin');
    // The component only receives the outcome, so nothing else can appear.
    expect(html).not.toMatch(/Q-\d|\$|€|Acme|tenant|mailto:/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('unknown and revoked render identical markup', async () => {
    const a = renderToStaticMarkup((await PublicQuoteOutcomeView({ outcome: 'unknown' })) as React.ReactElement);
    const b = renderToStaticMarkup((await PublicQuoteOutcomeView({ outcome: 'revoked' })) as React.ReactElement);
    expect(a).toBe(b);
  });
});
