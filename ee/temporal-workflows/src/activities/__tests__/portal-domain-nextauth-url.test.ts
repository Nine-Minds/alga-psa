import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import type { PortalDomainActivityRecord } from "../../workflows/portal-domains/types.js";
import type { PortalDomainConfig } from "../portal-domain-activities.js";
import { renderPortalDomainResources } from "../portal-domain-activities.js";

// Mock the PortalDomainModel to use our actual computeCanonicalHost function
vi.mock("server/src/models/PortalDomainModel", async () => {
  const actual = await vi.importActual<
    typeof import("server/src/models/PortalDomainModel")
  >("server/src/models/PortalDomainModel");
  return {
    ...actual,
    // Use the real computeCanonicalHost function to test NEXTAUTH_URL logic
    computeCanonicalHost: actual.computeCanonicalHost,
  };
});

function createRecord(
  overrides: Partial<PortalDomainActivityRecord> = {},
): PortalDomainActivityRecord {
  const base: PortalDomainActivityRecord = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    tenant: "tenant-123",
    domain: "custom.example.com",
    canonical_host: "tenant-.portal.algapsa.com", // Will be overridden based on NEXTAUTH_URL
    status: "pending_certificate",
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
  certificateApiVersion: "cert-manager.io/v1",
  certificateNamespace: "msp",
  certificateIssuerName: "letsencrypt-dns",
  certificateIssuerKind: "ClusterIssuer",
  certificateIssuerGroup: "cert-manager.io",
  gatewayNamespace: "istio-system",
  gatewaySelector: { istio: "ingressgateway" },
  gatewayHttpsPort: 443,
  virtualServiceNamespace: "msp",
  serviceHost: "sebastian.msp.svc.cluster.local",
  servicePort: 3000,
  manifestOutputDirectory: null,
};

