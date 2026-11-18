'use server';

import { trackContactUpdates } from '@alga-psa/shared/lib/contacts/contactEvents';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { revalidatePath } from 'next/cache';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { hashPassword } from '@alga-psa/core/encryption';
import { randomUUID } from 'crypto';
import { isValidEmail } from '@alga-psa/core';
import { createClient as createClientInternal } from '@alga-psa/clients/actions/clientActions';
import { queueClientLocationCreated, queueClientLocationUpdated } from '@alga-psa/clients/lib/clientLocationEvents';
import { createClientContact } from '@alga-psa/clients/actions/contact-actions/contactActions';
import { updateTenantOnboardingStatus, saveTenantOnboardingProgress } from '@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions';
import { persistTenantOnboardingProgress } from '@alga-psa/tenancy/server';
import { hasPermission, withAuth, type AuthContext } from '@alga-psa/auth';
import { isLicensedUserType, type IUserWithRoles, type WizardData } from '@alga-psa/types';
import { getLicenseUsage } from '../../../../licensing/src/lib/get-license-usage';
import { countPendingInvitationSeats } from '../../../../users/src/lib/internalUserLicenseGuard';
import { teamMemberEmailKey, uniqueTeamMemberEmails } from '../../lib/teamMemberEmails';

export interface OnboardingActionResult {
  success: boolean;
  error?: string;
  data?: any;
}

export interface ClientInfoData {
  firstName: string;
  lastName: string;
  tenantName: string;
  email: string;
  newPassword?: string;
  // MSP company address (default location on the MSP's own client record)
  companyLocationId?: string;
  companyAddressLine1?: string;
  companyAddressLine2?: string;
  companyCity?: string;
  companyStateProvince?: string;
  companyPostalCode?: string;
  companyCountryCode?: string;
  companyCountryName?: string;
}

export interface TeamMember {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  password?: string;
}

export interface ClientData {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientUrl: string;
  clientId?: string; // Optional, for updates
}

export interface ClientContactData {
  contactName: string;
  contactEmail: string;
  contactRole: string;
  clientId: string;
}

export interface BillingData {
  serviceName: string;
  serviceDescription: string;
  servicePrice: string;
  contractLineName: string;
  serviceTypeId?: string;
  serviceBillingMode?: 'fixed' | 'hourly' | 'usage';
  currencyCode?: string;
}

export interface TicketingData {
  boardName: string;
  supportEmail: string;
  categories: (string | {
    category_id: string;
    category_name: string;
    display_order?: number;
    parent_category?: string | null;
  })[];
  priorities: (string | {
    priority_id: string;
    priority_name: string;
    color?: string;
    order_number?: number;
  })[];
  ticketPrefix?: string;
  ticketPaddingLength?: number;
  ticketStartNumber?: number;
  boardId?: string;
  isDefaultBoard?: boolean;
  statuses?: any[];
}

function onboardingActionErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (
    message.startsWith('User with email ') ||
    message === 'Service type is required' ||
    message === 'Invalid service type selected' ||
    message === 'Select or create a board before adding ticket statuses.' ||
    message.startsWith('You do not have permission')
  ) {
    return message;
  }

  return fallback;
}

/**
 * Workspace setup writes tenant-wide settings, users, billing and ticketing
 * defaults, so only an internal (MSP staff) administrator may run it (or be
 * sent to it). Each action checks this itself: the wizard is not the only
 * caller of a server action.
 *
 * The user-type check comes first because settings:update is not MSP-only:
 * client Admin holds it too, and hasPermission matches resource+action within
 * the caller's own portal. Without it a client-portal admin could run every
 * setup action, including creating internal users. It is isLicensedUserType
 * ('internal'), the same test msp/layout.tsx applies to a session: a 'service'
 * principal never holds a UI session and setup is a human, seat-creating flow.
 */
// LEVERAGE: pattern action-permission-prologue — three of the nine onboarding actions will repeat the same hasPermission prologue; a single withSetupAccess wrapper would own it
async function canRunWorkspaceSetup(user: IUserWithRoles): Promise<boolean> {
  if (!isLicensedUserType(user.user_type)) return false;
  return hasPermission(user, 'settings', 'update');
}
const SETUP_DENIED = { success: false, error: 'Only an administrator can complete workspace setup.' } as const;

export const getWorkspaceSetupAccess = withAuth(async (
  user: IUserWithRoles,
  _ctx: AuthContext
): Promise<{ canRun: boolean }> => ({ canRun: await canRunWorkspaceSetup(user) }));

