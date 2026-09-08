import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { hashPassword } from '@alga-psa/core/encryption';
import { validatePassword } from '@alga-psa/validation';
import { activateTenantPsaLicense, retainTenantPsaLicense, retainHostedPsaUpgradeCandidate } from '@alga-psa/licensing';
import { isCoManagedUuid } from '../../../../../packages/co-managed/src/sharedWorkIdentity';
import { assertPortableRestoreInstallationAuthority, type PortableRestoreReceipt } from './portableWorkspaceRestore';
import { initializeIndependentPsa } from '../../../../temporal-workflows/src/db/product-upgrade-operations';
import type { SeedRunLog } from '../../../../temporal-workflows/src/db/onboarding-seeds-operations';
import { paidPsaUpgradeFromStripe, createIndependentPsaStripeReader, type HostedUpgradePrices } from '../stripe/coManagedIndependentEntitlement';
import type { HostedUpgradeStripeReader } from '../../../../temporal-workflows/src/db/co-managed-hosted-upgrade';

export interface PortableActivationReceipt {
  tenant: string; operation_id: string; administrator_user_id: string; entitlement_source: 'tenant_license' | 'hosted_subscription';
  entitlement_reference: string; seats: number | null; entitlement_valid_until: Date | string; activated_at: Date | string;
}
const fail = (reason: string): never => { throw new Error(`Portable workspace activation rejected: ${reason}`); };

async function admit(trx: Knex.Transaction, tenant: string, operationId: string) {
  await assertPortableRestoreInstallationAuthority(trx);
  await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`portable-restore:${tenant}`]);
  const own = tenantDb(trx, tenant);
  const activation = await own.table('portable_workspace_activations').first() as PortableActivationReceipt | undefined;
  if (activation) {
    if (activation.operation_id !== operationId) fail('another activation already completed');
    return { kind: 'completed' as const, receipt: activation };
  }
  const restored = await own.table('portable_workspace_restores').forShare().first() as PortableRestoreReceipt | undefined;
  const workspace = await own.table('tenants').forUpdate().first('tenant', 'product_code', 'suspended_at', 'suspended_reason');
  if (!restored || !workspace || workspace.product_code !== 'psa' || !workspace.suspended_at ||
      workspace.suspended_reason !== 'portable_restore_pending_activation') fail('pending isolated restore required');
  if (await own.table('users').whereRaw('is_inactive IS DISTINCT FROM TRUE').first('user_id')) fail('restored users must remain inactive');
  const administrator = await own.table('users').where('user_id', restored.administrator_user_id).forUpdate().first('user_type', 'hashed_password', 'is_inactive');
  if (!administrator || administrator.user_type !== 'internal' || administrator.is_inactive !== true || administrator.hashed_password !== '!portable-restore-disabled') fail('original restored administrator required');
  return { kind: 'pending' as const, restored };
}

/** Preserve the restore's dispatch quarantine when enabling the administrator.
 * Connections and credentials for login were never imported. Authored workflow
 * definitions remain paused for the new administrator's explicit review. */
async function requirePausedDispatch(trx: Knex.Transaction, tenant: string) {
  const own = tenantDb(trx, tenant);
  if (await own.table('workflow_definitions').whereRaw('is_paused IS DISTINCT FROM TRUE').first('workflow_id') ||
      await own.table('asset_maintenance_schedules').whereRaw('is_active IS DISTINCT FROM FALSE').first('schedule_id') ||
      await own.table('comments').where('publish_state', 'scheduled').first('comment_id') ||
      await own.table('online_meetings').whereIn('status', ['scheduled', 'ended', 'recording_pending', 'cancel_pending']).first('meeting_id') ||
      await own.table('availability_settings').whereRaw("config_json->>'auto_approval_enabled' = 'true'").first('tenant')) fail('restored dispatch requires review');
}

/** Installation-only activation of a restored workspace with its own signed
 * Pro license. Source passwords, sessions, MFA bindings and installation
 * licenses cannot satisfy this operation. Exact retries never reset a password
 * or reactivate a tenant suspended later for another reason. */
export async function activatePortableWorkspaceWithTenantLicense(db: Knex, input: {
  tenant: string; operationId: string; licenseToken: string; administratorPassword: string;
}, log: SeedRunLog): Promise<PortableActivationReceipt> {
  const request = { ...input };
  if (db.isTransaction || !isCoManagedUuid(request.tenant) || !isCoManagedUuid(request.operationId)) fail('installation connection and identities required');
  request.tenant = request.tenant.toLowerCase(); request.operationId = request.operationId.toLowerCase();
  try {
    const prepared = await db.transaction(trx => admit(trx, request.tenant, request.operationId));
    if (prepared.kind === 'completed') return prepared.receipt;
    if (typeof request.administratorPassword !== 'string' || Buffer.byteLength(request.administratorPassword, 'utf8') > 1024 ||
        validatePassword(request.administratorPassword)) fail('new administrator password does not meet the password policy');
    const hashed = await hashPassword(request.administratorPassword); request.administratorPassword = '';
    return await completeActivation(db, request, hashed, log, async trx => {
      await activateTenantPsaLicense(trx, request.tenant, request.licenseToken);
      return { source: 'tenant_license', ...await retainTenantPsaLicense(trx, request.tenant) };
    });
  } finally { request.licenseToken = ''; request.administratorPassword = ''; }
}


