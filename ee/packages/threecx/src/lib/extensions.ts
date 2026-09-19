import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { createThreecxPbxClient, odataPageAll, type CreateThreecxPbxClientOptions } from './pbx/client';
import {
  getThreecxProviderState,
  updateThreecxConfig,
  type ThreecxExtensionMapping,
  type ThreecxProviderConfig,
  type ThreecxProviderState,
} from './providerState';

/** The subset of Pbx.User the extension map needs. */
export interface ThreecxPbxUser {
  Id?: number;
  Number: string;
  FirstName?: string | null;
  LastName?: string | null;
  EmailAddress?: string | null;
  Enabled?: boolean;
}

export function extensionForUser(config: Pick<ThreecxProviderConfig, 'extensions'>, userId: string | null | undefined): string | null {
  if (!userId) return null;
  return config.extensions.find((row) => row.userId === userId)?.dn ?? null;
}

export function userForExtension(config: Pick<ThreecxProviderConfig, 'extensions'>, dn: string | null | undefined): string | null {
  if (!dn) return null;
  return config.extensions.find((row) => row.dn === dn)?.userId ?? null;
}

function displayName(user: ThreecxPbxUser): string {
  return [user.FirstName, user.LastName].map((part) => (part ?? '').trim()).filter(Boolean).join(' ');
}

/**
 * Pure merge: PBX users become rows, manual mappings survive, auto mappings
 * follow the PBX email, extensions the PBX no longer lists are dropped.
 */
export function mergeThreecxExtensions(
  existing: ThreecxExtensionMapping[],
  pbxUsers: ThreecxPbxUser[],
  userIdByEmail: Map<string, string>,
): ThreecxExtensionMapping[] {
  const previous = new Map(existing.map((row) => [row.dn, row]));
  const merged: ThreecxExtensionMapping[] = [];
  for (const user of pbxUsers) {
    if (user.Enabled === false) continue;
    const dn = (user.Number ?? '').trim();
    if (!dn) continue;
    const pbxEmail = (user.EmailAddress ?? '').trim();
    const prior = previous.get(dn);
    if (prior?.mappedBy === 'manual' && prior.userId) {
      merged.push({ ...prior, pbxDisplayName: displayName(user), pbxEmail });
      continue;
    }
    const autoUserId = pbxEmail ? (userIdByEmail.get(pbxEmail.toLowerCase()) ?? null) : null;
    merged.push({
      dn,
      pbxDisplayName: displayName(user),
      pbxEmail,
      userId: autoUserId,
      mappedBy: autoUserId ? 'auto' : null,
    });
  }
  merged.sort((a, b) => a.dn.localeCompare(b.dn, undefined, { numeric: true }));
  return merged;
}

export async function syncThreecxExtensions(
  tenantId: string,
  options: CreateThreecxPbxClientOptions = {},
): Promise<ThreecxProviderState> {
  const client = await createThreecxPbxClient(tenantId, options);
  const pbxUsers = await odataPageAll<ThreecxPbxUser>(client, '/Users', {
    $select: 'Id,Number,FirstName,LastName,EmailAddress,Enabled',
  });

  const { knex } = await createTenantKnex(tenantId);
  const users: Array<{ user_id: string; email: string | null }> = await tenantDb(knex, tenantId)
    .table('users')
    .where({ user_type: 'internal' })
    .select('user_id', 'email');
  const userIdByEmail = new Map<string, string>();
  for (const user of users) {
    if (user.email) userIdByEmail.set(user.email.trim().toLowerCase(), user.user_id);
  }

  await updateThreecxConfig(
    tenantId,
    (config) => ({
      ...config,
      extensions: mergeThreecxExtensions(config.extensions, pbxUsers, userIdByEmail),
      extensionsSyncedAt: new Date().toISOString(),
    }),
    knex,
  );
  return getThreecxProviderState(tenantId);
}

export async function setThreecxExtensionUser(
  tenantId: string,
  input: { dn: string; userId: string | null },
): Promise<ThreecxProviderState> {
  const dn = (input.dn ?? '').trim();
  await updateThreecxConfig(tenantId, (config) => {
    const index = config.extensions.findIndex((row) => row.dn === dn);
    if (index === -1) {
      throw new Error(`Extension ${dn || '(blank)'} is not in the synced list.`);
    }
    const extensions = config.extensions.slice();
    extensions[index] = {
      ...extensions[index],
      userId: input.userId,
      mappedBy: input.userId ? 'manual' : null,
    };
    return { ...config, extensions };
  });
  return getThreecxProviderState(tenantId);
}