export const saveClientInfo = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  data: ClientInfoData
): Promise<OnboardingActionResult> => {
  if (!await canRunWorkspaceSetup(currentUser)) return SETUP_DENIED;
  try {
    const { knex } = await createTenantKnex();
    let emailRejection = null as string | null;

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // The email here is the administrator's sign-in identity. Internal users
      // sign in with an email and no tenant, so a change must be well formed and
      // unique across every tenant (addUser enforces the same), or sign-in
      // resolves to either account. Checked before anything is written, and the
      // string checked is the string stored: sign-in lower-cases but does not
      // trim, so a padded address stored as typed would be unreachable.
      //
      // The uniqueness read runs on the admin connection (it must see every
      // tenant), not in this transaction. There is no unique constraint on
      // internal emails, so two concurrent claims of the same new address can
      // both pass between this read and the commit; addUser and updateUser
      // share that window.
      const newEmail = data.email?.trim().toLowerCase();
      if (newEmail && newEmail !== (currentUser.email ?? '').trim().toLowerCase()) {
        if (!isValidEmail(newEmail)) {
          emailRejection = 'Enter a valid email address.';
          return;
        }
        const { default: User } = await import('@alga-psa/db/models/user');
        // LEVERAGE: friction global-email-uniqueness — a global check with no constraint, implemented separately in addUser, updateUser and now onboarding setup
        const claimed = await User.findUsersByEmailAndType(newEmail, 'internal');
        if (claimed.some(found => found.user_id !== currentUser.user_id)) {
          emailRejection = 'This email address is already used by another account. Use a different email address.';
          return;
        }
      }

      // Only update user info if data is provided (for first-time users)
      // For returning users, these fields won't be in the data
      if (data.firstName || data.lastName || data.email) {
        const updateData: any = {
          updated_at: new Date()
        };

        if (data.firstName) updateData.first_name = data.firstName;
        if (data.lastName) updateData.last_name = data.lastName;
        if (newEmail) updateData.email = newEmail;

        // If new password is provided, hash and update it
        if (data.newPassword) {
          updateData.hashed_password = await hashPassword(data.newPassword);
        }

        await tenantDb(trx, tenant).table('users')
          .where({ user_id: currentUser.user_id })
          .update(updateData);

        // If password was changed, mark it as reset
        if (data.newPassword) {
          const UserPreferences = await import('@alga-psa/db/models/userPreferences').then(m => m.default);
          await UserPreferences.upsert(trx, {
            user_id: currentUser.user_id,
            setting_name: 'has_reset_password',
            setting_value: true,
            updated_at: new Date()
          });
        }
      }

      // Persist the MSP company address on the default location of the MSP's
      // own client record (seeded from Stripe at tenant creation). Address
      // lives in client_locations, not in onboarding progress — the DB row is
      // the source of truth the wizard prefills from.
      const hasAddressInput = [
        data.companyAddressLine1,
        data.companyAddressLine2,
        data.companyCity,
        data.companyStateProvince,
        data.companyPostalCode,
        data.companyCountryCode,
      ].some(v => v !== undefined);

      if (hasAddressInput) {
        const mspClient = await tenantDb(trx, tenant).table('clients')
          .where({ is_inactive: false })
          .orderBy('created_at', 'asc')
          .first('client_id');

        if (mspClient) {
          let countryCode = data.companyCountryCode?.toUpperCase() || '';
          let countryName = '';
          if (countryCode) {
            const country = await tenantDb(trx, tenant).table('countries')
              .where({ code: countryCode })
              .first('code', 'name');
            countryCode = country?.code || '';
            countryName = country?.name || '';
          }

          const locationFields = {
            address_line1: data.companyAddressLine1 || 'N/A',
            address_line2: data.companyAddressLine2 || null,
            city: data.companyCity || 'N/A',
            state_province: data.companyStateProvince || null,
            postal_code: data.companyPostalCode || null,
            // Keep the not-null placeholders when no country was chosen —
            // never silently default to a real country.
            country_code: countryCode || 'XX',
            country_name: countryName || 'Unknown',
            updated_at: new Date()
          };

          const defaultLocation = await tenantDb(trx, tenant).table('client_locations')
            .where({ client_id: mspClient.client_id, is_default: true })
            .first();

          if (defaultLocation) {
            const [updatedLocation] = await tenantDb(trx, tenant).table('client_locations')
              .where({ location_id: defaultLocation.location_id })
              .update(locationFields)
              .returning('*');
            queueClientLocationUpdated(trx, tenant, defaultLocation, updatedLocation, { actorUserId: currentUser.user_id });
          } else {
            const [insertedLocation] = await tenantDb(trx, tenant).table('client_locations').insert({
              location_id: randomUUID(),
              client_id: mspClient.client_id,
              tenant,
              location_name: 'Main Office',
              email: currentUser.email?.toLowerCase() || '',
              phone: '',
              ...locationFields,
              is_default: true,
              is_active: true,
              created_at: new Date()
            }).returning('*');
            queueClientLocationCreated(trx, tenant, insertedLocation, { actorUserId: currentUser.user_id });
          }
        }
      }

      // Save progress to tenant settings
      // IMPORTANT: Do NOT save user-specific fields (firstName, lastName, email) to tenant-wide storage
      // These fields are specific to the current user and should not be shared across users in the tenant
      // Only save tenant-level data like tenantName
      const progressData: any = {
        tenantName: data.tenantName
      };

      await persistTenantOnboardingProgress(trx, tenant, progressData);
    });

    if (emailRejection) return { success: false, error: emailRejection };

    revalidatePath('/msp/onboarding');
    return { success: true };
  } catch (error) {
    console.error('Error saving client info:', error);
    return { success: false, error: onboardingActionErrorMessage(error, 'Failed to save client information') };
  }
});

/**
 * The wizard creates team members through addUser, the same path as Settings →
 * Users: it checks the user:create permission, keeps internal emails unique
 * across tenants, admits the account against the seat limit under a lock,
 * and assigns the chosen role by id. The wizard's own copy of that logic
 * skipped all of it, defaulted a missing password to a fixed one, and fell
 * back to the alphabetically first role (Admin) when its case-folded role
 * lookup missed.
 */
type TeamMemberOutcome =
  | { status: 'created' }
  | { status: 'exists' | 'limit' | 'failed'; error: string };

async function createTeamMember(member: TeamMember, roleIds: Map<string, string>): Promise<TeamMemberOutcome> {
  if (!member.password) {
    return { status: 'failed', error: `Set a temporary password for ${member.email}, or send them an email invite instead.` };
  }
  const roleId = roleIds.get(member.role);
  if (!roleId) return { status: 'failed', error: `Select a role for ${member.email}.` };
  const { addUser } = await import('@alga-psa/users/actions/user-actions/userActions');
  const result = await addUser({ firstName: member.firstName, lastName: member.lastName, email: member.email,
    password: member.password, roleId, userType: 'internal' });
  if (result.success) return { status: 'created' };
  if (result.code === 'EMAIL_ALREADY_EXISTS') return { status: 'exists', error: result.error };
  const limitCodes = ['LICENSE_LIMIT_REACHED', 'SOLO_PLAN_LIMIT'];
  return { status: limitCodes.includes(result.code ?? '') ? 'limit' : 'failed', error: result.error };
}

