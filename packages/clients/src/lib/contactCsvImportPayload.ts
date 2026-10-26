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
 * Tags presence comes from the column mapping, not from the cell: when Tags is
 * mapped, a blank (or missing trailing) cell is an explicit "no tags" and is
 * sent as `tags: ''`, so the action clears the contact's tags and admits
 * lifecycle for the row. When Tags is not mapped, rows carry no `tags` key and
 * the action leaves existing tags alone.
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

    if (tagsMapped) {
      contactData.tags = record.tags ?? '';
    }

    return contactData;
  });
}
