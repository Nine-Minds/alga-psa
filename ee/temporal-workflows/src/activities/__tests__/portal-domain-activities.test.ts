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
  gatewayHttpsPort: 443,
  virtualServiceNamespace: 'msp',
  serviceHost: 'sebastian.msp.svc.cluster.local',
  servicePort: 3000,
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
    expect(manifests.gateway.spec.servers).toHaveLength(1);
    expect(manifests.gateway.spec.servers[0].tls.credentialName).toBe(manifests.secretName);
    expect(manifests.virtualService.metadata.namespace).toBe('msp');
    expect(manifests.virtualService.spec.gateways).toEqual(['istio-system/portal-domain-gw-123e456']);
    expect(manifests.virtualService.spec.http).toHaveLength(1);
    const [httpsRoute] = manifests.virtualService.spec.http ?? [];
    expect(httpsRoute?.match?.[0]?.port).toBe(443);
    expect(httpsRoute?.route?.[0]?.destination?.host).toBe(
      baseConfig.serviceHost,
    );

    const labels = manifests.gateway.metadata.labels ?? {};
    expect(labels['portal.alga-psa.com/domain-host']).toBe('example.com');
    expect(labels['portal.alga-psa.com/tenant']).toBe('123e4567-e89b-12d3-a456-426614174000');
  });
});
