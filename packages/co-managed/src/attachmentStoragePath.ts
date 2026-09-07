import { isCoManagedUuid, CoManagedSharedWorkError } from './sharedWorkIdentity';
/** Purpose-separated staging paths cannot overwrite ordinary uploads, even if
 * another command reserves the future published file UUID before publication. */
export function disclosedAttachmentPath(customer: string, sponsor: string, operation: string, file: string): string {
  if (![customer, sponsor, operation, file].every(isCoManagedUuid) || customer === sponsor) throw new CoManagedSharedWorkError();
  return `co-management/${customer}/disclosures/${sponsor}/${operation}/${file}`;
}
export function assertCoManagedAttachmentPath(row: { tenant: string; attachment_id: string; storage_path: string;
  disclosure_operation_id?: string | null; disclosure_sponsor_tenant?: string | null }): string {
  const expected = row.disclosure_operation_id
    ? disclosedAttachmentPath(row.tenant, row.disclosure_sponsor_tenant!, row.disclosure_operation_id, row.attachment_id)
    : `co-management/${row.tenant}/${row.attachment_id}`;
  if (row.storage_path !== expected || (!row.disclosure_operation_id && row.disclosure_sponsor_tenant)) throw new CoManagedSharedWorkError();
  return expected;
}
