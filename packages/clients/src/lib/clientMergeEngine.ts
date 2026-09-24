import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { ensureClientDefaultBillingProfile } from '@alga-psa/shared/billingClients/billingProfiles';
import {
  CLIENT_OWNED_MOVE_TABLES,
  PROFILE_HISTORY_TABLES,
  evaluateMergeGuards,
  planBillingProfileMoves,
  planContractMove,
  suggestCutoverDate,
  type ClientOwnedMoveTable,
  type ContractDecision,
  type MergeBlocker,
  type MergeClientFacts,
  type MergeableContract,
  type SourceBillingProfile,
} from './clientMergePlan';

/**
 * Merging a client into a parent as a billing profile.
 *
 * The move that matters is the *profile* move. `client_billing_profiles` is
 * where invoices, billing cycles, payment methods, transactions, credits and
 * tax settings all hang, so re-parenting the profile row carries the whole
 * billing history across untouched. Everything else this module does is
 * bookkeeping around that one fact: re-stamping the redundant `client_id`
 * columns those history tables also carry, moving the operational rows, and
 * making sure nothing that arrives on the parent with a NULL billing profile
 * gets silently re-attributed to the parent's default.
 *
 * Kept free of `withAuth` and of Next.js so the same engine backs the server
 * action and the public API service.
 */

export class ClientMergeBlockedError extends Error {
  constructor(public readonly blockers: MergeBlocker[]) {
    super(blockers.map((entry) => entry.message).join(' '));
    this.name = 'ClientMergeBlockedError';
  }
}

export interface ContactProfileAssignment {
  contactNameId: string;
  billingProfileId: string;
  isManager?: boolean;
  canViewProfileTickets?: boolean;
}

export interface ExternalMappingRemapChoice {
  mappingId: string;
  /** False (or an absent entry) leaves the mapping alone for a manual re-link. */
  apply: boolean;
}

export interface ClientMergeInput {
  sourceClientId: string;
  targetClientId: string;
  contactAssignments?: ContactProfileAssignment[];
  contractDecisions?: ContractDecision[];
  /** Defaults to true — see pinPortalGrants() for why. */
  pinPortalGrants?: boolean;
  externalRemapChoices?: ExternalMappingRemapChoice[];
}

