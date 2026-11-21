import type {
  ContactEmailAddressInput,
  ContactWorkArrangement,
  ICSVColumnMapping,
  IContact,
  MappableField,
} from '@alga-psa/types';
import {
  parseContactCsvAdditionalEmailAddresses,
  parseContactCsvEmailType,
} from './contactCsvEmailFields';

/** One CSV row keyed by the contact field its column is mapped to. */
export type ContactCsvRecord = Partial<Record<MappableField, string>>;

/** The row shape `importContactsFromCSV` receives. */
export type ContactCsvImportData = Omit<Partial<IContact>, 'additional_email_addresses' | 'primary_email_type' | 'locations'> & {
  additional_email_addresses?: ContactEmailAddressInput[];
  primary_email_custom_type?: string | null;
  tags?: string;
  /** "Warehouse; Head office" as written in the CSV; resolved to ids by name during the import. */
  location_names?: string[];
  /** The name in the primary_location column, which must also appear in location_names. */
  primary_location_name?: string | null;
};

/**
 * Turns mapped CSV records into the rows the contact import action receives.
 *
 * Tags presence is decided by two conditions: the Tags column is mapped AND the
 * row's trimmed cell is non-empty. A blank cell means "no opinion", so the row
 * carries no `tags` key and the action neither deletes nor writes tags (and
 * emits no tag events); only a non-blank cell states the contact's tag set, and
 * then it replaces the existing one.
 */
export function buildContactCsvImportRows(
  records: ContactCsvRecord[],
  columnMappings: ICSVColumnMapping[],
  clients: { client_id: string; client_name: string }[],
): ContactCsvImportData[] {
  const tagsMapped = columnMappings.some((mapping) => mapping.contactField === 'tags');
  const locationsMapped = columnMappings.some((mapping) => mapping.contactField === 'locations');

  return records.map((record): ContactCsvImportData => {
    const client = clients.find((c) => c.client_name === record.client);
    const parsedPrimaryEmailType = record.primary_email_type
      ? parseContactCsvEmailType(record.primary_email_type)
      : {};
    const parsedAdditionalEmailRows = Object.prototype.hasOwnProperty.call(record, 'additional_email_addresses')
      ? parseContactCsvAdditionalEmailAddresses(record.additional_email_addresses, record.email).rows
      : undefined;

    const contactData: ContactCsvImportData = {
      full_name: record.full_name,
      email: record.email,
      phone_number: record.phone_number,
      client_id: client?.client_id || null,
      role: record.role,
      notes: record.notes,
      is_inactive: false,
      primary_email_canonical_type: parsedPrimaryEmailType.canonicalType,
      additional_email_addresses: parsedAdditionalEmailRows,
    };

    if (record.work_arrangement !== undefined) {
      const arrangement = record.work_arrangement.trim().toLowerCase().replace(/[\s-]+/g, '_');
      contactData.work_arrangement = arrangement === '' ? null : (arrangement as ContactWorkArrangement);
    }

    // A blank Locations cell is "no opinion" (the key is absent, so links are left alone); a
    // mapped, non-blank cell states the whole set. Names are resolved against the contact's own
    // client during the import, where an unknown one fails that row by name.
    if (locationsMapped) {
      const names = (record.locations ?? '').split(';').map((name) => name.trim()).filter(Boolean);
      if (names.length > 0 || (record.locations ?? '').trim() !== '') {
        contactData.location_names = names;
      }
    }
    const primaryLocation = record.primary_location?.trim();
    if (primaryLocation) {
      contactData.primary_location_name = primaryLocation;
      if (contactData.location_names === undefined) contactData.location_names = [primaryLocation];
      else if (!contactData.location_names.includes(primaryLocation)) {
        contactData.location_names = [...contactData.location_names, primaryLocation];
      }
    }

    if (parsedPrimaryEmailType.customType !== undefined) {
      contactData.primary_email_custom_type = parsedPrimaryEmailType.customType;
    }

    const tagsCell = record.tags?.trim();
    if (tagsMapped && tagsCell) {
      contactData.tags = record.tags;
    }

    return contactData;
  });
}