async function mspRoleIds(tenant: string): Promise<Map<string, string>> {
  const { knex } = await createTenantKnex();
  const roles = await tenantDb(knex, tenant).table('roles').where({ msp: true }).select('role_id', 'role_name');
  return new Map(roles.map((role: { role_id: string; role_name: string }) => [role.role_name, role.role_id]));
}

/**
 * Seats as the wizard reports them: active internal users plus pending
 * invitations (plan §6.2) — the same reservation sendUserInvitation applies.
 * An invitee who accepts leaves "pending" (used_at) as they become an active
 * user, so no one is counted twice.
 */
async function onboardingSeatUsage(tenant: string): Promise<{ limit: number | null; used: number }> {
  const usage = await getLicenseUsage(tenant);
  const { knex } = await createTenantKnex();
  return { limit: usage.limit, used: usage.used + await countPendingInvitationSeats(knex, tenant) };
}

type SavedTeamMember = Pick<TeamMember, 'firstName' | 'lastName' | 'email' | 'role'>;

/**
 * Records members the wizard just created in the saved onboarding progress,
 * on top of those recorded by earlier saves. persistTenantOnboardingProgress
 * merges top-level keys only, so writing this call's members alone replaced
 * teamMembers: after a partial batch was fixed and retried, round one's members
 * vanished from saved progress, a resumed wizard no longer knew they existed,
 * and re-adding them hit EMAIL_ALREADY_EXISTS. Passwords are never stored,
 * and any a legacy save left behind are dropped here. Emails are keyed by
 * teamMemberEmailKey in both lists, the rule every reader compares with.
 *
 * What the lock guarantees: once this tenant's tenant_settings row exists,
 * FOR UPDATE serialises concurrent saves, so neither drops the other's
 * members. It locks nothing while the row is absent: two saves that are both
 * the tenant's first can each read {} and the second write replaces the
 * first's teamMembers. Those users still exist; the wizard that created them
 * holds them in createdTeamMemberEmails, and a resumed wizard would report
 * them as EMAIL_ALREADY_EXISTS. Closing that would need the row to exist
 * before the first save (or an advisory lock); this card does neither.
 */
async function recordCreatedTeamMembers(tenant: string, createdNow: TeamMember[]): Promise<void> {
  const { knex } = await createTenantKnex();
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const row = await tenantDb(trx, tenant).table('tenant_settings').forUpdate().first('onboarding_data');
    const raw = row?.onboarding_data;
    const saved: Partial<WizardData> = (typeof raw === 'string' ? JSON.parse(raw) : raw) ?? {};

    const strip = ({ firstName, lastName, email, role }: SavedTeamMember): SavedTeamMember =>
      ({ firstName, lastName, email, role });
    const byEmail = new Map<string, SavedTeamMember>();
    for (const member of [...(saved.teamMembers ?? []), ...createdNow]) {
      if (member?.email) byEmail.set(teamMemberEmailKey(member.email), strip(member));
    }
    const createdEmails = uniqueTeamMemberEmails([
      ...(saved.createdTeamMemberEmails ?? []), ...createdNow.map(m => m.email),
    ]);

    await persistTenantOnboardingProgress(trx, tenant, {
      teamMembers: [...byEmail.values()],
      createdTeamMemberEmails: createdEmails,
    });
  });
}

/**
 * Everything after a user exists is bookkeeping, and must never make the
 * caller think the user was not created: the wizard would offer the address
 * again and addUser would refuse it as EMAIL_ALREADY_EXISTS. So a failed
 * progress write is reported as its own non-blocking error next to `created`,
 * and a failed seat count just omits licenseStatus.
 */
const PROGRESS_NOT_SAVED =
  'The team members were created, but setup progress could not be saved. They may not be shown as added if you leave setup and come back.';

async function tryRecordCreatedTeamMembers(tenant: string, members: TeamMember[]): Promise<string | undefined> {
  try {
    await recordCreatedTeamMembers(tenant, members);
    return undefined;
  } catch (error) {
    console.error('Team members were created but onboarding progress was not saved:', error);
    return PROGRESS_NOT_SAVED;
  }
}

function tryRevalidateOnboarding(): void {
  try {
    revalidatePath('/msp/onboarding');
  } catch (error) {
    console.error('Error revalidating the onboarding page after creating team members:', error);
  }
}

/**
 * The team actions' own copy of the member with its email trimmed and
 * lower-cased (teamMemberEmailKey). addUser lower-cases but does not trim, and
 * changing that is out of this card's scope; normalizing here means the wizard
 * never creates an account whose address has surrounding spaces, and the
 * address recorded in progress is exactly the one stored on the user.
 */
function withNormalizedEmail(member: TeamMember): TeamMember {
  return { ...member, email: teamMemberEmailKey(member.email ?? '') };
}

async function tryLicenseStatus(tenant: string): Promise<{ current: number; limit: number | null } | undefined> {
  try {
    const usage = await onboardingSeatUsage(tenant);
    return { current: usage.used, limit: usage.limit };
  } catch (error) {
    console.error('Error reading onboarding seat usage after creating team members:', error);
    return undefined;
  }
}

export const addSingleTeamMember = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  submitted: TeamMember
): Promise<OnboardingActionResult> => {
  if (!await canRunWorkspaceSetup(user)) return SETUP_DENIED;
  const member = withNormalizedEmail(submitted);
  let outcome: TeamMemberOutcome;
  try {
    outcome = await createTeamMember(member, await mspRoleIds(tenant));
  } catch (error) {
    console.error('Error adding single team member:', error);
    return { success: false, error: onboardingActionErrorMessage(error, 'Failed to create team member') };
  }
  if (outcome.status !== 'created') return { success: false, error: outcome.error };
  // The user exists from here on. Everything below is non-fatal by
  // construction, outside any catch that could report the create as failed.
  const progressError = await tryRecordCreatedTeamMembers(tenant, [member]);
  const licenseStatus = await tryLicenseStatus(tenant);
  tryRevalidateOnboarding();
  return { success: true, data: { created: member.email, licenseStatus, progressError } };
});

