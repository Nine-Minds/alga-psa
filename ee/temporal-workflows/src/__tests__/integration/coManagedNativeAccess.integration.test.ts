import { registerNativeAccessTests } from './helpers/coManagedNativeAccessCases';
import { bootstrapCoManagedCustomer } from '../../activities/co-managed-provisioning-activities';
import { getAdminConnection, tenantDb } from '@alga-psa/db';

registerNativeAccessTests(async input => {
  await bootstrapCoManagedCustomer(input);
  const db = await getAdminConnection();
  const operation = await tenantDb(db, input.sponsorTenant).table('co_managed_provisioning_operations')
    .where('operation_id', input.operationId).first();
  const invitation = await tenantDb(db, operation.customer_tenant).table('user_invitations').first();
  return { token: invitation.token, close: async () => undefined };
});
