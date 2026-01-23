import {
  NormalizedCompanyAddress,
  NormalizedCompanyContact,
  NormalizedCompanyPayload
} from './companySync.types';

export interface RawCompanyRecord {
  companyId: string;
  name: string;
  primaryEmail?: string | null;
  primaryPhone?: string | null;
  billingAddress?: Partial<NormalizedCompanyAddress> | null;
  shippingAddress?: Partial<NormalizedCompanyAddress> | null;
  contacts?: Array<Partial<NormalizedCompanyContact>>;
  taxNumber?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export function buildNormalizedCompanyPayload(raw: RawCompanyRecord): NormalizedCompanyPayload {
  return {
    companyId: raw.companyId,
    name: raw.name,
    primaryEmail: raw.primaryEmail ?? null,
    primaryPhone: raw.primaryPhone ?? null,
    billingAddress: raw.billingAddress ?? null,
    shippingAddress: raw.shippingAddress ?? null,
    contacts: raw.contacts?.map((contact) => ({
      type: contact.type ?? 'primary',
      name: contact.name ?? null,
      email: contact.email ?? null,
      phone: contact.phone ?? null
    })) ?? [],
    taxNumber: raw.taxNumber ?? null,
    notes: raw.notes ?? null,
    metadata: raw.metadata ?? {}
  };
}
