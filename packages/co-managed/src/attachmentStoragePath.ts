import { isCoManagedUuid, CoManagedSharedWorkError } from './sharedWorkIdentity';
/** Purpose-separated staging paths cannot overwrite ordinary uploads, even if
 * another command reserves the future published file UUID before publication. */
export function disclosedAttachmentPath(customer: string, sponsor: string, operation: string, file: string, kind: string = 'ticket'): string {
  if (![customer, sponsor, operation, file].every(isCoManagedUuid) || customer === sponsor || !['ticket','project_task'].includes(kind)) throw new CoManagedSharedWorkError();
  return `co-management/${customer}/${kind === 'project_task' ? 'task-disclosures' : 'disclosures'}/${sponsor}/${operation}/${file}`;
}
export function assertCoManagedAttachmentPath(row: { tenant: string; attachment_id: string; storage_path: string;
  project_task_id?: string | null; disclosure_operation_id?: string | null; disclosure_sponsor_tenant?: string | null }): string {
  const expected = row.disclosure_operation_id
    ? disclosedAttachmentPath(row.tenant, row.disclosure_sponsor_tenant!, row.disclosure_operation_id, row.attachment_id, row.project_task_id ? 'project_task' : 'ticket')
    : `co-management/${row.tenant}/${row.attachment_id}`;
  if (row.storage_path !== expected || (!row.disclosure_operation_id && row.disclosure_sponsor_tenant)) throw new CoManagedSharedWorkError();
  return expected;
}
