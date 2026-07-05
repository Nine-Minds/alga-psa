import { describe, it, expect } from 'vitest';
import { detectForwardedHostRewrite } from '@/lib/deployment/requestHost';
import type { DeploymentCapabilities } from '@/lib/deployment/deploymentProfile';

const HOSTED: DeploymentCapabilities = { portalDomain: { provisioner: 'temporal' }, trustForwardedHost: false };
const APPLIANCE: DeploymentCapabilities = { portalDomain: { provisioner: 'direct' }, trustForwardedHost: true };

function req(headers: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name: string) => lower[name.toLowerCase()] ?? null } };
}

describe('detectForwardedHostRewrite (Host-rewrite tell-tale)', () => {
  const CANONICAL = 'alga.acme.com';

  it('fires when Host is the canonical host but X-Forwarded-Host names a different host', () => {
    const r = detectForwardedHostRewrite(
      req({ host: 'alga.acme.com', 'x-forwarded-host': 'portal.acme.com' }),
      APPLIANCE,
      CANONICAL
    );
    expect(r).toEqual({ forwardedHost: 'portal.acme.com' });
  });

  it('stays silent in the healthy case (Host preserved as the vanity domain)', () => {
    const r = detectForwardedHostRewrite(
      req({ host: 'portal.acme.com', 'x-forwarded-host': 'portal.acme.com' }),
      APPLIANCE,
      CANONICAL
    );
    expect(r).toBeNull();
  });

  it('stays silent when there is no X-Forwarded-Host', () => {
    expect(detectForwardedHostRewrite(req({ host: 'alga.acme.com' }), APPLIANCE, CANONICAL)).toBeNull();
  });

  it('does not fire when trustForwardedHost is off (cloud)', () => {
    const r = detectForwardedHostRewrite(
      req({ host: 'alga.acme.com', 'x-forwarded-host': 'portal.acme.com' }),
      HOSTED,
      CANONICAL
    );
    expect(r).toBeNull();
  });

  it('does not fire when Host is some non-canonical host (normal proxy chain)', () => {
    const r = detectForwardedHostRewrite(
      req({ host: 'internal-lb.local', 'x-forwarded-host': 'portal.acme.com' }),
      APPLIANCE,
      CANONICAL
    );
    expect(r).toBeNull();
  });
});
