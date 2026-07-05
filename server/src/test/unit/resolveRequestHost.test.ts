import { describe, it, expect } from 'vitest';
import { resolveRequestHost } from '@/lib/deployment/requestHost';
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
