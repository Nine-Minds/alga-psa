import { describe, it, expect } from 'vitest';
import {
  resolveRequestHost,
  resolveRequestOrigin,
  resolveRequestProto,
} from '@/lib/deployment/requestHost';
import type { DeploymentCapabilities } from '@/lib/deployment/deploymentProfile';

const HOSTED: DeploymentCapabilities = { portalDomain: { provisioner: 'temporal' }, trustForwardedHost: false };
const APPLIANCE: DeploymentCapabilities = { portalDomain: { provisioner: 'direct' }, trustForwardedHost: true };

function req(headers: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name: string) => lower[name.toLowerCase()] ?? null } };
}

describe('resolveRequestHost', () => {
  it('uses the Host header and strips the port by default', () => {
    const r = resolveRequestHost(req({ host: 'portal.acme.com:3000', 'x-forwarded-host': 'evil.example.com' }), HOSTED);
    expect(r.hostname).toBe('portal.acme.com');
    expect(r.hostHeader).toBe('portal.acme.com:3000');
  });

  it('ignores X-Forwarded-Host when trustForwardedHost is false (cloud)', () => {
    const r = resolveRequestHost(req({ host: 'app.algapsa.com', 'x-forwarded-host': 'portal.acme.com' }), HOSTED);
    expect(r.hostname).toBe('app.algapsa.com');
  });

  it('honors X-Forwarded-Host when trustForwardedHost is true (appliance)', () => {
    const r = resolveRequestHost(req({ host: 'alga.acme.com', 'x-forwarded-host': 'portal.acme.com' }), APPLIANCE);
    expect(r.hostname).toBe('portal.acme.com');
    expect(r.hostHeader).toBe('portal.acme.com');
  });

  it('takes the first entry of a comma-separated X-Forwarded-Host list', () => {
    const r = resolveRequestHost(req({ host: 'alga.acme.com', 'x-forwarded-host': 'portal.acme.com, proxy.internal' }), APPLIANCE);
    expect(r.hostname).toBe('portal.acme.com');
  });

  it('falls back to Host when trust is on but no X-Forwarded-Host is present', () => {
    const r = resolveRequestHost(req({ host: 'portal.acme.com' }), APPLIANCE);
    expect(r.hostname).toBe('portal.acme.com');
  });
});

describe('resolveRequestProto', () => {
  it.each([
    [{}, null],
    [{ 'x-forwarded-proto': 'https' }, 'https'],
    [{ 'x-forwarded-proto': 'https, https' }, 'https'],
    [{ 'x-forwarded-proto': 'HTTPS , http' }, 'https'],
    [{ 'x-forwarded-proto': 'foo bar' }, null],
    [{ 'x-forwarded-proto': '' }, null],
    [{ 'x-forwarded-proto': ' , https' }, null],
  ])('parses %o as %s', (headers, expected) => {
    expect(resolveRequestProto(req(headers))).toBe(expected);
  });
});

describe('resolveRequestOrigin', () => {
  const fallbacks = { fallbackProto: 'http', fallbackHost: 'localhost:3010' };

  it('handles comma-joined appliance proxy headers without throwing', () => {
    const origin = resolveRequestOrigin(req({
      host: 'alga.internal',
      'x-forwarded-proto': 'https, https',
      'x-forwarded-host': 'portal.digitalstrength.co.uk, portal.digitalstrength.co.uk',
    }), APPLIANCE, fallbacks);

    expect(origin.toString()).toBe('https://portal.digitalstrength.co.uk/');
  });

  it('ignores X-Forwarded-Host for hosted deployments', () => {
    const origin = resolveRequestOrigin(req({
      host: 'app.algapsa.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'portal.acme.com',
    }), HOSTED, fallbacks);

    expect(origin.toString()).toBe('https://app.algapsa.com/');
  });

  it('honors X-Forwarded-Host for appliance deployments', () => {
    const origin = resolveRequestOrigin(req({
      host: 'alga.internal',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'portal.acme.com',
    }), APPLIANCE, fallbacks);

    expect(origin.toString()).toBe('https://portal.acme.com/');
  });

  it('uses caller fallbacks when forwarded headers and Host are absent', () => {
    expect(resolveRequestOrigin(req({}), HOSTED, fallbacks).toString())
      .toBe('http://localhost:3010/');
  });

  it('falls back rather than throwing for a URL-hostile Host header', () => {
    expect(resolveRequestOrigin(req({ host: 'bad host' }), HOSTED, fallbacks).toString())
      .toBe('http://localhost:3010/');
  });
});