/** A member the batch did not create, and why. Never carries the password. */
export interface TeamMemberNotCreated {
  email: string;
  reason: 'exists' | 'limit' | 'failed';
  error: string;
}

/**
 * Creates every member it can and reports each one it could not. The result
 * is a success only when all of them were created: a partial batch returns
 * success false with the created emails and the per-member reasons in data,
 * so no caller can mistake it for a finished step.
 */
export const addTeamMembers = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  submitted: TeamMember[]
): Promise<OnboardingActionResult> => {
  if (!await canRunWorkspaceSetup(user)) return SETUP_DENIED;
  const members = submitted.map(withNormalizedEmail);
  // The only step that can fail the whole batch runs before any user exists.
  let roleIds: Map<string, string>;
  try {
    roleIds = await mspRoleIds(tenant);
  } catch (error) {
    console.error('Error adding team members:', error);
    return { success: false, error: onboardingActionErrorMessage(error, 'Failed to add team members') };
  }

  const created: string[] = [];
  const notCreated: TeamMemberNotCreated[] = [];

  // Every member is attempted on its own: a seat-limit refusal for one says
  // nothing about the next (it may already exist, or lack a password), and
  // addUser re-checks the limit for each. A throw for one member is that
  // member's failure: it must not discard the members created before it.
  for (const member of members) {
    try {
      const outcome = await createTeamMember(member, roleIds);
      if (outcome.status === 'created') created.push(member.email);
      else notCreated.push({ email: member.email, reason: outcome.status, error: outcome.error });
    } catch (error) {
      console.error(`Error creating team member ${member.email}:`, error);
      notCreated.push({ email: member.email, reason: 'failed', error: onboardingActionErrorMessage(error, 'Failed to create team member') });
    }
  }

  // Users may exist from here on. Everything below is non-fatal by
  // construction, outside any catch that could report them as not created.
  // A batch where nothing was created leaves the stored progress alone.
  const progressError = created.length || !notCreated.length
    ? await tryRecordCreatedTeamMembers(tenant, members.filter(m => created.includes(m.email)))
    : undefined;
  const licenseStatus = await tryLicenseStatus(tenant);
  tryRevalidateOnboarding();

  const data = { created, notCreated, licenseStatus, progressError };
  if (!notCreated.length) return { success: true, data };
  return {
    success: false,
    error: `${notCreated.length} team member(s) were not created: `
      + notCreated.map(entry => `${entry.email} (${entry.error})`).join('; '),
    data,
  };
});

export const createClient = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  data: ClientData
): Promise<OnboardingActionResult> => {
  if (!await canRunWorkspaceSetup(currentUser)) return SETUP_DENIED;
  try {
    const { knex } = await createTenantKnex();

    let clientId: string | undefined = data.clientId;

    // If we have an existing clientId, update instead of create
    if (clientId) {
      await withTransaction(knex, async (trx: Knex.Transaction) => {
        const tenantScopedTable = (table: string) => tenantDb(trx, tenant).table(table);

        // Update the client
        await tenantScopedTable('clients')
          .where({ client_id: clientId })
          .update({
            client_name: data.clientName,
            url: data.clientUrl,
            updated_at: new Date()
          });

        // Update the default location if email or phone changed
        const defaultLocation = await tenantScopedTable('client_locations')
          .where({ client_id: clientId, is_default: true })
          .first();

        if (defaultLocation && (data.clientEmail || data.clientPhone)) {
          const [updatedLocation] = await tenantScopedTable('client_locations')
            .where({ location_id: defaultLocation.location_id })
            .update({
              email: data.clientEmail || defaultLocation.email || '',
              phone: data.clientPhone || defaultLocation.phone || '',
              updated_at: new Date()
            })
            .returning('*');
          queueClientLocationUpdated(trx, tenant, defaultLocation, updatedLocation, { actorUserId: currentUser.user_id });
        }
      });

      await saveTenantOnboardingProgress({
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        clientPhone: data.clientPhone,
        clientUrl: data.clientUrl,
        clientId: clientId
      });

      revalidatePath('/msp/onboarding');
      return { 
        success: true, 
        data: { clientId: clientId, updated: true }
      };
    }

    // Create new client
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      const tenantScopedTable = (table: string) => tenantDb(trx, tenant).table(table);

      // Create the client without email/phone (those go in locations)
      const clientData = {
        client_name: data.clientName,
        url: data.clientUrl,
        is_inactive: false,
        is_tax_exempt: false,
        billing_cycle: 'monthly' as const,
        client_type: 'company' as const,
        tenant
      };

      // Use createClientInternal for consistency and to get all the default setup
      const result = await createClientInternal(clientData);
      
      if (!result.success) {
        throw new Error(result.error || 'Client creation returned an unsuccessful result without an error message.');
      }

      clientId = result.data.client_id;

      // Create default location with email and phone if provided
      if (data.clientEmail || data.clientPhone) {
        const [insertedLocation] = await tenantScopedTable('client_locations').insert({
          location_id: require('crypto').randomUUID(),
          client_id: clientId,
          tenant,
          location_name: 'Main Office',
          email: data.clientEmail || '',
          phone: data.clientPhone || '',
          address_line1: '',
          city: '',
          country_code: 'US',
          country_name: 'United States',
          is_default: true,
          is_billing_address: true,
          is_shipping_address: true,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        }).returning('*');
        queueClientLocationCreated(trx, tenant, insertedLocation, { actorUserId: currentUser.user_id });
      }
    });

    if (clientId) {
      await saveTenantOnboardingProgress({
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        clientPhone: data.clientPhone,
        clientUrl: data.clientUrl,
        clientId: clientId
      });

      revalidatePath('/msp/onboarding');
      return { 
        success: true, 
        data: { clientId: clientId }
      };
    }

    return { success: false, error: 'Failed to create client' };
  } catch (error) {
    console.error('Error creating client:', error);
    return { success: false, error: onboardingActionErrorMessage(error, 'Failed to create client') };
  }
});