interface ActivationEntitlement { source: PortableActivationReceipt['entitlement_source']; reference: string; seats: number | null; validUntil: Date }

/** Hosted installation operators activate only an already provisioned, paid
 * destination subscription. This performs provider reads, not a purchase or
 * transfer of the source/MSP subscription. Local ownership is retained again
 * after the provider response and before any activation write. */
export async function activatePortableWorkspaceWithHostedSubscription(db: Knex, input: {
  tenant: string; operationId: string; administratorPassword: string;
}, log: SeedRunLog, dependencies: { stripe?: HostedUpgradeStripeReader; prices?: HostedUpgradePrices } = {}): Promise<PortableActivationReceipt> {
  const request = { ...input };
  if (db.isTransaction || !isCoManagedUuid(request.tenant) || !isCoManagedUuid(request.operationId)) fail('installation connection and identities required');
  request.tenant = request.tenant.toLowerCase(); request.operationId = request.operationId.toLowerCase();
  const prices = { ...(dependencies.prices ?? { month: process.env.STRIPE_ALGAPSA_USER_PRICE_ID || process.env.STRIPE_PRO_PRICE_ID,
    year: process.env.STRIPE_ALGAPSA_USER_ANNUAL_PRICE_ID || process.env.STRIPE_PRO_ANNUAL_PRICE_ID }) };
  const ids = Object.values(prices).filter((id): id is string => typeof id === 'string' && Boolean(id));
  try {
    const prepared = await db.transaction(async trx => {
      const current = await admit(trx, request.tenant, request.operationId);
      if (current.kind === 'completed') return current;
      return { kind: 'pending' as const, candidate: await retainHostedPsaUpgradeCandidate(trx, request.tenant, ids) };
    });
    if (prepared.kind === 'completed') return prepared.receipt;
    if (typeof request.administratorPassword !== 'string' || Buffer.byteLength(request.administratorPassword, 'utf8') > 1024 ||
        validatePassword(request.administratorPassword)) fail('new administrator password does not meet the password policy');
    const stripe = dependencies.stripe ?? await createIndependentPsaStripeReader(), candidate = prepared.candidate;
    const [customer, subscription] = await Promise.all([stripe.customers.retrieve(candidate.customerId),
      stripe.subscriptions.retrieve(candidate.subscriptionId, { expand: ['latest_invoice'] })]);
    const paid = paidPsaUpgradeFromStripe(candidate, customer, subscription, prices);
    const hashed = await hashPassword(request.administratorPassword); request.administratorPassword = '';
    return await completeActivation(db, request, hashed, log, async trx => {
      const current = await retainHostedPsaUpgradeCandidate(trx, request.tenant, ids);
      if (current.fingerprint !== candidate.fingerprint) fail('destination subscription changed');
      return { ...paid, source: 'hosted_subscription' };
    });
  } finally { request.administratorPassword = ''; }
}

/** The two paid adapters share one atomic activation boundary. Provider reads
 * happen before this function; entitlement retention happens inside it. */
async function completeActivation(db: Knex, request: { tenant: string; operationId: string }, hashed: string, log: SeedRunLog,
  retainEntitlement: (trx: Knex.Transaction) => Promise<ActivationEntitlement>): Promise<PortableActivationReceipt> {
  return db.transaction(async trx => {
      const current = await admit(trx, request.tenant, request.operationId);
      if (current.kind === 'completed') return current.receipt;
      const entitlement = await retainEntitlement(trx);
      await requirePausedDispatch(trx, request.tenant);
      await initializeIndependentPsa(request.tenant, log, trx);
      const own = tenantDb(trx, request.tenant);
      // PSA setup can add standard workflow definitions. They join the same
      // review pause as imported definitions before the tenant becomes active.
      await own.table('workflow_definitions').where('is_paused', false).update({ is_paused: true });
      await requirePausedDispatch(trx, request.tenant);
      const roles = await own.table('roles').where({ role_name: 'Admin', msp: true, client: false }).forShare().select('role_id');
      if (roles.length !== 1) fail('unambiguous PSA administrator role required');
      await own.table('user_roles').insert({ tenant: request.tenant, user_id: current.restored.administrator_user_id, role_id: roles[0].role_id })
        .onConflict(['tenant', 'user_id', 'role_id']).ignore();
      if (await own.table('users').where({ user_id: current.restored.administrator_user_id, is_inactive: true, hashed_password: '!portable-restore-disabled' })
        .update({ hashed_password: hashed, is_inactive: false, updated_at: trx.fn.now() }) !== 1) fail('administrator changed');
      const now = new Date((await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at);
      if (entitlement.validUntil <= now) fail('independent license expired during activation');
      const receipt: PortableActivationReceipt = { tenant: request.tenant, operation_id: request.operationId,
        administrator_user_id: current.restored.administrator_user_id, entitlement_source: entitlement.source, entitlement_reference: entitlement.reference,
        seats: entitlement.seats, entitlement_valid_until: entitlement.validUntil, activated_at: now };
      await own.table('portable_workspace_activations').insert(receipt);
      if (await own.table('tenants').where('suspended_reason', 'portable_restore_pending_activation')
        .update({ suspended_at: null, suspended_reason: null, licensed_user_count: entitlement.seats }) !== 1) fail('restore suspension changed');
      return receipt;
    });
}
