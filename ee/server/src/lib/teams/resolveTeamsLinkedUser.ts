import { getSSORegistry } from '@alga-psa/auth';
import { getAdminConnection } from '@alga-psa/db/admin';

interface UserRow {
  tenant: string;
  user_id: string;
  email: string | null;
  username: string | null;
  user_type: 'internal' | 'client';
}

export type TeamsLinkedUserResolution =
  | {
      status: 'linked';
      tenantId: string;
      userId: string;
      userEmail: string | null;
      username: string | null;
      providerAccountId: string;
      matchedBy: 'provider_account_id';
    }
  | {
      status: 'not_found';
      tenantId: string;
      message: string;
    };

interface ResolveTeamsLinkedUserInput {
  tenantId: string;
  microsoftAccountId?: string | null;
}

function normalizeRequiredString(value: string | null | undefined): string {
  return (value || '').trim();
}

export async function resolveTeamsLinkedUser(
  input: ResolveTeamsLinkedUserInput
): Promise<TeamsLinkedUserResolution> {
  const tenantId = normalizeRequiredString(input.tenantId);
  const microsoftAccountId = normalizeRequiredString(input.microsoftAccountId);

  if (!tenantId || !microsoftAccountId) {
    return {
      status: 'not_found',
      tenantId,
      message: 'Teams user identity is missing the Microsoft account link required for PSA mapping.',
    };
  }

  const accountLink = await getSSORegistry().findOAuthAccountLink('microsoft', microsoftAccountId);
  if (!accountLink || accountLink.tenant !== tenantId) {
    return {
      status: 'not_found',
      tenantId,
      message: 'No Microsoft account link matches this Teams user for the current tenant.',
    };
  }

  const db = await getAdminConnection();
  const user = await db<UserRow>('users')
    .select('tenant', 'user_id', 'email', 'username', 'user_type')
    .where({
      tenant: tenantId,
      user_id: accountLink.user_id,
    })
    .first();

  if (!user || user.user_type !== 'internal') {
    return {
      status: 'not_found',
      tenantId,
      message: 'No MSP user mapping matches this Teams identity for the current tenant.',
    };
  }

  return {
    status: 'linked',
    tenantId,
    userId: user.user_id,
    userEmail: user.email,
    username: user.username,
    providerAccountId: accountLink.provider_account_id,
    matchedBy: 'provider_account_id',
  };
}
