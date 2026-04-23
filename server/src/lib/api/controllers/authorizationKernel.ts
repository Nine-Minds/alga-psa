import { Knex } from 'knex';
import { getAuthorizationKernel } from 'server/src/lib/authorization/kernel';
import type {
  AuthorizationRecord,
  AuthorizationSubject,
} from '@alga-psa/authorization/kernel/contracts';

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => (typeof value === 'string' ? value : null))
    .filter((value): value is string => Boolean(value));
}

function normalizeIdArrayFromObjects(values: unknown, key: string): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => {
      if (!value || typeof value !== 'object') {
        return null;
      }

      const candidate = (value as Record<string, unknown>)[key];
      return typeof candidate === 'string' ? candidate : null;
    })
    .filter((value): value is string => Boolean(value));
}

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildAuthorizationPrincipalSubject(
  user: any,
  apiKeyId?: string
): AuthorizationSubject {
  const roleIds = Array.from(
    new Set([
      ...normalizeIdArrayFromObjects(user?.roles, 'role_id'),
      ...normalizeStringArray(user?.role_ids),
    ])
  );

  const teamIds = Array.from(
    new Set([
      ...normalizeIdArrayFromObjects(user?.teams, 'team_id'),
      ...normalizeStringArray(user?.team_ids),
    ])
  );

  const managedUserIds = Array.from(
    new Set([
      ...normalizeStringArray(user?.managed_user_ids),
      ...normalizeStringArray(user?.managedUserIds),
    ])
  );

  const portfolioClientIds = Array.from(
    new Set([
      ...normalizeStringArray(user?.portfolio_client_ids),
      ...normalizeStringArray(user?.portfolioClientIds),
    ])
  );

  const subject: AuthorizationSubject = {
    tenant: user?.tenant ?? '',
    userId: typeof user?.user_id === 'string' ? user.user_id : '',
    userType: user?.user_type === 'client' ? 'client' : 'internal',
    roleIds,
    teamIds,
    managedUserIds,
    portfolioClientIds,
  };

  const normalizedClientId = normalizeOptionalString(user?.client_id) ?? normalizeOptionalString(user?.clientId);
  if (normalizedClientId !== undefined) {
    subject.clientId = normalizedClientId;
  }

  if (typeof apiKeyId === 'string' && apiKeyId.trim().length > 0) {
    subject.apiKeyId = apiKeyId;
  }

  return subject;
}

export async function authorizeApiResourceRead(input: {
  knex: Knex;
  tenant: string;
  user: any;
  apiKeyId?: string;
  resource: string;
  recordContext: AuthorizationRecord;
}): Promise<boolean> {
  const kernel = await getAuthorizationKernel();
  const subject = buildAuthorizationPrincipalSubject(input.user, input.apiKeyId);
  subject.tenant = input.tenant;

  const decision = await kernel.authorizeResource({
    knex: input.knex as any,
    subject,
    resource: { type: input.resource, action: 'read' },
    record: input.recordContext,
  });

  return decision.allowed;
}