describe("portal domain certificate generation with NEXTAUTH_URL", () => {
  let originalNextAuthUrl: string | undefined;
  const expectedSlug = "123e4567-e89b-12d3-a456-426614174000";

  beforeEach(() => {
    // Store original NEXTAUTH_URL to restore later
    originalNextAuthUrl = process.env.NEXTAUTH_URL;
  });

  afterEach(() => {
    // Restore original NEXTAUTH_URL
    if (originalNextAuthUrl !== undefined) {
      process.env.NEXTAUTH_URL = originalNextAuthUrl;
    } else {
      delete process.env.NEXTAUTH_URL;
    }
  });

  it("generates certificate with staging domain from NEXTAUTH_URL", async () => {
    // Set staging environment
    process.env.NEXTAUTH_URL = "https://sebastian.9minds.ai";

    const record = createRecord({
      canonical_host: "tenant-.portal.sebastian.9minds.ai",
    });

    const manifests = renderPortalDomainResources(record, baseConfig);

    // Verify Certificate resource
    expect(manifests.certificate.metadata.namespace).toBe("msp");
    expect(manifests.certificate.spec.secretName).toBe(
      `portal-domain-${expectedSlug}`,
    );
    expect(manifests.certificate.spec.dnsNames).toEqual(["custom.example.com"]);
    expect(manifests.certificate.spec.issuerRef.name).toBe("letsencrypt-dns");
    expect(manifests.certificate.spec.issuerRef.kind).toBe("ClusterIssuer");

    // Verify Gateway resource uses correct domain
    expect(manifests.gateway.metadata.name).toBe(
      `portal-domain-gw-${expectedSlug}`,
    );
    expect(manifests.gateway.metadata.namespace).toBe("istio-system");
    expect(manifests.gateway.spec.servers).toHaveLength(1);

    // Check HTTPS server configuration
    const httpsServer = manifests.gateway.spec.servers[0];
    expect(httpsServer.hosts).toEqual(["custom.example.com"]);
    expect(httpsServer.tls.credentialName).toBe(
      `portal-domain-${expectedSlug}`,
    );

    // Verify VirtualService resource
    expect(manifests.virtualService.metadata.namespace).toBe("msp");
    expect(manifests.virtualService.spec.hosts).toEqual(["custom.example.com"]);
    expect(manifests.virtualService.spec.gateways).toEqual([
      `istio-system/portal-domain-gw-${expectedSlug}`,
    ]);

    // Verify HTTPS routing only (HTTP handled by cert-manager solver)
    expect(manifests.virtualService.spec.http).toHaveLength(1);

    const [httpsRoute] = manifests.virtualService.spec.http ?? [];

    expect(httpsRoute?.match?.[0]?.port).toBe(443);
    expect(httpsRoute?.route?.[0]?.destination?.host).toBe(
      baseConfig.serviceHost,
    );
    expect(httpsRoute?.route?.[0]?.destination?.port?.number).toBe(3000);

    // Verify labels contain correct domain information
    const labels = manifests.gateway.metadata.labels ?? {};
    expect(labels["portal.alga-psa.com/domain-host"]).toBe(
      "custom.example.com",
    );
    expect(labels["portal.alga-psa.com/tenant"]).toBe("tenant-123");
  });

  it("generates certificate with production domain from NEXTAUTH_URL", async () => {
    // Set production environment
    process.env.NEXTAUTH_URL = "https://app.algapsa.com";

    const record = createRecord({
      canonical_host: "tenant-.portal.app.algapsa.com",
    });

    const manifests = renderPortalDomainResources(record, baseConfig);

    // Verify Certificate resource for production
    expect(manifests.certificate.metadata.namespace).toBe("msp");
    expect(manifests.certificate.spec.secretName).toBe(
      `portal-domain-${expectedSlug}`,
    );
    expect(manifests.certificate.spec.dnsNames).toEqual(["custom.example.com"]);

    // Verify Gateway uses production domain reference in naming
    expect(manifests.gateway.metadata.name).toBe(
      `portal-domain-gw-${expectedSlug}`,
    );
    expect(manifests.gateway.spec.servers[0].tls.credentialName).toBe(
      `portal-domain-${expectedSlug}`,
    );

    // Verify VirtualService routing for production
    expect(manifests.virtualService.spec.hosts).toEqual(["custom.example.com"]);
    expect(manifests.virtualService.spec.gateways).toEqual([
      `istio-system/portal-domain-gw-${expectedSlug}`,
    ]);

    expect(manifests.virtualService.spec.http).toHaveLength(1);
    const [httpsRoute] = manifests.virtualService.spec.http ?? [];

    expect(httpsRoute?.match?.[0]?.port).toBe(443);
    expect(httpsRoute?.route?.[0]?.destination?.host).toBe(
      baseConfig.serviceHost,
    );
  });

  it("generates certificate with fallback domain when NEXTAUTH_URL is not set", async () => {
    // Remove NEXTAUTH_URL to test fallback
    delete process.env.NEXTAUTH_URL;

    const record = createRecord({
      canonical_host: "tenant-.portal.algapsa.com",
    });

    const manifests = renderPortalDomainResources(record, baseConfig);

    // Verify Certificate resource uses fallback domain
    expect(manifests.certificate.metadata.namespace).toBe("msp");
    expect(manifests.certificate.spec.secretName).toBe(
      `portal-domain-${expectedSlug}`,
    );
    expect(manifests.certificate.spec.dnsNames).toEqual(["custom.example.com"]);

    // Verify Gateway uses fallback domain reference
    expect(manifests.gateway.metadata.name).toBe(
      `portal-domain-gw-${expectedSlug}`,
    );
    expect(manifests.gateway.spec.servers[0].tls.credentialName).toBe(
      `portal-domain-${expectedSlug}`,
    );

    // Verify VirtualService routing for fallback
    expect(manifests.virtualService.spec.hosts).toEqual(["custom.example.com"]);
    expect(manifests.virtualService.spec.gateways).toEqual([
      `istio-system/portal-domain-gw-${expectedSlug}`,
    ]);

    expect(manifests.virtualService.spec.http).toHaveLength(1);
    const [httpsRoute] = manifests.virtualService.spec.http ?? [];

    expect(httpsRoute?.match?.[0]?.port).toBe(443);
    expect(httpsRoute?.route?.[0]?.destination?.host).toBe(
      baseConfig.serviceHost,
    );
  });

});
