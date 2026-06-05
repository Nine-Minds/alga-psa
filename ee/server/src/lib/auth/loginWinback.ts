import { getAdminConnection } from '@alga-psa/db/admin';
import {
  resolveBillingAdminEmailForTenant,
} from '@enterprise/lib/billing/tenantReactivationDetection';
import { createTenantReactivationToken } from '@enterprise/lib/billing/tenantReactivationTokens';
import {
  buildReactivationCheckoutUrl,
  sendLoginWinbackEmail,
} from '@enterprise/lib/billing/reactivationInviteEmail';

export const isEnterpriseLoginWinbackHookAvailable = true;

export async function handleInactiveLoginWinback(input: {
  tenantId: string;
}): Promise<void> {
  const knex = await getAdminConnection();
  const rows = await knex('pending_tenant_deletions')
    .where({ tenant: input.tenantId })
    .whereIn('status', ['pending', 'awaiting_confirmation', 'confirmed'])
    .where((builder: any) => {
      builder
        .whereNull('last_winback_email_at')
        .orWhere(
          'last_winback_email_at',
          '<',
          knex.raw(`NOW() - INTERVAL '14 days'`),
        );
    })
    .update({
      last_winback_email_at: knex.fn.now(),
    })
    .returning([
      'deletion_id',
      'scheduled_deletion_date',
      'deletion_scheduled_for',
    ]);

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return;
  }

  const adminEmail = await resolveBillingAdminEmailForTenant(input.tenantId, knex);
  if (!adminEmail?.email) {
    return;
  }

  const token = await createTenantReactivationToken({
    tenantId: input.tenantId,
    deletionId: row.deletion_id,
    knex,
  });

  await sendLoginWinbackEmail({
    to: adminEmail.email,
    tenantId: input.tenantId,
    tenantName: null,
    effectiveDeletionDate: row.deletion_scheduled_for ?? row.scheduled_deletion_date ?? null,
    reactivationUrl: buildReactivationCheckoutUrl(token.token),
  });
}