export interface MergeProfilePreview {
  billingProfileId: string;
  currentName: string;
  mergedName: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface MergeContactPreview {
  contactNameId: string;
  fullName: string;
  email: string | null;
  suggestedBillingProfileId: string | null;
}

export interface MergeContractPreview {
  clientContractId: string;
  contractName: string | null;
  startDate: string;
  endDate: string | null;
  billingProfileId: string | null;
  isActive: boolean;
  suggestedChoice: 'original' | 'cutover';
  suggestedCutoverDate: string;
}

export interface MergeExternalMappingPreview {
  mappingId: string;
  integrationType: string;
  algaEntityType: string;
  externalEntityId: string;
  externalRealmId: string | null;
  /** True when the target already owns a mapping for the same integration. */
  targetAlreadyMapped: boolean;
}

export interface ClientMergePreview {
  sourceClientId: string;
  sourceClientName: string;
  targetClientId: string;
  targetClientName: string;
  blockers: MergeBlocker[];
  profiles: MergeProfilePreview[];
  movedDefaultProfileId: string | null;
  counts: Record<string, number>;
  contacts: MergeContactPreview[];
  contracts: MergeContractPreview[];
  visibilityGroupRenames: Array<{ groupId: string; from: string; to: string }>;
  /** Portal users of the source that currently see every billing profile. */
  unrestrictedPortalUserIds: string[];
  externalMappings: MergeExternalMappingPreview[];
}

export interface ClientMergeResult {
  mergeId: string;
  sourceClientId: string;
  targetClientId: string;
  movedProfileIds: string[];
  movedDefaultProfileId: string | null;
  counts: Record<string, number>;
  remappedExternalMappingIds: string[];
  skippedExternalMappingIds: string[];
}

const scoped = (trx: Knex.Transaction, tenant: string, table: string): Knex.QueryBuilder =>
  tenantDb(trx, tenant).table(table);

/**
 * The same lock every billing mutation takes
 * (`packages/billing/src/lib/billing/billingMutationLock.ts`). Re-expressed
 * here rather than imported because `packages/clients` is a vertical feature
 * package and may not depend on `packages/billing`; the two statements must
 * stay identical, so change them together.
 *
 * Without it a billing cycle could change owner halfway through an invoice
 * generation run that had already read it.
 */
async function lockTenantBilling(trx: Knex.Transaction, tenant: string): Promise<void> {
  await trx.raw("select pg_advisory_xact_lock(hashtextextended(? || ':billing-semantics', 0))", [tenant]);
  await trx.raw(
    'insert into billing_semantics_locks (tenant) values (?) on conflict (tenant) do update set tenant = excluded.tenant',
    [tenant],
  );
}

async function readClientFacts(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<MergeClientFacts | null> {
  const row = await scoped(trx, tenant, 'clients')
    .where({ client_id: clientId })
    .first('client_id', 'client_name', 'merged_into_client_id', 'properties');
  if (!row) return null;

  const tenantDefault = await scoped(trx, tenant, 'tenant_companies')
    .where({ client_id: clientId, is_default: true })
    .first('client_id');

  return {
    clientId: row.client_id as string,
    clientName: row.client_name as string,
    mergedIntoClientId: (row.merged_into_client_id as string | null) ?? null,
    isTenantDefault: Boolean(tenantDefault),
  };
}

/** The soft parent chain above `clientId`, nearest first, cycle-safe. */
async function readParentChain(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<string[]> {
  const chain: string[] = [];
  const seen = new Set<string>([clientId]);
  let cursor: string | null = clientId;

  while (cursor) {
    const row: { properties?: Record<string, unknown> | null } | undefined = await scoped(trx, tenant, 'clients')
      .where({ client_id: cursor })
      .first('properties');
    const parent: unknown = (row?.properties ?? {}).parent_client_id;
    if (typeof parent !== 'string' || !parent || seen.has(parent)) break;
    chain.push(parent);
    seen.add(parent);
    cursor = parent;
  }

  return chain;
}

async function countRows(
  trx: Knex.Transaction,
  tenant: string,
  table: string,
  where: Record<string, unknown>,
): Promise<number> {
  const row = await scoped(trx, tenant, table).where(where).count<{ count: string }>('* as count').first();
  return Number(row?.count ?? 0);
}

/**
 * Enterprise tables are absent in CE, and touching a missing relation inside a
 * transaction aborts the whole merge — so ask the catalog first rather than
 * letting the query fail.
 */
async function tableInstalled(trx: Knex.Transaction, table: string): Promise<boolean> {
  return trx.schema.hasTable(table);
}

/**
 * One entry of the move matrix: stamp the profile where the table takes one,
 * clear out rows the target already owns, then re-point the rest.
 */
async function moveClientOwnedRows(
  trx: Knex.Transaction,
  tenant: string,
  entry: ClientOwnedMoveTable,
  sourceClientId: string,
  targetClientId: string,
  movedDefaultProfileId: string | null,
): Promise<number> {
  if (entry.editionOptional && !(await tableInstalled(trx, entry.table))) return 0;

  if (entry.stampsBillingProfile && movedDefaultProfileId) {
    // Stamped *before* the move, while the rows are still identifiable, and
    // because leaving them NULL would re-attribute them to the parent's default
    // the next time the attribution chain ran.
    await scoped(trx, tenant, entry.table)
      .where({ client_id: sourceClientId })
      .whereNull('billing_profile_id')
      .update({ billing_profile_id: movedDefaultProfileId });
  }

  if (!entry.conflictKeyColumns) {
    return scoped(trx, tenant, entry.table)
      .where({ client_id: sourceClientId })
      .update({ client_id: targetClientId });
  }

  const keyColumns = entry.conflictKeyColumns;
  // With no key columns the client is the whole key, so any row on the target
  // collides with any row on the source; they share the empty key.
  const selectColumns = keyColumns.length > 0 ? keyColumns : ['client_id'];
  const keyOf = (row: Record<string, unknown>) => keyColumns.map((column) => String(row[column])).join('::');
  const whereRow = (row: Record<string, unknown>) => {
    const where: Record<string, unknown> = { client_id: sourceClientId };
    for (const column of keyColumns) where[column] = row[column];
    return where;
  };

  const readKeys = async (clientId: string) =>
    (await scoped(trx, tenant, entry.table)
      .where({ client_id: clientId })
      .select(...selectColumns)) as Array<Record<string, unknown>>;

  const taken = new Set((await readKeys(targetClientId)).map(keyOf));
  let moved = 0;

  for (const row of await readKeys(sourceClientId)) {
    if (taken.has(keyOf(row))) {
      // 'leave' keeps the row on the tombstone for someone who can decide;
      // 'drop' discards it because the target's row supersedes it.
      if (entry.onCollision !== 'leave') {
        await scoped(trx, tenant, entry.table).where(whereRow(row)).del();
      }
      continue;
    }
    taken.add(keyOf(row));
    moved += await scoped(trx, tenant, entry.table).where(whereRow(row)).update({ client_id: targetClientId });
  }

  return moved;
}

async function readSourceProfiles(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<SourceBillingProfile[]> {
  return (await scoped(trx, tenant, 'client_billing_profiles')
    .where({ client_id: clientId })
    .orderBy('is_default', 'desc')
    .orderBy('name', 'asc')
    .select(
      'billing_profile_id',
      'name',
      'is_default',
      'is_system_managed_default',
      'is_active',
    )) as SourceBillingProfile[];
}

async function readContracts(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<MergeableContract[]> {
  const db = tenantDb(trx, tenant);
  const query = db.table('client_contracts');
  db.tenantJoin(query, 'contracts', 'contracts.contract_id', 'client_contracts.contract_id');
  const rows = await query
    .where({ 'client_contracts.client_id': clientId })
    .select(
      'client_contracts.client_contract_id',
      'client_contracts.contract_id',
      'client_contracts.start_date',
      'client_contracts.end_date',
      'client_contracts.billing_profile_id',
      'client_contracts.is_active',
      'contracts.contract_name',
    );
  return rows.map((row: any) => ({
    clientContractId: row.client_contract_id,
    contractId: row.contract_id,
    contractName: row.contract_name ?? null,
    startDate: typeof row.start_date === 'string' ? row.start_date : new Date(row.start_date).toISOString(),
    endDate: row.end_date
      ? (typeof row.end_date === 'string' ? row.end_date : new Date(row.end_date).toISOString())
      : null,
    billingProfileId: row.billing_profile_id ?? null,
    isActive: Boolean(row.is_active),
  }));
}

/**
 * Group names are unique per client, so a group moving onto the target can
 * collide with one already there. Colliding groups are renamed rather than
 * dropped: a moved contact still points at its group, and deleting it would
 * make `getClientContactVisibilityContext` throw for that contact.
 */
function planVisibilityGroupRenames(
  sourceGroups: Array<{ group_id: string; name: string }>,
  targetGroupNames: string[],
  sourceClientName: string,
): Array<{ groupId: string; from: string; to: string }> {
  const used = new Set(targetGroupNames.map((name) => name.trim().toLowerCase()));
  const renames: Array<{ groupId: string; from: string; to: string }> = [];

  for (const group of sourceGroups) {
    if (!used.has(group.name.trim().toLowerCase())) {
      used.add(group.name.trim().toLowerCase());
      continue;
    }
    let candidate = `${group.name} (${sourceClientName})`;
    let suffix = 2;
    while (used.has(candidate.trim().toLowerCase())) {
      candidate = `${group.name} (${sourceClientName} ${suffix})`;
      suffix += 1;
    }
    used.add(candidate.trim().toLowerCase());
    renames.push({ groupId: group.group_id, from: group.name, to: candidate });
  }

  return renames;
}

export async function previewClientMerge(
  trx: Knex.Transaction,
  tenant: string,
  input: { sourceClientId: string; targetClientId: string },
): Promise<ClientMergePreview> {
  const source = await readClientFacts(trx, tenant, input.sourceClientId);
  const target = await readClientFacts(trx, tenant, input.targetClientId);
  const targetAncestorClientIds = target ? await readParentChain(trx, tenant, target.clientId) : [];
  const blockers = evaluateMergeGuards({ source, target, targetAncestorClientIds });

  if (!source || !target) {
    return {
      sourceClientId: input.sourceClientId,
      sourceClientName: source?.clientName ?? '',
      targetClientId: input.targetClientId,
      targetClientName: target?.clientName ?? '',
      blockers,
      profiles: [],
      movedDefaultProfileId: null,
      counts: {},
      contacts: [],
      contracts: [],
      visibilityGroupRenames: [],
      unrestrictedPortalUserIds: [],
      externalMappings: [],
    };
  }

  const sourceProfiles = await readSourceProfiles(trx, tenant, source.clientId);
  const targetProfiles = await readSourceProfiles(trx, tenant, target.clientId);
  const plan = planBillingProfileMoves(
    sourceProfiles,
    source.clientName,
    targetProfiles.map((profile) => profile.name),
  );
  const mergedNameById = new Map(plan.moves.map((move) => [move.billingProfileId, move.name]));

  const counts: Record<string, number> = {};
  for (const entry of CLIENT_OWNED_MOVE_TABLES) {
    counts[entry.label] = entry.editionOptional && !(await tableInstalled(trx, entry.table))
      ? 0
      : await countRows(trx, tenant, entry.table, { client_id: source.clientId });
  }
  for (const entry of PROFILE_HISTORY_TABLES) {
    counts[entry.label] = await countRows(trx, tenant, entry.table, { client_id: source.clientId });
  }
  counts['billing profile'] = sourceProfiles.length;
  counts['owned contract'] = await countRows(trx, tenant, 'contracts', {
    owner_client_id: source.clientId,
  });

  const contactRows = await scoped(trx, tenant, 'contacts')
    .where({ client_id: source.clientId })
    .orderBy('full_name', 'asc')
    .select('contact_name_id', 'full_name', 'email');

  const sourceGroups = await scoped(trx, tenant, 'client_portal_visibility_groups')
    .where({ client_id: source.clientId })
    .select('group_id', 'name');
  const targetGroups = await scoped(trx, tenant, 'client_portal_visibility_groups')
    .where({ client_id: target.clientId })
    .select('name');

  const contracts = await readContracts(trx, tenant, source.clientId);
  const suggestedCutover = suggestCutoverDate();

  const contactIds = contactRows.map((row: any) => row.contact_name_id as string);
  const unrestrictedPortalUserIds = await findUnrestrictedPortalUsers(trx, tenant, contactIds);

  const externalMappings = await readExternalMappings(trx, tenant, source.clientId, target.clientId);

  return {
    sourceClientId: source.clientId,
    sourceClientName: source.clientName,
    targetClientId: target.clientId,
    targetClientName: target.clientName,
    blockers,
    profiles: sourceProfiles.map((profile) => ({
      billingProfileId: profile.billing_profile_id,
      currentName: profile.name,
      mergedName: mergedNameById.get(profile.billing_profile_id) ?? profile.name,
      isDefault: profile.is_default,
      isActive: profile.is_active,
    })),
    movedDefaultProfileId: plan.movedDefaultProfileId,
    counts,
    contacts: contactRows.map((row: any) => ({
      contactNameId: row.contact_name_id,
      fullName: row.full_name ?? '',
      email: row.email ?? null,
      suggestedBillingProfileId: plan.movedDefaultProfileId,
    })),
    contracts: contracts.map((contract) => ({
      clientContractId: contract.clientContractId,
      contractName: contract.contractName,
      startDate: contract.startDate,
      endDate: contract.endDate,
      billingProfileId: contract.billingProfileId,
      isActive: contract.isActive,
      // Moving with the original dates changes no billing period, so that is
      // what is suggested; a cutover is the deliberate choice.
      suggestedChoice: 'original',
      suggestedCutoverDate: suggestedCutover,
    })),
    visibilityGroupRenames: planVisibilityGroupRenames(
      sourceGroups as Array<{ group_id: string; name: string }>,
      (targetGroups as Array<{ name: string }>).map((group) => group.name),
      source.clientName,
    ),
    unrestrictedPortalUserIds,
    externalMappings,
  };
}

async function findUnrestrictedPortalUsers(
  trx: Knex.Transaction,
  tenant: string,
  contactIds: string[],
): Promise<string[]> {
  if (contactIds.length === 0) return [];
  const users = await scoped(trx, tenant, 'users')
    .where({ user_type: 'client' })
    .whereIn('contact_id', contactIds)
    .select('user_id');
  const userIds: string[] = users.map((row: any) => row.user_id as string);
  if (userIds.length === 0) return [];

  const restricted = await scoped(trx, tenant, 'client_portal_user_billing_profiles')
    .whereIn('user_id', userIds)
    .distinct('user_id');
  const restrictedIds = new Set(restricted.map((row: any) => row.user_id as string));
  return userIds.filter((userId) => !restrictedIds.has(userId));
}

async function readExternalMappings(
  trx: Knex.Transaction,
  tenant: string,
  sourceClientId: string,
  targetClientId: string,
): Promise<MergeExternalMappingPreview[]> {
  const rows = await scoped(trx, tenant, 'tenant_external_entity_mappings')
    .where({ alga_entity_id: sourceClientId })
    .whereNull('deleted_at')
    .select('id', 'integration_type', 'alga_entity_type', 'external_entity_id', 'external_realm_id');
  if (rows.length === 0) return [];

  const targetRows = await scoped(trx, tenant, 'tenant_external_entity_mappings')
    .where({ alga_entity_id: targetClientId })
    .whereNull('deleted_at')
    .select('integration_type', 'alga_entity_type');
  const takenKeys = new Set(
    targetRows.map((row: any) => `${row.integration_type}::${row.alga_entity_type}`),
  );

  return rows.map((row: any) => ({
    mappingId: row.id,
    integrationType: row.integration_type,
    algaEntityType: row.alga_entity_type,
    externalEntityId: row.external_entity_id,
    externalRealmId: row.external_realm_id ?? null,
    targetAlreadyMapped: takenKeys.has(`${row.integration_type}::${row.alga_entity_type}`),
  }));
}

/**
 * Absence of a row in `client_portal_user_billing_profiles` deliberately means
 * "every profile" (see that table's migration). Harmless while a portal user's
 * client has one profile; after a merge it would hand a site manager the whole
 * parent's billing. Pinning writes the grant they effectively had, so the
 * default stays "nothing changed for this person".
 */
async function pinPortalGrants(
  trx: Knex.Transaction,
  tenant: string,
  userIds: string[],
  profileIds: string[],
  actorUserId: string | null,
): Promise<number> {
  if (userIds.length === 0 || profileIds.length === 0) return 0;
  const rows = userIds.flatMap((userId) =>
    profileIds.map((billingProfileId) => ({
      tenant,
      user_id: userId,
      billing_profile_id: billingProfileId,
      created_by: actorUserId,
    })),
  );
  await scoped(trx, tenant, 'client_portal_user_billing_profiles')
    .insert(rows)
    .onConflict(['tenant', 'user_id', 'billing_profile_id'])
    .ignore();
  return rows.length;
}

export async function executeClientMerge(
  trx: Knex.Transaction,
  tenant: string,
  actorUserId: string | null,
  input: ClientMergeInput,
): Promise<ClientMergeResult> {
  await lockTenantBilling(trx, tenant);

  const source = await readClientFacts(trx, tenant, input.sourceClientId);
  const target = await readClientFacts(trx, tenant, input.targetClientId);
  const targetAncestorClientIds = target ? await readParentChain(trx, tenant, target.clientId) : [];
  const blockers = evaluateMergeGuards({ source, target, targetAncestorClientIds });
  if (blockers.length > 0 || !source || !target) {
    throw new ClientMergeBlockedError(blockers);
  }

  // Both sides must satisfy the one-default-per-client invariant before and
  // after; provisioning here means a client that somehow lost its default does
  // not fail the merge at COMMIT with an opaque trigger error.
  await ensureClientDefaultBillingProfile(trx, tenant, source.clientId, { clientName: source.clientName });
  await ensureClientDefaultBillingProfile(trx, tenant, target.clientId, { clientName: target.clientName });

  const counts: Record<string, number> = {};

  // Captured before contacts move, because the portal-user lookup goes through
  // contacts and would return nothing once they belong to the target.
  const sourceContacts = await scoped(trx, tenant, 'contacts')
    .where({ client_id: source.clientId })
    .select('contact_name_id');
  const sourceContactIds = sourceContacts.map((row: any) => row.contact_name_id as string);
  const unrestrictedPortalUserIds = input.pinPortalGrants === false
    ? []
    : await findUnrestrictedPortalUsers(trx, tenant, sourceContactIds);

  const sourceProfiles = await readSourceProfiles(trx, tenant, source.clientId);
  const targetProfiles = await readSourceProfiles(trx, tenant, target.clientId);
  const plan = planBillingProfileMoves(
    sourceProfiles,
    source.clientName,
    targetProfiles.map((profile) => profile.name),
  );
  const movedProfileIds = plan.moves.map((move) => move.billingProfileId);
  const movedDefaultProfileId = plan.movedDefaultProfileId;

  // --- 1. The profiles themselves ---------------------------------------
  for (const move of plan.moves) {
    await scoped(trx, tenant, 'client_billing_profiles')
      .where({ billing_profile_id: move.billingProfileId })
      .update({
        client_id: target.clientId,
        name: move.name,
        // Inside the parent this profile is one segment among several, and it
        // was never the parent's system-named default.
        is_default: false,
        is_system_managed_default: false,
        updated_by: actorUserId,
        updated_at: trx.fn.now(),
      });
  }
  counts['billing profile'] = plan.moves.length;

  // The archived shell still has to hold exactly one default (F002).
  await ensureClientDefaultBillingProfile(trx, tenant, source.clientId, { clientName: source.clientName });

  // --- 2. Billing history that carries a redundant client_id -------------
  for (const entry of PROFILE_HISTORY_TABLES) {
    // A null profile is legitimate on three of these tables and is still
    // written today (a sales-order invoice and its transaction, a transferred
    // credit). Stamp those onto the moved default first — otherwise they match
    // no moved profile, keep `client_id` pointing at the tombstone, and drop out
    // of the target's credit balance and AR rollups for good.
    if (entry.nullableBillingProfile && movedDefaultProfileId) {
      await scoped(trx, tenant, entry.table)
        .where({ client_id: source.clientId })
        .whereNull('billing_profile_id')
        .update({ billing_profile_id: movedDefaultProfileId });
    }
    // Every profile the source owned moves, so "the source's rows" and "rows on
    // a moved profile" are the same set once the nulls are stamped, and keying
    // the move on `client_id` alone guarantees nothing is left behind.
    counts[entry.label] = await scoped(trx, tenant, entry.table)
      .where({ client_id: source.clientId })
      .update({ client_id: target.clientId });
  }
  // `invoice_charges` and `credit_allocations` hold a billing profile but no
  // client column, so the profile move already carried them; a null there
  // resolves through the parent invoice or transaction, which has just moved.

  // --- 3. Contracts, per the operator's per-contract decision ------------
  const decisionsById = new Map(
    (input.contractDecisions ?? []).map((decision) => [decision.clientContractId, decision]),
  );
  const contracts = await readContracts(trx, tenant, source.clientId);
  const contractDecisions: Array<Record<string, unknown>> = [];
  let movedContracts = 0;
  let cutOverContracts = 0;

  for (const contract of contracts) {
    const movePlan = planContractMove(contract, decisionsById.get(contract.clientContractId), movedDefaultProfileId);
    if (movePlan.kind === 'invalid') {
      throw new ClientMergeBlockedError([{
        code: 'INVALID_CONTRACT_CUTOVER',
        message: `${contract.contractName ?? 'Contract'}: ${movePlan.reason}`,
        i18nKey: 'msp/clients:errors.clientMerge.invalidContractCutover',
      }]);
    }

    if (movePlan.kind === 'move') {
      await scoped(trx, tenant, 'client_contracts')
        .where({ client_contract_id: contract.clientContractId })
        .update({
          client_id: target.clientId,
          ...(movePlan.stampBillingProfileId
            ? { billing_profile_id: movePlan.stampBillingProfileId }
            : {}),
        });
      movedContracts += 1;
      contractDecisions.push({ clientContractId: contract.clientContractId, choice: 'original' });
      continue;
    }

    // Cutover: the source assignment stops the day before, and a clone starts
    // on the target at the cutover date. Cloning the whole row keeps renewal
    // policy, PO data and billing timing intact without enumerating columns
    // that other slices keep adding to.
    const original = await scoped(trx, tenant, 'client_contracts')
      .where({ client_contract_id: contract.clientContractId })
      .first();
    await scoped(trx, tenant, 'client_contracts')
      .where({ client_contract_id: contract.clientContractId })
      .update({ end_date: movePlan.terminateAt, is_active: false });

    const clone: Record<string, unknown> = { ...(original as Record<string, unknown>) };
    delete clone.client_contract_id;
    delete clone.created_at;
    delete clone.updated_at;
    clone.client_id = target.clientId;
    clone.start_date = movePlan.cutoverDate;
    clone.end_date = contract.endDate;
    clone.is_active = contract.isActive;
    if (movePlan.stampBillingProfileId) {
      clone.billing_profile_id = movePlan.stampBillingProfileId;
    }
    await scoped(trx, tenant, 'client_contracts').insert(clone);

    cutOverContracts += 1;
    contractDecisions.push({
      clientContractId: contract.clientContractId,
      choice: 'cutover',
      cutoverDate: movePlan.cutoverDate,
    });
  }
  counts['contract moved'] = movedContracts;
  counts['contract cut over'] = cutOverContracts;

  // A client-owned contract's owner has to follow its assignments. The whole
  // recurring chain reads `contracts.owner_client_id`: materialization keys the
  // client cadence off it (recurringServicePeriodSync) and generation joins
  // through it to match the cycle's client, so an owner left on the tombstone
  // makes every moved recurring contract unbillable — invoice generation fails
  // with "Recurring service periods were not materialized for this recurring
  // execution window" rather than producing a wrong number.
  const targetOwnsDefaultContract = await scoped(trx, tenant, 'contracts')
    .where({ owner_client_id: target.clientId, is_system_managed_default: true })
    .first('contract_id');
  if (targetOwnsDefaultContract) {
    // `contracts_system_managed_default_unique_per_client` allows one per owner,
    // and the parent already has its container contract. The incoming one
    // arrives as an ordinary client-owned contract — the same demotion the
    // source's default billing profile gets.
    await scoped(trx, tenant, 'contracts')
      .where({ owner_client_id: source.clientId, is_system_managed_default: true })
      .update({ is_system_managed_default: false });
  }
  counts['owned contract'] = await scoped(trx, tenant, 'contracts')
    .where({ owner_client_id: source.clientId })
    .update({ owner_client_id: target.clientId });

  // --- 4. Visibility groups (renamed on collision, then moved) -----------
  const sourceGroups = await scoped(trx, tenant, 'client_portal_visibility_groups')
    .where({ client_id: source.clientId })
    .select('group_id', 'name');
  const targetGroups = await scoped(trx, tenant, 'client_portal_visibility_groups')
    .where({ client_id: target.clientId })
    .select('name');
  const renames = planVisibilityGroupRenames(
    sourceGroups as Array<{ group_id: string; name: string }>,
    (targetGroups as Array<{ name: string }>).map((group) => group.name),
    source.clientName,
  );
  for (const rename of renames) {
    await scoped(trx, tenant, 'client_portal_visibility_groups')
      .where({ group_id: rename.groupId })
      .update({ name: rename.to });
  }
  counts['visibility group'] = await scoped(trx, tenant, 'client_portal_visibility_groups')
    .where({ client_id: source.clientId })
    .update({ client_id: target.clientId });

  // --- 5. Work items and the plain client-keyed tables -------------------

  // `ux_client_locations_default_per_client` allows one default location per
  // client, so a source default arriving at a target that already has one
  // would abort the whole merge on a unique violation. The target's default is
  // the one that stays: it is the client the group is now run as.
  const targetHasDefaultLocation = await scoped(trx, tenant, 'client_locations')
    .where({ client_id: target.clientId, is_default: true })
    .first('location_id');
  if (targetHasDefaultLocation) {
    await scoped(trx, tenant, 'client_locations')
      .where({ client_id: source.clientId, is_default: true })
      .update({ is_default: false });
  }

  for (const entry of CLIENT_OWNED_MOVE_TABLES) {
    counts[entry.label] = await moveClientOwnedRows(
      trx,
      tenant,
      entry,
      source.clientId,
      target.clientId,
      movedDefaultProfileId,
    );
  }

  // --- 6. Polymorphic associations ---------------------------------------
  counts['logo demoted'] = await demoteCollidingLogos(
    trx,
    tenant,
    CLIENT_DOCUMENT_ENTITY_TYPES,
    source.clientId,
    target.clientId,
  );
  counts.document = await movePolymorphic(
    trx,
    tenant,
    'document_associations',
    CLIENT_DOCUMENT_ENTITY_TYPES,
    source.clientId,
    target.clientId,
    ['document_id', 'entity_type'],
  );
  counts['asset association'] = await movePolymorphic(
    trx,
    tenant,
    'asset_associations',
    ['client'],
    source.clientId,
    target.clientId,
    ['asset_id', 'entity_type'],
  );
  counts.tag = await moveTagMappings(trx, tenant, source.clientId, target.clientId);

  // --- 7. Contacts ↔ profiles --------------------------------------------
  const movedProfileIdSet = new Set(movedProfileIds);
  const assignments = (input.contactAssignments ?? []).filter(
    (assignment) => movedProfileIdSet.has(assignment.billingProfileId)
      && sourceContactIds.includes(assignment.contactNameId),
  );
  if (assignments.length > 0) {
    await scoped(trx, tenant, 'billing_profile_contacts')
      .insert(assignments.map((assignment) => ({
        tenant,
        billing_profile_id: assignment.billingProfileId,
        contact_name_id: assignment.contactNameId,
        is_manager: Boolean(assignment.isManager),
        can_view_profile_tickets: Boolean(assignment.canViewProfileTickets),
        created_by: actorUserId,
      })))
      .onConflict(['tenant', 'billing_profile_id', 'contact_name_id'])
      .merge(['is_manager', 'can_view_profile_tickets']);
  }
  counts['profile contact'] = assignments.length;

  // --- 8. Portal billing-segment grants ----------------------------------
  counts['portal grant'] = await pinPortalGrants(
    trx,
    tenant,
    unrestrictedPortalUserIds,
    movedProfileIds,
    actorUserId,
  );

  // --- 9. External accounting, only where confirmed ----------------------
  const { remapped, skipped } = await applyExternalRemaps(
    trx,
    tenant,
    source.clientId,
    target.clientId,
    input.externalRemapChoices ?? [],
  );

  // --- 10. Tombstone, hierarchy tidy-up and audit ------------------------
  const mergedAt = new Date();
  await scoped(trx, tenant, 'clients')
    .where({ client_id: source.clientId })
    .update({
      is_inactive: true,
      merged_into_client_id: target.clientId,
      merged_at: mergedAt,
      updated_at: mergedAt,
    });

  // Other clients recorded as children of the source now hang off the target,
  // so the soft hierarchy does not point at a tombstone.
  await trx.raw(
    `UPDATE clients
        SET properties = jsonb_set(
              jsonb_set(coalesce(properties, '{}'::jsonb), '{parent_client_id}', to_jsonb(?::text), true),
              '{parent_client_name}', to_jsonb(?::text), true)
      WHERE tenant = ?
        AND properties->>'parent_client_id' = ?`,
    [target.clientId, target.clientName, tenant, source.clientId],
  );

  const [auditRow] = await scoped(trx, tenant, 'client_merges').insert(
    {
      tenant,
      source_client_id: source.clientId,
      target_client_id: target.clientId,
      source_client_name: source.clientName,
      moved_profile_ids: movedProfileIds,
      moved_counts: JSON.stringify(counts),
      contract_decisions: JSON.stringify(contractDecisions),
      strategy: 'merge_into_billing_profile',
      merged_by: actorUserId,
      merged_at: mergedAt,
    },
    ['merge_id'],
  );

  return {
    mergeId: auditRow?.merge_id as string,
    sourceClientId: source.clientId,
    targetClientId: target.clientId,
    movedProfileIds,
    movedDefaultProfileId,
    counts,
    remappedExternalMappingIds: remapped,
    skippedExternalMappingIds: skipped,
  };
}

/** Client documents are filed under the current type and the legacy one. */
const CLIENT_DOCUMENT_ENTITY_TYPES = ['client', 'company'];

/**
 * A client's logo is a `document_associations` row flagged `is_entity_logo`, and
 * `uq_document_associations_single_true_logo` allows exactly one per
 * (entity, entity_type, logo variant). Both clients in a merge normally have
 * one, so moving the source's row onto the target hits that index and aborts the
 * whole merge with a duplicate-key error.
 *
 * The target keeps its own branding: where it already fills a logo slot, the
 * incoming row is demoted to a plain association — precisely what uploading a
 * replacement logo does to the previous one (entityImageService), so the
 * document still arrives and can be re-flagged from the UI. A slot the target
 * leaves empty is inherited instead, either by letting the move carry the flag
 * or, when the target already files the same document, by promoting the row that
 * survives deduplication.
 */
async function demoteCollidingLogos(
  trx: Knex.Transaction,
  tenant: string,
  entityTypes: string[],
  sourceClientId: string,
  targetClientId: string,
): Promise<number> {
  const slotOf = (row: { entity_type: string; entity_logo_variant: string | null }) =>
    `${row.entity_type}::${row.entity_logo_variant ?? 'default'}`;

  const sourceLogos = await scoped(trx, tenant, 'document_associations')
    .where({ entity_id: sourceClientId, is_entity_logo: true })
    .whereIn('entity_type', entityTypes)
    .select('document_id', 'entity_type', 'entity_logo_variant');
  if (sourceLogos.length === 0) return 0;

  const targetLogos = await scoped(trx, tenant, 'document_associations')
    .where({ entity_id: targetClientId, is_entity_logo: true })
    .whereIn('entity_type', entityTypes)
    .select('entity_type', 'entity_logo_variant');
  const taken = new Set((targetLogos as Array<any>).map(slotOf));

  let demoted = 0;
  for (const logo of sourceLogos as Array<any>) {
    if (!taken.has(slotOf(logo))) {
      taken.add(slotOf(logo));
      const duplicate = await scoped(trx, tenant, 'document_associations')
        .where({
          entity_id: targetClientId,
          entity_type: logo.entity_type,
          document_id: logo.document_id,
        })
        .first('association_id');
      // No duplicate: movePolymorphic carries the row, flag and all.
      if (!duplicate) continue;
      await scoped(trx, tenant, 'document_associations')
        .where({ association_id: (duplicate as any).association_id })
        .update({
          is_entity_logo: true,
          entity_logo_variant: logo.entity_logo_variant ?? 'default',
        });
    }
    demoted += await scoped(trx, tenant, 'document_associations')
      .where({
        entity_id: sourceClientId,
        entity_type: logo.entity_type,
        document_id: logo.document_id,
      })
      .update({ is_entity_logo: false });
  }
  return demoted;
}

/**
 * Polymorphic association tables key on (entity_id, entity_type) and carry a
 * uniqueness constraint that the target may already satisfy — the same document
 * filed against both clients, say. Colliding rows are dropped rather than moved,
 * because the association they express already exists on the target.
 */
async function movePolymorphic(
  trx: Knex.Transaction,
  tenant: string,
  table: string,
  entityTypes: string[],
  sourceClientId: string,
  targetClientId: string,
  siblingKeyColumns: string[],
): Promise<number> {
  const existing = await scoped(trx, tenant, table)
    .where({ entity_id: targetClientId })
    .whereIn('entity_type', entityTypes)
    .select(...siblingKeyColumns);
  const taken = new Set(
    existing.map((row: any) => siblingKeyColumns.map((column) => row[column]).join('::')),
  );

  const candidates = await scoped(trx, tenant, table)
    .where({ entity_id: sourceClientId })
    .whereIn('entity_type', entityTypes)
    .select(...siblingKeyColumns);

  let moved = 0;
  for (const row of candidates as Array<Record<string, unknown>>) {
    const key = siblingKeyColumns.map((column) => row[column]).join('::');
    const where: Record<string, unknown> = { entity_id: sourceClientId };
    for (const column of siblingKeyColumns) where[column] = row[column];

    if (taken.has(key)) {
      await scoped(trx, tenant, table).where(where).del();
      continue;
    }
    taken.add(key);
    moved += await scoped(trx, tenant, table).where(where).update({ entity_id: targetClientId });
  }
  return moved;
}

/** `tag_mappings` is unique on (tenant, tag_id, tagged_id); a tag the target already carries is dropped. */
async function moveTagMappings(
  trx: Knex.Transaction,
  tenant: string,
  sourceClientId: string,
  targetClientId: string,
): Promise<number> {
  const existing = await scoped(trx, tenant, 'tag_mappings')
    .where({ tagged_id: targetClientId, tagged_type: 'client' })
    .select('tag_id');
  const taken = new Set(existing.map((row: any) => row.tag_id as string));

  const candidates = await scoped(trx, tenant, 'tag_mappings')
    .where({ tagged_id: sourceClientId, tagged_type: 'client' })
    .select('mapping_id', 'tag_id');

  let moved = 0;
  for (const row of candidates as Array<{ mapping_id: string; tag_id: string }>) {
    if (taken.has(row.tag_id)) {
      await scoped(trx, tenant, 'tag_mappings').where({ mapping_id: row.mapping_id }).del();
      continue;
    }
    taken.add(row.tag_id);
    moved += await scoped(trx, tenant, 'tag_mappings')
      .where({ mapping_id: row.mapping_id })
      .update({ tagged_id: targetClientId });
  }
  return moved;
}

/**
 * Nothing here happens unless the operator ticked the row (Q8). A mapping whose
 * target slot is already occupied is skipped and reported rather than
 * overwritten — the uniqueness constraint would reject it anyway, and silently
 * discarding an accounting link is not an outcome to guess at.
 */
export async function applyExternalRemaps(
  trx: Knex.Transaction,
  tenant: string,
  sourceClientId: string,
  targetClientId: string,
  choices: ExternalMappingRemapChoice[],
): Promise<{ remapped: string[]; skipped: string[] }> {
  const wanted = new Set(choices.filter((choice) => choice.apply).map((choice) => choice.mappingId));
  if (wanted.size === 0) return { remapped: [], skipped: [] };

  const mappings = await readExternalMappings(trx, tenant, sourceClientId, targetClientId);
  const remapped: string[] = [];
  const skipped: string[] = [];

  for (const mapping of mappings) {
    if (!wanted.has(mapping.mappingId)) continue;
    if (mapping.targetAlreadyMapped) {
      skipped.push(mapping.mappingId);
      continue;
    }
    await scoped(trx, tenant, 'tenant_external_entity_mappings')
      .where({ id: mapping.mappingId, alga_entity_id: sourceClientId })
      .update({ alga_entity_id: targetClientId });
    remapped.push(mapping.mappingId);
  }

  return { remapped, skipped };
}
