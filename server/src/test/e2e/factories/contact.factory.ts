/**
 * Contact Factory for E2E Tests
 * Creates contact test data with realistic values
 */

import { faker } from '@faker-js/faker';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import type { ContactEmailAddressInput, ContactEmailCanonicalType } from '@alga-psa/shared/interfaces/contact.interfaces';

interface ContactInput {
  tenant: string;
  client_id?: string;
  full_name?: string;
  email?: string;
  primary_email_canonical_type?: ContactEmailCanonicalType | null;
  primary_email_custom_type?: string | null;
  additional_email_addresses?: ContactEmailAddressInput[];
  phone_number?: string;
  role?: string;
  notes?: string;
  is_inactive?: boolean;
}

function normalizeAdditionalEmailAddresses(
  rows: ContactEmailAddressInput[] | undefined
): ContactEmailAddressInput[] {
  return (rows ?? []).map((row, index) => ({
    ...row,
    display_order: row.display_order ?? index,
  }));
}

export async function contactFactory(db: any, input: ContactInput) {
  const clientId = input.client_id || null;
  const phoneNumber = input.phone_number || faker.phone.number();

  return db.transaction((trx: any) => ContactModel.createContact({
    full_name: input.full_name || faker.person.fullName(),
    email: input.email || faker.internet.email().toLowerCase(),
    primary_email_canonical_type:
      input.primary_email_canonical_type ?? (input.primary_email_custom_type ? null : 'work'),
    primary_email_custom_type: input.primary_email_custom_type ?? undefined,
    additional_email_addresses: normalizeAdditionalEmailAddresses(input.additional_email_addresses),
    client_id: clientId || undefined,
    phone_numbers: phoneNumber ? [{
      phone_number: phoneNumber,
      canonical_type: 'work',
      is_default: true,
      display_order: 0,
    }] : [],
    role: input.role || faker.person.jobTitle(),
    notes: input.notes || faker.lorem.sentence(),
    is_inactive: input.is_inactive !== undefined ? input.is_inactive : false,
  }, input.tenant, trx));
}