export const addClientContact = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  data: ClientContactData
): Promise<OnboardingActionResult> => {
  if (!await canRunWorkspaceSetup(user)) return SETUP_DENIED;
  try {
    const { knex } = await createTenantKnex();

    // First, check if a contact with this email already exists for this client
    const existingContact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('contacts')
        .where({ 
          email: data.contactEmail.toLowerCase(),
          client_id: data.clientId,
        })
        .first();
    });

    if (existingContact) {
      // Contact already exists, update it if details have changed
      const needsUpdate = 
        existingContact.full_name !== data.contactName ||
        existingContact.role !== data.contactRole;

      if (needsUpdate) {
        await withTransaction(knex, async (trx: Knex.Transaction) => {
          await trackContactUpdates(trx, tenant, [existingContact.contact_name_id], ['full_name', 'role'], () =>
            tenantDb(trx, tenant).table('contacts')
              .where({ 
                contact_name_id: existingContact.contact_name_id,
              })
              .update({
                full_name: data.contactName,
                role: data.contactRole,
                updated_at: new Date()
              }),
            { actorUserId: user.user_id });
        });
      }

      await saveTenantOnboardingProgress({
        contactName: data.contactName,
        contactEmail: data.contactEmail,
        contactRole: data.contactRole
      });

      revalidatePath('/msp/onboarding');
      return { 
        success: true, 
        data: { 
          contactId: existingContact.contact_name_id,
          alreadyExisted: true,
          updated: needsUpdate
        }
      };
    }

    // Contact doesn't exist, create it
    const result = await createClientContact({
      clientId: data.clientId,
      fullName: data.contactName,
      email: data.contactEmail,
      jobTitle: data.contactRole
    });

    await saveTenantOnboardingProgress({
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      contactRole: data.contactRole
    });

    revalidatePath('/msp/onboarding');
    return { 
      success: true, 
      data: { contactId: result.contact?.contact_name_id }
    };
  } catch (error) {
    console.error('Error adding client contact:', error);
    return { success: false, error: onboardingActionErrorMessage(error, 'Failed to add client contact') };
  }
});

export const setupBilling = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  data: BillingData
): Promise<OnboardingActionResult> => {
  if (!await canRunWorkspaceSetup(user)) return SETUP_DENIED;
  try {
    const { knex } = await createTenantKnex();

    let serviceId: string | undefined;

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      const tenantScopedTable = (table: string) => tenantDb(trx, tenant).table(table);

      // Use the selected service type
      if (!data.serviceTypeId) {
        throw new Error('Service type is required');
      }

      // Verify the service type exists
      const serviceType = await tenantScopedTable('service_types')
        .where({ 
          id: data.serviceTypeId,
          is_active: true
        })
        .first();

      if (!serviceType) {
        throw new Error('Invalid service type selected');
      }

      // Create service catalog entry.
      // Billing behavior is contract/service configuration context, not service-type identity.
      const currencyCode = data.currencyCode || 'USD';
      const rateInCents = Math.round((parseFloat(data.servicePrice) || 0) * 100);
      // Billing behavior is contract/service configuration context, not service-type identity.
      serviceId = require('crypto').randomUUID();
      await tenantScopedTable('service_catalog').insert({
        service_id: serviceId,
        tenant,
        service_name: data.serviceName,
        description: data.serviceDescription,
        billing_method: data.serviceBillingMode || 'usage',
        custom_service_type_id: serviceType.id,
        default_rate: rateInCents,
        unit_of_measure: 'hour',
        cost_currency: currencyCode,
      });

      // Create service_prices entry so the catalog UI shows the correct currency & rate
      // LEVERAGE: friction catalog-price-writer — single-row epoch seed bypasses writeServiceCatalogPricing (display_order relies on the column default 0); onboarding does not depend on @alga-psa/billing. Route through the writer once it is reachable from this package.
      await tenantScopedTable('service_prices').insert({
        price_id: require('crypto').randomUUID(),
        tenant,
        service_id: serviceId,
        currency_code: currencyCode,
        rate: rateInCents,
      });

      // Set default currency on all tenant clients created during onboarding
      await tenantScopedTable('clients')
        .whereNull('default_currency_code')
        .update({ default_currency_code: currencyCode });

      // Persist the selected currency as the tenant-level billing default
      const existingSettings = await tenantScopedTable('default_billing_settings').first();
      if (existingSettings) {
        await tenantScopedTable('default_billing_settings')
          .update({ default_currency_code: currencyCode, updated_at: trx.fn.now() });
      } else {
        await tenantScopedTable('default_billing_settings').insert({
          tenant,
          zero_dollar_invoice_handling: 'normal',
          suppress_zero_dollar_invoices: false,
          default_currency_code: currencyCode,
        });
      }

      // Save progress
      await persistTenantOnboardingProgress(trx, tenant, {
        serviceName: data.serviceName,
        serviceDescription: data.serviceDescription,
        servicePrice: data.servicePrice,
        serviceBillingMode: data.serviceBillingMode || 'usage',
        contractLineName: data.contractLineName
      });
    });

    revalidatePath('/msp/onboarding');
    return { success: true, data: { serviceId } };
  } catch (error) {
    console.error('Error setting up billing:', error);
    return { success: false, error: onboardingActionErrorMessage(error, 'Failed to set up billing') };
  }
});

