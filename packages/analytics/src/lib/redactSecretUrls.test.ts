import { describe, expect, it } from 'vitest';
import { redactCaptureResult, redactSecretQueryValues } from './redactSecretUrls';
import { posthogConfig } from '../config/posthog.config';

// The team invitation link carried its live token into every pageview, so
// anyone with access to analytics could claim a workspace.
describe('analytics URL redaction', () => {
  it('replaces credential query values and keeps the rest of the URL', () => {
    expect(redactSecretQueryValues('https://app.example/auth/team/setup?token=0fa27ea5&lang=fr'))
      .toBe('https://app.example/auth/team/setup?token=redacted&lang=fr');
    expect(redactSecretQueryValues('/auth/callback?ott=abc&state=s1#top')).toBe('/auth/callback?ott=redacted&state=redacted#top');
    expect(redactSecretQueryValues('/reset?reset_token=x&access_token=y')).toBe('/reset?reset_token=redacted&access_token=redacted');
    expect(redactSecretQueryValues('/msp/tickets?page=2&tokenizer=on')).toBe('/msp/tickets?page=2&tokenizer=on');
  });

  it('redacts every URL-valued property, person properties and clicked links', () => {
    const result = redactCaptureResult({
      properties: { $current_url: 'https://h/auth/team/setup?token=secret', $referrer: 'https://h/a?code=c',
        $elements_chain: 'a:attr__href="/auth/team/setup?token=secret"', path: '/auth/team/setup', count: 3 },
      $set_once: { $initial_current_url: 'https://h/auth/team/setup?token=secret' },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result?.properties).toMatchObject({ path: '/auth/team/setup', count: 3, $referrer: 'https://h/a?code=redacted' });
    expect(redactCaptureResult(null)).toBeNull();
  });

  it('redacts nested objects and arrays, including $elements and $set_once', () => {
    const when = new Date(0);
    const result = redactCaptureResult({
      properties: {
        $elements: [{ attr__href: '/auth/team/setup?token=secret', text: 'Join' }],
        nested: { deep: { link: 'https://h/x?ott=secret&page=1' } },
        count: 3,
        flag: false,
        nothing: null,
        when,
      },
      $set_once: { $initial_current_url: 'https://h/auth/team/setup?token=secret' },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result?.properties).toMatchObject({
      $elements: [{ attr__href: '/auth/team/setup?token=redacted', text: 'Join' }],
      nested: { deep: { link: 'https://h/x?ott=redacted&page=1' } },
      count: 3,
      flag: false,
      nothing: null,
      when,
    });
  });

  it('does not mutate its input', () => {
    const input = { properties: { $current_url: '/a?token=secret' } };
    redactCaptureResult(input);
    expect(input.properties.$current_url).toBe('/a?token=secret');
  });

  it('drops the event (null) on a cyclic value instead of returning it unredacted', () => {
    const properties: Record<string, unknown> = { $current_url: '/a?token=secret' };
    properties.self = properties;
    expect(redactCaptureResult({ properties })).toBeNull();
  });

  it('drops the event when a property getter throws', () => {
    const properties = {
      get boom(): string {
        throw new Error('nope');
      },
    };
    expect(redactCaptureResult({ properties })).toBeNull();
  });

  it('is the before_send hook of the shipped PostHog config', () => {
    expect(posthogConfig.defaultConfig.before_send).toBe(redactCaptureResult);
  });
});
