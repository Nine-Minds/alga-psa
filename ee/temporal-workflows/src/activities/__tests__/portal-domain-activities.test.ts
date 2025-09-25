import { describe, expect, it } from 'vitest';

import type { PortalDomainActivityRecord } from '../../workflows/portal-domains/types.js';
import type { PortalDomainConfig } from '../portal-domain-activities.js';
import { renderPortalDomainResources } from '../portal-domain-activities.js';

function createRecord(overrides: Partial<PortalDomainActivityRecord> = {}): PortalDomainActivityRecord {
  const base: PortalDomainActivityRecord = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenant: '123e4567-e89b-12d3-a456-426614174000',
    domain: 'Example.COM ',
    canonical_host: '123e456.portal.algapsa.com',
    status: 'pending_certificate',
    status_message: null,
    verification_details: {},
    certificate_secret_name: null,
    last_synced_resource_version: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return { ...base, ...overrides };
}

const baseConfig: PortalDomainConfig = {
  certificateApiVersion: 'cert-manager.io/v1',
  certificateNamespace: 'msp',
  certificateIssuerName: 'letsencrypt-dns',
  certificateIssuerKind: 'ClusterIssuer',
  certificateIssuerGroup: 'cert-manager.io',
  gatewayNamespace: 'istio-system',
  gatewaySelector: { istio: 'ingressgateway' },
  gatewayHttpPort: 80,
  gatewayHttpsPort: 443,
  virtualServiceNamespace: 'msp',
  serviceHost: 'sebastian.msp.svc.cluster.local',
  servicePort: 3000,
  challengeServiceHost: null,
  challengeServicePort: null,
  challengeRouteEnabled: true,
  redirectHttpToHttps: true,
  manifestOutputDirectory: null,
};

describe('renderPortalDomainResources', () => {
  it('produces manifests using sanitized domain and tenant slug', () => {
    const record = createRecord();
    const manifests = renderPortalDomainResources(record, baseConfig);

    expect(manifests.secretName).toBe('portal-domain-123e456');
    expect(manifests.certificate.metadata.namespace).toBe('msp');
    expect(manifests.certificate.spec.secretName).toBe(manifests.secretName);
    expect(manifests.certificate.spec.dnsNames).toEqual(['example.com']);
    expect(manifests.gateway.metadata.name).toBe('portal-domain-gw-123e456');
    expect(manifests.gateway.spec.servers).toHaveLength(2);
    expect(manifests.gateway.spec.servers[1].tls.credentialName).toBe(manifests.secretName);
    expect(manifests.virtualService.metadata.namespace).toBe('msp');
    expect(manifests.virtualService.spec.gateways).toEqual(['istio-system/portal-domain-gw-123e456']);
    expect(manifests.virtualService.spec.http).toHaveLength(3);

    const [challengeRoute, redirectRoute, httpsRoute] =
      manifests.virtualService.spec.http ?? [];

    expect(challengeRoute?.match?.[0]?.uri?.prefix).toBe(
      '/.well-known/acme-challenge/',
    );
    expect(challengeRoute?.match?.[0]?.port).toBe(80);
    expect(challengeRoute?.route?.[0]?.destination?.host).toBe(
      baseConfig.serviceHost,
    );

    expect(redirectRoute?.match?.[0]?.port).toBe(80);
    expect(redirectRoute?.redirect?.scheme).toBe('https');
    expect(redirectRoute?.redirect?.port).toBe(443);

    expect(httpsRoute?.match?.[0]?.port).toBe(443);
    expect(httpsRoute?.route?.[0]?.destination?.host).toBe(
      baseConfig.serviceHost,
    );

    const labels = manifests.gateway.metadata.labels ?? {};
    expect(labels['portal.alga-psa.com/domain-host']).toBe('example.com');
    expect(labels['portal.alga-psa.com/tenant']).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('adds HTTP-01 challenge routing when enabled', () => {
    const config: PortalDomainConfig = {
      ...baseConfig,
      challengeRouteEnabled: true,
      challengeServiceHost: 'challenge-svc.msp.svc.cluster.local',
      challengeServicePort: 8089,
    };
    const record = createRecord({ domain: 'customer.portal.example.com' });

    const manifests = renderPortalDomainResources(record, config);

    expect(manifests.virtualService.spec.http).toHaveLength(3);
    const [challengeRoute, redirectRoute, httpsRoute] =
      manifests.virtualService.spec.http ?? [];
    expect(challengeRoute?.match?.[0]?.uri?.prefix).toBe('/.well-known/acme-challenge/');
    expect(challengeRoute?.route?.[0]?.destination?.host).toBe('challenge-svc.msp.svc.cluster.local');
    expect(challengeRoute?.route?.[0]?.destination?.port?.number).toBe(8089);

    expect(redirectRoute?.redirect?.scheme).toBe('https');
    expect(redirectRoute?.redirect?.port).toBe(443);

    expect(httpsRoute?.route?.[0]?.destination?.host).toBe(
      baseConfig.serviceHost,
    );
  });
});