export const configureTicketing = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  data: TicketingData
): Promise<OnboardingActionResult> => {
  if (!await canRunWorkspaceSetup(currentUser)) return SETUP_DENIED;
  try {
    const { knex } = await createTenantKnex();

    const createdIds: Record<string, string[]> = {
      boardId: [],
      categoryIds: [],
      priorityIds: []
    };

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      const tenantScopedTable = (table: string) => tenantDb(trx, tenant).table(table);

      // Configure ticket numbering - check if any numbering field is explicitly set
      if (data.ticketPrefix !== undefined || data.ticketStartNumber !== undefined || data.ticketPaddingLength !== undefined) {
        // Serialise with the allocator: generate_next_number takes this same
        // lock, so a ticket cannot be numbered between the existence probe
        // below and the counter update.
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`${tenant}TICKET`]);

        const existingNumbering = await tenantScopedTable('next_number')
          .where({ entity_type: 'TICKET' })
          .first();

        if (existingNumbering) {
          // generate_next_number issues GREATEST(last_number + 1, initial_value),
          // so a higher start number applies without a reset. Rewinding
          // last_number is only safe while no ticket holds an issued number:
          // a reset would hand out numbers that were already issued again.
          const ticketsExist = Boolean(await tenantScopedTable('tickets').first('ticket_id'));
          await tenantScopedTable('next_number')
            .where({ entity_type: 'TICKET' })
            .update({
              prefix: data.ticketPrefix ?? '',
              padding_length: data.ticketPaddingLength ?? 6,
              ...(data.ticketStartNumber && {
                initial_value: data.ticketStartNumber,
                ...(!ticketsExist && { last_number: 0 }),
              })
            });
        } else {
          await tenantScopedTable('next_number').insert({
            tenant,
            entity_type: 'TICKET',
            prefix: data.ticketPrefix ?? '',
            padding_length: data.ticketPaddingLength ?? 6,
            last_number: 0,
            initial_value: data.ticketStartNumber || 1
          });
        }
      }

      // Handle board creation or import
      let boardId: string = '';
      
      if (data.boardId) {
        // This is an imported board
        boardId = data.boardId;
        const shouldBeDefault = data.isDefaultBoard || false;
        
        // If this imported board should be default, clear existing defaults first
        if (shouldBeDefault) {
          await tenantScopedTable('boards')
            .where({ 
              is_default: true
            })
            .update({ is_default: false });
            
          // Set the imported board as default
          await tenantScopedTable('boards')
            .where({
              board_id: boardId
            })
            .update({ is_default: true });
        }
        
        createdIds.boardId.push(boardId);
      } else if (data.boardName) {
        // This is a manually created board
        boardId = require('crypto').randomUUID();
        const shouldBeDefault = data.isDefaultBoard || false;
        const boardColumns = await tenantDb(trx, tenant)
          .unscoped('boards', 'columnInfo reads schema metadata, not tenant rows')
          .columnInfo();
        
        // If setting as default, clear any existing defaults first
        if (shouldBeDefault) {
          await tenantScopedTable('boards')
            .where({ 
              is_default: true
            })
            .update({ is_default: false });
        }
        
        await tenantScopedTable('boards').insert({
          board_id: boardId,
          tenant,
          board_name: data.boardName,
          ...(Object.prototype.hasOwnProperty.call(boardColumns, 'is_active') ? { is_active: true } : {}),
          ...(Object.prototype.hasOwnProperty.call(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
          is_default: shouldBeDefault
        });
        
        createdIds.boardId.push(boardId);
      }

      // Create categories only if we have a board
      if (boardId && data.categories) {
        for (const category of data.categories) {
          // Skip if already has a real ID (imported category)
          if (typeof category === 'object' && category.category_id && !category.category_id.startsWith('manual-')) {
            continue;
          }
          
          const categoryName = typeof category === 'string' ? category : category.category_name;
          const categoryId = require('crypto').randomUUID();
          
          // Check if category already exists
          const existingCategory = await tenantScopedTable('categories')
            .where({ 
              category_name: categoryName,
              board_id: boardId
            })
            .first();
          
        if (!existingCategory) {
          // Calculate display order to avoid duplicates
          let displayOrder = typeof category === 'object' && category.display_order ? category.display_order : null;
          
          if (displayOrder !== null) {
            // Check if this display order already exists for this board
            const existingWithOrder = await tenantScopedTable('categories')
              .where({ 
                board_id: boardId,
                display_order: displayOrder
              })
              .first();
              
            if (existingWithOrder) {
              // Find the max display order and add 1
              const maxOrder = await tenantScopedTable('categories')
                .where({ board_id: boardId })
                .max('display_order as max')
                .first();
              displayOrder = (maxOrder?.max || 0) + 1;
            }
          }
          
          await tenantScopedTable('categories').insert({
            category_id: categoryId,
            tenant,
            category_name: categoryName,
            board_id: boardId,
            display_order: displayOrder,
            parent_category: typeof category === 'object' ? category.parent_category : null,
            created_by: currentUser.user_id,
            created_at: new Date()
          });
          createdIds.categoryIds.push(categoryId);
        }
      }
      }

      // Create statuses - only ones that don't exist
      if (data.statuses && data.statuses.length > 0) {
        if (!boardId) {
          throw new Error('Select or create a board before adding ticket statuses.');
        }

        // Check if any status (imported or manual) should be the default
        const defaultStatus = data.statuses.find(s => s.is_default);
        
        // If we have a default status, clear existing defaults first
        if (defaultStatus) {
          await tenantScopedTable('statuses')
            .where({ 
              board_id: boardId,
              status_type: 'ticket',
              is_default: true
            })
            .update({ is_default: false });
        }
        
        for (const status of data.statuses) {
          // Skip imported statuses that already exist (they have real IDs, not manual-)
          if (status.status_id && !status.status_id.startsWith('manual-')) {
            // For imported statuses, we might need to update their default flag
            if (status.is_default) {
              await tenantScopedTable('statuses')
                .where({
                  status_id: status.status_id,
                  board_id: boardId
                })
                .update({ is_default: true });
            }
            continue;
          }
          
          // Check if status already exists
          const existingStatus = await tenantScopedTable('statuses')
            .where({ 
              name: status.name,
              status_type: 'ticket',
              board_id: boardId
            })
            .first();

          if (!existingStatus) {
            const statusId = require('crypto').randomUUID();
            await tenantScopedTable('statuses').insert({
              status_id: statusId,
              tenant,
              board_id: boardId,
              name: status.name,
              is_closed: status.is_closed || false,
              is_default: status.is_default || false,
              order_number: status.order_number || 0,
              item_type: 'ticket',
              status_type: 'ticket',
              created_at: new Date()
            });
          }
        }
      }

      // Create priorities - only manual ones, imported ones are already in DB
      for (let i = 0; i < data.priorities.length; i++) {
        const priority = data.priorities[i];
        
        // Skip if already has a real ID (imported priority)
        if (typeof priority === 'object' && priority.priority_id && !priority.priority_id.startsWith('manual-')) {
          continue;
        }
        
        const priorityName = typeof priority === 'string' ? priority : priority.priority_name;
        
        // Check if priority already exists (might have been imported)
        const existingPriority = await tenantScopedTable('priorities')
          .where({ 
            priority_name: priorityName,
            item_type: 'ticket'
          })
          .first();

        if (!existingPriority) {
          const priorityId = require('crypto').randomUUID();
          await tenantScopedTable('priorities').insert({
            priority_id: priorityId,
            tenant,
            priority_name: priorityName,
            color: typeof priority === 'object' && priority.color ? priority.color : ['#ff0000', '#ff8800', '#ffff00', '#00ff00'][i] || '#888888',
            order_number: typeof priority === 'object' && priority.order_number ? priority.order_number : (i + 1) * 10,
            item_type: 'ticket',
            created_by: currentUser.user_id,
            created_at: new Date(),
            updated_at: new Date()
          });
          createdIds.priorityIds.push(priorityId);
        }
      }

      // Persist the support email where the product actually reads it:
      // tenant_settings.settings.supportEmail (top-level key — what portal
      // branding and the appointment organizer fallback consume). `boards`
      // has no email column, so before this the field went nowhere. Inbound
      // ticket email remains a separate concern (Settings > Email providers).
      // Blank or invalid input is skipped so an already-configured address
      // is never clobbered.
      const supportEmail = data.supportEmail?.trim();
      if (supportEmail && isValidEmail(supportEmail)) {
        const settingsRow = await tenantScopedTable('tenant_settings').first();
        const mergedSettings = { ...(settingsRow?.settings || {}), supportEmail };
        if (settingsRow) {
          await tenantScopedTable('tenant_settings').update({
            settings: mergedSettings,
            updated_at: new Date()
          });
        } else {
          await tenantScopedTable('tenant_settings').insert({
            tenant,
            settings: mergedSettings,
            created_at: new Date(),
            updated_at: new Date()
          });
        }
      }

      // Save progress - convert categories and priorities to strings
      await persistTenantOnboardingProgress(trx, tenant, {
        boardName: data.boardName,
        supportEmail: data.supportEmail,
        categories: data.categories.map(cat => typeof cat === 'string' ? cat : cat.category_name),
        priorities: data.priorities.map(pri => typeof pri === 'string' ? pri : pri.priority_name),
        ticketPrefix: data.ticketPrefix,
        ticketStartNumber: data.ticketStartNumber
      });
    });

    revalidatePath('/msp/onboarding');
    return { success: true, data: createdIds };
  } catch (error) {
    console.error('Error configuring ticketing:', error);
    return { success: false, error: onboardingActionErrorMessage(error, 'Failed to configure ticketing') };
  }
});

