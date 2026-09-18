import type { QuoteViewModel, WasmInvoiceViewModel } from '@alga-psa/types';
import type { TenantParty } from '../../../lib/adapters/tenantPartyAdapter';

/**
 * Overlays the tenant's real "Your Company" branding onto a preview sample so designers see the
 * logo, name, and address their clients will see. Pure and client-safe: the sample scenarios are
 * module-level singletons, so every helper returns a new object and never mutates its input.
 * A null party (no default tenant company) leaves the sample untouched, keeping the synthetic
 * issuer rather than a blank header.
 */

export function overlayQuoteSampleTenant(data: QuoteViewModel, party: TenantParty | null): QuoteViewModel {
  if (!party) {
    return data;
  }
  return {
    ...data,
    tenant: {
      name: party.name,
      address: party.address ?? null,
      email: party.email ?? null,
      phone: party.phone ?? null,
      logo_url: party.logo_url ?? null,
    },
  };
}

export function overlayInvoiceSampleTenant(
  data: WasmInvoiceViewModel,
  party: TenantParty | null,
): WasmInvoiceViewModel {
  if (!party) {
    return data;
  }
  return {
    ...data,
    tenantClient: {
      name: party.name,
      address: party.address ?? null,
      logoUrl: party.logo_url ?? null,
    },
  };
}

export function overlaySalesOrderSampleTenant(
  model: Record<string, unknown>,
  party: TenantParty | null,
): Record<string, unknown> {
  if (!party) {
    return model;
  }
  return {
    ...model,
    tenantClient: {
      name: party.name,
      address: party.address ?? null,
      email: party.email ?? null,
      phone: party.phone ?? null,
      logo_url: party.logo_url ?? null,
    },
  };
}
