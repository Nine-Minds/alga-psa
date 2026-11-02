import type { LabelTenantClient, QuoteViewModel, WasmInvoiceViewModel } from '@alga-psa/types';
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

/**
 * The label (work-tag) sample carries `tenantClient` in the camelCase `LabelTenantClient` shape, not
 * the snake_case party block the document samples use, so it needs its own overlay. `brandText` follows
 * the renderer's rule (the name shows as text only when there is no logo); `buildLabelModel` re-derives
 * it afterwards anyway, but the overlay keeps the sample self-consistent.
 */
export function overlayLabelSampleTenant<T extends { tenantClient?: LabelTenantClient | null }>(
  model: T,
  party: TenantParty | null,
): T {
  if (!party) {
    return model;
  }
  const logoUrl = party.logo_url ?? null;
  return {
    ...model,
    tenantClient: {
      name: party.name,
      logoUrl,
      brandText: logoUrl ? null : party.name,
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