export const validateOnboardingDefaults = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext
): Promise<OnboardingActionResult> => {
  try {
    // Check permission to configure ticket settings
    const canConfigureTicketing = await hasPermission(currentUser, 'ticket_settings', 'update');
    if (!canConfigureTicketing) {
      return { success: false, error: 'You do not have permission to configure ticket settings' };
    }

    const { knex: db } = await createTenantKnex();

    // Use withTransaction to check for defaults
    const validationResult = await withTransaction(db, async (trx) => {
      // Check for default board
      const defaultBoard = await tenantDb(trx, tenant).table('boards')
        .where({ 
          is_default: true
        })
        .first();
      
      if (!defaultBoard) {
        return { valid: false, error: 'No default board is set. Please set one board as default before completing setup.' };
      }
      
      // Check for default status
      const defaultStatus = await tenantDb(trx, tenant).table('statuses')
        .where({ 
          is_default: true,
          status_type: 'ticket',
          board_id: defaultBoard.board_id
        })
        .first();
      
      if (!defaultStatus) {
        return { valid: false, error: 'No default status is set. Please set one status as default before completing setup.' };
      }
      
      return { valid: true };
    });
    
    if (!validationResult.valid) {
      return { success: false, error: validationResult.error };
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error validating onboarding defaults:', error);
    return { success: false, error: onboardingActionErrorMessage(error, 'Failed to validate onboarding defaults') };
  }
});

export const saveOnboardingStepPosition = withAuth(async (
  user: IUserWithRoles,
  _ctx: AuthContext,
  step: number
): Promise<OnboardingActionResult> => {
  if (!await canRunWorkspaceSetup(user)) return SETUP_DENIED;
  try {
    if (!Number.isInteger(step) || step < 0) {
      return { success: false, error: 'Invalid step position' };
    }

    await saveTenantOnboardingProgress({ currentStep: step });
    return { success: true };
  } catch (error) {
    console.error('Error saving onboarding step position:', error);
    return { success: false, error: onboardingActionErrorMessage(error, 'Failed to save onboarding step position') };
  }
});

export const completeOnboarding = withAuth(async (
  user: IUserWithRoles,
  _ctx: AuthContext
): Promise<OnboardingActionResult> => {
  if (!await canRunWorkspaceSetup(user)) return SETUP_DENIED;
  try {
    // Mark onboarding as completed and clear wizard data
    await updateTenantOnboardingStatus(true);

    revalidatePath('/msp');
    revalidatePath('/msp/onboarding');
    
    return { success: true };
  } catch (error) {
    console.error('Error completing onboarding:', error);
    return { success: false, error: onboardingActionErrorMessage(error, 'Failed to complete onboarding') };
  }
});

