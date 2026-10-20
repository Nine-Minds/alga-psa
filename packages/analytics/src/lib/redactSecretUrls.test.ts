import { describe, expect, it } from 'vitest';
import { redactCaptureResult, redactSecretQueryValues } from './redactSecretUrls';

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
});
