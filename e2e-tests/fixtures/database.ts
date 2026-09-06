import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { getDefaultRoles } from '../../server/migrations/utils/permissions/roleGrants.cjs';
import { reconcileAllTenants } from '../../server/migrations/utils/permissions/reconcileTenants.cjs';

export interface BrowserActor {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
  userType: 'internal' | 'client';
  contactId?: string;
  clientId?: string;
}

export interface BrowserTenant {
  tenantId: string;
  name: string;
  admin: BrowserActor;
  technician: BrowserActor;
  portal: BrowserActor;
  siblingPortal: BrowserActor;
  clients: { primary: { id: string; name: string }; sibling: { id: string; name: string } };
}

export interface BrowserActors {
  runId: string;
  primary: BrowserTenant;
  secondary: BrowserTenant;
}

/**
 * Fixture preconditions only. The caller owns a disposable migrated database.
 * Reuse the isolated installation's working password hash so real sign-in uses
 * the same password verification/secret configuration as its seeded account.
 * Never return password hashes or manufacture cookies/API authentication.
 */
export async function createProductionBrowserActors(
  db: Knex,
  { sourceEmail, runId = randomUUID() }: { sourceEmail: string; runId?: string },
): Promise<BrowserActors> {
  if (!sourceEmail || !/^[a-z0-9-]{8,64}$/i.test(runId)) throw new Error('Browser fixtures require a source email and a unique run identifier');
  return db.transaction(async trx => {
    const sources = await trx('users').where({ email: sourceEmail, user_type: 'internal', is_inactive: false })
      .select('hashed_password');
    if (sources.length !== 1 || !sources[0].hashed_password?.includes(':')) {
      throw new Error('Expected exactly one initialized isolated-installation password account');
    }
    const names = ['primary', 'secondary'].map(label => `Browser ${label} ${runId}`);
    if (await trx('tenants').whereIn('client_name', names).first()) {
      throw new Error('Browser fixture run identifier has already been used');
    }
    const hash = sources[0].hashed_password;
    const created: BrowserTenant[] = [];
    for (const [position, label] of ['primary', 'secondary'].entries()) {
      const tenantId = randomUUID();
      const name = names[position];
      const emailFor = (actor: string) => `${actor}-${label}-${runId}@example.invalid`;
      await trx('tenants').insert({ tenant: tenantId, client_name: name, email: emailFor('admin'), product_code: 'psa', created_at: trx.fn.now() });
      await trx('tenant_settings').insert({ tenant: tenantId, onboarding_completed: true,
        onboarding_completed_at: trx.fn.now(), onboarding_skipped: false, settings: { timezone: 'UTC' } });

      const roles = new Map<string, string>();
      for (const role of getDefaultRoles('psa').filter((role: { legacy?: boolean }) => !role.legacy)) {
        const roleId = randomUUID();
        roles.set(role.key, roleId);
        await trx('roles').insert({ tenant: tenantId, role_id: roleId,
          role_name: role.roleName, msp: role.msp, client: role.client });
      }
      await reconcileAllTenants(trx, { tenantId, product: 'psa', label: 'production browser fixture', onDrift: 'throw',
        logger: { log() {}, warn() {}, error() {} } });

      const internalClientId = randomUUID();
      const clients = {
        primary: { id: randomUUID(), name: `${name} customer A` },
        sibling: { id: randomUUID(), name: `${name} customer B` },
      };
      await trx('clients').insert([
        { tenant: tenantId, client_id: internalClientId, client_name: `${name} MSP` },
        ...Object.values(clients).map(client => ({ tenant: tenantId, client_id: client.id, client_name: client.name })),
      ]);
      await trx('tenant_companies').insert({ tenant: tenantId, client_id: internalClientId, is_default: true });

      async function actor(actorName: string, role: string, clientId?: string): Promise<BrowserActor> {
        const userId = randomUUID();
        const email = emailFor(actorName);
        const userType = clientId ? 'client' : 'internal';
        const contactId = clientId ? randomUUID() : undefined;
        if (contactId) await trx('contacts').insert({ tenant: tenantId, contact_name_id: contactId,
          client_id: clientId, full_name: `${label} ${actorName}`, email, is_inactive: false });
        await trx('users').insert({ tenant: tenantId, user_id: userId, email, username: email,
          first_name: label, last_name: actorName, user_type: userType, auth_method: 'password',
          hashed_password: hash, is_inactive: false, two_factor_enabled: false, is_google_user: false,
          contact_id: contactId ?? null, needs_contact_association: false });
        const roleId = roles.get(role);
        if (!roleId) throw new Error(`Missing canonical fixture role: ${role}`);
        await trx('user_roles').insert({ tenant: tenantId, user_id: userId, role_id: roleId });
        return { userId, tenantId, email, role, userType, contactId, clientId };
      }
      created.push({ tenantId, name, clients,
        admin: await actor('admin', 'msp:Admin'),
        technician: await actor('technician', 'msp:Technician'),
        portal: await actor('portal', 'client:User', clients.primary.id),
        siblingPortal: await actor('sibling-portal', 'client:User', clients.sibling.id),
      });
    }
    return { runId, primary: created[0], secondary: created[1] };
  });
}
