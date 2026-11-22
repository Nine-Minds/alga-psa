import type { IClientLocation } from '@alga-psa/types';
import { isFieldHiddenByRedaction, isResourceHiddenByRedaction } from './redaction';

const CLIENT_QUICK_VIEW_FIELD_ALIASES: Record<string, string[]> = {
  properties: ['url', 'properties.website'],
  location_email: ['email'],
  location_phone: ['phone', 'phone_no', 'fax'],
  location_phone_extension: ['phone', 'phone_no', 'fax'],
  location_country_code: ['country', 'country_code'],
  location_address: [
    'address', 'address_line1', 'address_line2', 'address_line3', 'city',
    'state_province', 'postal_code', 'country', 'country_code', 'country_name', 'region_code',
  ],
  account_manager_full_name: ['account_manager_id'],
  url: ['properties.website'],
  logoUrl: ['logo', 'properties.logo', 'client_name'],
  logoWideUrl: ['logo_wide_url', 'properties.logo', 'client_name'],
};

export function isClientQuickViewFieldHidden(redactedFields: readonly string[], field: string): boolean {
  const aliases = CLIENT_QUICK_VIEW_FIELD_ALIASES[field] ?? [];
  return isResourceHiddenByRedaction(redactedFields, ['client', 'clients'])
    || isFieldHiddenByRedaction(redactedFields, [
      field,
      `clients.${field}`,
      ...aliases,
      ...aliases.map((alias) => `clients.${alias}`),
      ...(field.startsWith('location_') ? aliases.map((alias) => `client_locations.${alias}`) : []),
    ]);
}

const CLIENT_LOCATION_FIELD_SOURCES: Partial<Record<keyof IClientLocation, string>> = {
  email: 'location_email',
  phone: 'location_phone', phone_extension: 'location_phone',
  fax: 'location_phone', fax_extension: 'location_phone',
  address_line1: 'location_address', address_line2: 'location_address', address_line3: 'location_address',
  city: 'location_address', state_province: 'location_address', postal_code: 'location_address',
  country_code: 'location_address', country_name: 'location_address', region_code: 'location_address',
};

export function isClientLocationFieldHidden(redactedFields: readonly string[], field: string): boolean {
  return isClientQuickViewFieldHidden(redactedFields, CLIENT_LOCATION_FIELD_SOURCES[field as keyof IClientLocation] ?? field)
    || isFieldHiddenByRedaction(redactedFields, [field, `clients.${field}`, `client_locations.${field}`]);
}

export function isClientLocationResourceHidden(redactedFields: readonly string[]): boolean {
  return isResourceHiddenByRedaction(redactedFields, ['client_locations'])
    || isClientLocationFieldHidden(redactedFields, 'location_id')
    || isClientLocationFieldHidden(redactedFields, 'client_id');
}