export const getAvailableRoles = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<{
  success: boolean;
  data?: Array<{ value: string; label: string; roleId: string }>;
  error?: string;
}> => {
  try {
    const { knex } = await createTenantKnex();

    const roles = await withTransaction(knex, async (trx: Knex.Transaction): Promise<Array<{ role_id: string; role_name: string }>> => {
      return await tenantDb(trx, tenant).table('roles')
        .where({
          msp: true  // Only fetch MSP roles
        })
        .select('role_id', 'role_name')
        .orderBy('role_name');
    });

    // Transform roles to the format expected by the select component.
    // `value`/`label` stay role-name-based (matches addSingleTeamMember's
    // lookup-by-name); `roleId` is exposed for the email-invite path, which
    // needs the actual FK value.
    const roleOptions = roles.map(role => ({
      value: role.role_name,
      label: role.role_name.charAt(0).toUpperCase() + role.role_name.slice(1), // Capitalize first letter
      roleId: role.role_id
    }));

    return {
      success: true,
      data: roleOptions
    };
  } catch (error) {
    console.error('Error fetching available roles:', error);
    return {
      success: false,
      error: onboardingActionErrorMessage(error, 'Failed to load available roles')
    };
  }
});

/**
 * License usage for the Team Members onboarding step. Uses the withAuth
 * session tenant directly instead of getLicenseUsageAction's header/async
 * -context lookup, which is unreliable this early in onboarding and left the
 * step's "Users: N" counter stuck at 0.
 *
 * A seat here is an active internal user plus a pending invitation
 * (`used_at IS NULL AND expires_at > now()`, tenant-scoped) — plan §6.2 and
 * exactly what sendUserInvitation reserves. The counter and the licenseStatus
 * returned after a save read the same number. Consequence, by design: with
 * seats left only because of pending invitations the step reports the limit
 * reached and blocks a direct-create save that addUser (which counts active
 * users only) would admit — those seats are reserved for the invitees.
 */
export const getOnboardingLicenseUsage = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<OnboardingActionResult> => {
  try {
    const usage = await onboardingSeatUsage(tenant);
    return { success: true, data: { limit: usage.limit, used: usage.used } };
  } catch (error) {
    console.error('Error fetching onboarding license usage:', error);
    return { success: false, error: onboardingActionErrorMessage(error, 'Failed to load license usage') };
  }
});

export const getOnboardingInitialData = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext
): Promise<{
  success: boolean;
  data?: Partial<ClientInfoData>;
  error?: string;
}> => {
  try {
    const { knex } = await createTenantKnex();

    // Get the tenant's client information
    const client = await tenantDb(knex, tenant).table('clients')
      .where({ is_inactive: false })
      .orderBy('created_at', 'asc')
      .first();

    // Default location of the MSP's own client (seeded from the Stripe billing
    // address at tenant creation). Placeholder values ('N/A'/'XX'/'Unknown')
    // are blanked so the wizard shows empty editable fields instead.
    let location: Record<string, any> | undefined;
    if (client) {
      location = await tenantDb(knex, tenant).table('client_locations')
        .where({ client_id: client.client_id, is_default: true })
        .first(
          'location_id',
          'address_line1',
          'address_line2',
          'city',
          'state_province',
          'postal_code',
          'country_code',
          'country_name'
        );
    }
    const blankPlaceholder = (value: string | null | undefined) =>
      !value || value === 'N/A' ? '' : value;
    const hasRealCountry = location?.country_code && location.country_code !== 'XX';

    return {
      success: true,
      data: {
        firstName: currentUser.first_name || '',
        lastName: currentUser.last_name || '',
        email: currentUser.email || '',
        tenantName: client?.client_name || tenant, // Use tenant name as fallback
        companyLocationId: location?.location_id,
        companyAddressLine1: blankPlaceholder(location?.address_line1),
        companyAddressLine2: blankPlaceholder(location?.address_line2),
        companyCity: blankPlaceholder(location?.city),
        companyStateProvince: blankPlaceholder(location?.state_province),
        companyPostalCode: blankPlaceholder(location?.postal_code),
        companyCountryCode: hasRealCountry ? location!.country_code : '',
        companyCountryName: hasRealCountry ? location!.country_name : ''
      }
    };
  } catch (error) {
    console.error('Error getting onboarding initial data:', error);
    return { 
      success: false, 
      error: onboardingActionErrorMessage(error, 'Failed to load onboarding data')
    };
  }
});

export const getTenantTicketingData = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<{
  success: boolean;
  data?: {
    boards: any[];
    categories: any[];
    statuses: any[];
    priorities: any[];
  };
  error?: string;
}> => {
  try {
    const { knex } = await createTenantKnex();
    const tenantScopedTable = (table: string) => tenantDb(knex, tenant).table(table);

    const boards = await tenantScopedTable('boards')
      .orderBy('display_order', 'asc')
      .orderBy('board_name', 'asc');

    const [categories, statuses, priorities] = await Promise.all([
      tenantScopedTable('categories')
        .orderBy('display_order', 'asc')
        .orderBy('category_name', 'asc'),
      tenantScopedTable('statuses')
        .where({ status_type: 'ticket' })
        .whereNotNull('board_id')
        .orderBy('board_id', 'asc')
        .orderBy('order_number', 'asc')
        .orderBy('name', 'asc'),
      tenantScopedTable('priorities')
        .where({ item_type: 'ticket' })
        .orderBy('order_number', 'asc')
        .orderBy('priority_name', 'asc')
    ]);

    return {
      success: true,
      data: {
        boards,
        categories,
        statuses,
        priorities
      }
    };
  } catch (error) {
    console.error('Error getting tenant ticketing data:', error);
    return {
      success: false,
      error: onboardingActionErrorMessage(error, 'Failed to load ticketing setup data')
    };
  }
});
