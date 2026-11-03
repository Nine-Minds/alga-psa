import type {
  ContactEmailAddressInput,
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
export type ContactCsvImportData = Omit<Partial<IContact>, 'additional_email_addresses' | 'primary_email_type'> & {
  additional_email_addresses?: ContactEmailAddressInput[];
  primary_email_custom_type?: string | null;
  tags?: string;
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
