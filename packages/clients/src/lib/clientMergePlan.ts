/**
 * The decisions a client merge makes, expressed without a database.
 *
 * The merge itself is a long sequence of tenant-scoped UPDATEs, which is
 * exactly the kind of code that is impossible to reason about once it is
 * interleaved with SQL. Everything here is the part that can be wrong in an
 * interesting way — which merges are refused, which profile ends up carrying
 * the source's identity, whether a contract moves or is cut over — so it lives
 * apart from the writes and is tested directly.
 */

export type MergeBlockerCode =
  | 'SAME_CLIENT'
  | 'SOURCE_NOT_FOUND'
  | 'TARGET_NOT_FOUND'
  | 'SOURCE_ALREADY_MERGED'
  | 'TARGET_ALREADY_MERGED'
  | 'SOURCE_IS_TENANT_DEFAULT'
  | 'PARENT_LINK_CYCLE'
  | 'INVALID_CONTRACT_CUTOVER';

export interface MergeBlocker {
  code: MergeBlockerCode;
  message: string;
  /** i18n key for the UI; the message is the fallback. */
  i18nKey: string;
}

export interface MergeClientFacts {
  clientId: string;
  clientName: string;
  mergedIntoClientId: string | null;
  /** The tenant's own client record cannot be absorbed into a customer. */
  isTenantDefault: boolean;
}

export interface MergeGuardInput {
  source: MergeClientFacts | null;
  target: MergeClientFacts | null;
  /**
   * The target's soft parent chain (`clients.properties.parent_client_id`),
   * nearest first. If the source appears in it, the target is a descendant of
   * the source and the merge would invert the recorded hierarchy.
   */
  targetAncestorClientIds: string[];
}

const blocker = (code: MergeBlockerCode, message: string, i18nKey: string): MergeBlocker => ({
  code,
  message,
  i18nKey,
});

export function evaluateMergeGuards(input: MergeGuardInput): MergeBlocker[] {
  const blockers: MergeBlocker[] = [];

  if (!input.source) {
    blockers.push(blocker(
      'SOURCE_NOT_FOUND',
      'The client being merged no longer exists.',
      'msp/clients:errors.clientMerge.sourceNotFound',
    ));
  }
  if (!input.target) {
    blockers.push(blocker(
      'TARGET_NOT_FOUND',
      'The client being merged into no longer exists.',
      'msp/clients:errors.clientMerge.targetNotFound',
    ));
  }
  if (!input.source || !input.target) {
    return blockers;
  }

  if (input.source.clientId === input.target.clientId) {
    blockers.push(blocker(
      'SAME_CLIENT',
      'A client cannot be merged into itself.',
      'msp/clients:errors.clientMerge.sameClient',
    ));
  }
  if (input.source.mergedIntoClientId) {
    blockers.push(blocker(
      'SOURCE_ALREADY_MERGED',
      'This client has already been merged into another client.',
      'msp/clients:errors.clientMerge.sourceAlreadyMerged',
    ));
  }
  if (input.target.mergedIntoClientId) {
    blockers.push(blocker(
      'TARGET_ALREADY_MERGED',
      'The destination client has itself been merged into another client. Merge into that one instead.',
      'msp/clients:errors.clientMerge.targetAlreadyMerged',
    ));
  }
  if (input.source.isTenantDefault) {
    blockers.push(blocker(
      'SOURCE_IS_TENANT_DEFAULT',
      'Your own organisation record cannot be merged into a client.',
      'msp/clients:errors.clientMerge.sourceIsTenantDefault',
    ));
  }
  // Absorbing a client into one of its own recorded children would leave the
  // parent link pointing at a tombstone and the hierarchy upside down.
  if (input.targetAncestorClientIds.includes(input.source.clientId)) {
    blockers.push(blocker(
      'PARENT_LINK_CYCLE',
      'That client is recorded as a child of the one you are merging, so merging this way would invert the hierarchy.',
      'msp/clients:errors.clientMerge.parentLinkCycle',
    ));
  }

  return blockers;
}

export interface SourceBillingProfile {
  billing_profile_id: string;
  name: string;
  is_default: boolean;
  is_system_managed_default: boolean;
  is_active: boolean;
}

export interface BillingProfileMove {
  billingProfileId: string;
  /** The name the profile carries on the target. */
  name: string;
  /** Set when the merge renamed the profile, for the audit trail. */
  renamedFrom: string | null;
  wasSourceDefault: boolean;
}

export interface BillingProfileMovePlan {
  moves: BillingProfileMove[];
  /**
   * Where work items that arrive with no profile of their own are attributed.
   * Null only when the source somehow has no profiles at all.
   */
  movedDefaultProfileId: string | null;
}

/**
 * Inside the parent, "Default" means nothing and two profiles called
 * "Main Office" are indistinguishable. The source's default profile therefore
 * takes the source client's name on the way across, and any collision with a
 * name already in use on the target is suffixed rather than allowed to stand.
 */
export function planBillingProfileMoves(
  profiles: SourceBillingProfile[],
  sourceClientName: string,
  targetProfileNames: string[] = [],
): BillingProfileMovePlan {
  const used = new Set(targetProfileNames.map((name) => name.trim().toLowerCase()));
  const moves: BillingProfileMove[] = [];
  let movedDefaultProfileId: string | null = null;

  const uniqueName = (desired: string): string => {
    let candidate = desired;
    let suffix = 2;
    while (used.has(candidate.trim().toLowerCase())) {
      candidate = suffix === 2 ? `${desired} (merged)` : `${desired} (merged ${suffix})`;
      suffix += 1;
    }
    used.add(candidate.trim().toLowerCase());
    return candidate;
  };

  // Default first so it gets first claim on the source client's name.
  const ordered = [...profiles].sort((a, b) => Number(b.is_default) - Number(a.is_default));

  for (const profile of ordered) {
    const desired = profile.is_default ? sourceClientName : profile.name;
    const name = uniqueName(desired);
    moves.push({
      billingProfileId: profile.billing_profile_id,
      name,
      renamedFrom: name === profile.name ? null : profile.name,
      wasSourceDefault: profile.is_default,
    });
    if (profile.is_default) {
      movedDefaultProfileId = profile.billing_profile_id;
    }
  }

  return { moves, movedDefaultProfileId };
}

export type ContractDateChoice = 'original' | 'cutover';

export interface MergeableContract {
  clientContractId: string;
  contractId: string;
  contractName: string | null;
  startDate: string;
  endDate: string | null;
  billingProfileId: string | null;
  isActive: boolean;
}

export interface ContractDecision {
  clientContractId: string;
  choice: ContractDateChoice;
  /** Required for 'cutover'; ignored otherwise. */
  cutoverDate?: string | null;
}

export type ContractMovePlan =
  | {
    kind: 'move';
    clientContractId: string;
    /** Non-null when the merge has to stamp an otherwise-NULL profile. */
    stampBillingProfileId: string | null;
  }
  | {
    kind: 'cutover';
    clientContractId: string;
    /** The source assignment is terminated the day before the clone starts. */
    terminateAt: string;
    cutoverDate: string;
    stampBillingProfileId: string | null;
  }
  | {
    kind: 'invalid';
    clientContractId: string;
    reason: string;
  };

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDate(value: string): Date | null {
  const parsed = new Date(`${value.length === 10 ? `${value}T00:00:00.000Z` : value}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The first day of the month after `today`. A cutover mid-period would split a
 * billing period across two clients, so the suggestion is always a boundary the
 * operator can accept without thinking about proration.
 */
export function suggestCutoverDate(today: Date = new Date()): string {
  return toIsoDate(new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth() + 1,
    1,
  )));
}

export function planContractMove(
  contract: MergeableContract,
  decision: ContractDecision | undefined,
  movedDefaultProfileId: string | null,
): ContractMovePlan {
  // An unstated contract moves with its dates: the conservative choice is the
  // one that changes no billing period.
  const choice = decision?.choice ?? 'original';
  // Stamping matters because the attribution chain terminates at *the client's*
  // default profile. A contract that arrives on the parent with a NULL profile
  // would start billing against the parent's default rather than the segment it
  // came from.
  const stampBillingProfileId = contract.billingProfileId ? null : movedDefaultProfileId;

  if (choice === 'original') {
    return { kind: 'move', clientContractId: contract.clientContractId, stampBillingProfileId };
  }

  const cutoverDate = decision?.cutoverDate ?? null;
  if (!cutoverDate) {
    return {
      kind: 'invalid',
      clientContractId: contract.clientContractId,
      reason: 'A cutover needs a date.',
    };
  }
  const cutover = toUtcDate(cutoverDate);
  const start = toUtcDate(contract.startDate);
  if (!cutover || !start) {
    return {
      kind: 'invalid',
      clientContractId: contract.clientContractId,
      reason: 'The cutover date could not be read.',
    };
  }
  if (cutover.getTime() <= start.getTime()) {
    return {
      kind: 'invalid',
      clientContractId: contract.clientContractId,
      reason: 'The cutover date must fall after the contract starts.',
    };
  }
  const end = contract.endDate ? toUtcDate(contract.endDate) : null;
  if (end && cutover.getTime() > end.getTime()) {
    return {
      kind: 'invalid',
      clientContractId: contract.clientContractId,
      reason: 'The cutover date must fall before the contract ends.',
    };
  }

  return {
    kind: 'cutover',
    clientContractId: contract.clientContractId,
    terminateAt: toIsoDate(new Date(cutover.getTime() - DAY_MS)),
    cutoverDate: toIsoDate(cutover),
    stampBillingProfileId,
  };
}

export interface ClientOwnedMoveTable {
  table: string;
  label: string;
  /** NULL billing profiles on these rows are stamped with the moved default. */
  stampsBillingProfile?: boolean;
  /**
   * Set where the table carries a unique index over `client_id` plus these
   * columns, so a source row can land on one the target already owns.
   * `[]` means `client_id` alone is the key (one row per client).
   */
  conflictKeyColumns?: string[];
  /**
   * What happens to a source row whose key is already taken on the target.
   * 'drop' where the target's row supersedes it; 'leave' where the row names
   * something outside Alga that must not be discarded on a guess.
   */
  onCollision?: 'drop' | 'leave';
  /** Present in one edition only; skipped when the table is not installed. */
  editionOptional?: boolean;
}

/**
 * Tables keyed on `client_id` whose rows simply follow the client.
 *
 * Everything with a polymorphic key (documents, asset associations), a
 * name-uniqueness rule needing a rename (visibility groups, tag mappings) or a
 * billing-profile relationship (contracts, invoices) is handled explicitly in
 * the merge engine instead — a table in this list is one where a single UPDATE,
 * possibly after dropping a row the target already has, is the whole story.
 *
 * The list is exhaustive over the schema by policy: every table with a uuid
 * `client_id` either appears here, is handled explicitly, or appears in
 * CLIENT_KEYED_TABLES_LEFT_BEHIND with a reason. A row left on the tombstone is
 * not inert — it keeps a live write path pointed at an archived client, which is
 * how a merged-away sales order later raises an invoice against a client nobody
 * is looking at.
 */
export const CLIENT_OWNED_MOVE_TABLES: ClientOwnedMoveTable[] = [
  // Work items and the people and things they are about.
  { table: 'tickets', label: 'ticket', stampsBillingProfile: true },
  { table: 'projects', label: 'project', stampsBillingProfile: true },
  { table: 'contacts', label: 'contact' },
  { table: 'interactions', label: 'interaction' },
  { table: 'assets', label: 'asset' },
  { table: 'client_locations', label: 'location' },
  { table: 'client_inbound_email_domains', label: 'inbound email domain' },
  { table: 'client_name_aliases', label: 'name alias' },
  { table: 'ticket_materials', label: 'ticket material' },
  { table: 'project_materials', label: 'project material' },
  { table: 'survey_invitations', label: 'survey invitation' },
  { table: 'survey_responses', label: 'survey response' },
  { table: 'service_request_submissions', label: 'service request' },
  { table: 'appointment_requests', label: 'appointment request' },
  { table: 'telephony_call_intents', label: 'call intent' },

  // Pre-sales. An opportunity or quote left behind disappears from the parent's
  // pipeline while still counting against the archived client.
  { table: 'opportunities', label: 'opportunity' },
  { table: 'opportunity_suggestions', label: 'opportunity suggestion' },
  { table: 'quotes', label: 'quote' },

  // Inventory. `sales_orders.client_id` is what salesOrderInvoicingActions
  // resolves the invoice client from, so an order left behind would raise an
  // invoice against the tombstone and its empty system-managed default profile.
  { table: 'sales_orders', label: 'sales order' },
  { table: 'stock_units', label: 'stock unit' },
  { table: 'rma_cases', label: 'RMA case' },

  // Integrations that keep writing after the merge. `rmm_organization_mappings`
  // is the one that matters: device sync creates assets against the mapped
  // client, so leaving it behind re-populates the client the merge just emptied.
  { table: 'rmm_organization_mappings', label: 'RMM organisation mapping' },
  { table: 'rmm_maintenance_windows', label: 'RMM maintenance window' },
  { table: 'inbound_ticket_defaults', label: 'inbound ticket default' },

  // Billing configuration and measurement that hang off the client rather than
  // off a profile. `client_tax_rates` moves because `client_tax_settings`
  // already does, and splitting tax configuration across two clients is worse
  // than either half being wrong.
  { table: 'client_tax_rates', label: 'tax rate' },
  { table: 'client_billing_settings', label: 'billing setting', conflictKeyColumns: [], onCollision: 'drop' },
  { table: 'contract_line_discounts', label: 'contract line discount' },
  // Prepaid hours carry no profile column, so the segment they were bought for
  // cannot be preserved; moving makes them spendable across the parent, which is
  // still better than stranding them on a client that will never file a ticket.
  { table: 'hour_blocks', label: 'hour block' },
  { table: 'prepaid_balance_alerts', label: 'prepaid balance alert' },
  { table: 'usage_tracking', label: 'usage record' },
  { table: 'bucket_usage', label: 'bucket usage record' },
  { table: 'usage_period_totals', label: 'usage period total' },
  { table: 'usage_period_total_requests', label: 'usage period total request' },
  // Export history follows the invoices it describes, which have just moved.
  { table: 'accounting_export_lines', label: 'accounting export line' },

  // Enterprise-only tables. The engine is shared, so these are moved only where
  // the edition installed them.
  { table: 'credentials', label: 'stored credential', editionOptional: true },
  {
    table: 'client_payment_customers',
    label: 'payment customer',
    conflictKeyColumns: ['provider_type'],
    // A payment customer names a live record at Stripe; a collision is a
    // decision about where money is taken, so the row stays put for a human.
    onCollision: 'leave',
    editionOptional: true,
  },
  {
    table: 'opportunity_qbr_triggers',
    label: 'QBR trigger',
    conflictKeyColumns: ['trigger_key'],
    onCollision: 'drop',
    editionOptional: true,
  },
  { table: 'entra_client_tenant_mappings', label: 'Entra tenant mapping', editionOptional: true },
  { table: 'entra_contact_links', label: 'Entra contact link', editionOptional: true },
  {
    table: 'entra_contact_reconciliation_queue',
    label: 'Entra reconciliation entry',
    editionOptional: true,
  },
  { table: 'entra_sync_run_tenants', label: 'Entra sync run client', editionOptional: true },
];

/**
 * Tables carrying a `client_id` that a merge deliberately does not touch, and
 * why. Kept next to the move matrix so a schema drift test can assert the two
 * lists together cover the schema, and so the next person does not have to
 * re-derive that half of these columns are not Alga clients at all.
 */
export const CLIENT_KEYED_TABLES_LEFT_BEHIND: Array<{ table: string; reason: string }> = [
  {
    table: 'tenant_companies',
    reason: "The tenant's own client record. SOURCE_IS_TENANT_DEFAULT refuses the merge instead.",
  },
  {
    table: 'client_plan_bundles',
    reason:
      'Dropped by migration 20251008000003, which asserts it is gone. It reappears only where '
      + 'ensureClientPlanBundlesTable recreates it for legacy billing fixtures, so there is no '
      + 'live row to move.',
  },
  {
    table: 'bucket_usage_unmappable_archive',
    reason:
      'A quarantine table written once by migration 20260814090000 and read by nobody; it is not '
      + 'registered with the tenant facade and has no live write path to re-point.',
  },
  // These columns are OAuth application identifiers (varchar/text, no foreign
  // key to `clients`). Re-stamping one would break the integration outright.
  { table: 'google_calendar_provider_config', reason: 'OAuth client id, not an Alga client.' },
  { table: 'google_email_provider_config', reason: 'OAuth client id, not an Alga client.' },
  { table: 'microsoft_calendar_provider_config', reason: 'OAuth client id, not an Alga client.' },
  { table: 'microsoft_email_provider_config', reason: 'OAuth client id, not an Alga client.' },
  { table: 'microsoft_profiles', reason: 'OAuth client id, not an Alga client.' },
  { table: 'mcp_oauth_clients', reason: 'OAuth client id, not an Alga client.' },
  { table: 'mcp_oauth_grants', reason: 'OAuth client id, not an Alga client.' },
  { table: 'mcp_oauth_auth_codes', reason: 'OAuth client id, not an Alga client.' },
];

/**
 * Client-keyed tables the engine moves with logic of their own rather than
 * through the matrix above — a rename on collision, a polymorphic key, a
 * profile demotion. Listed so the schema-drift check can see the whole picture.
 */
export const CLIENT_KEYED_TABLES_HANDLED_EXPLICITLY = [
  'clients',
  'client_billing_profiles',
  'client_contracts',
  'client_portal_visibility_groups',
] as const;

/**
 * Billing history that hangs off a moved profile. For a row that already names a
 * profile, `billing_profile_id` is never touched — the profile moved, so the
 * history moved with it — and only the redundant `client_id` column is
 * re-stamped, because client-level rollups read it and every consumer assumes
 * `profile.client_id == row.client_id`.
 *
 * `nullableBillingProfile` marks the tables where `billing_profile_id` is
 * nullable by design (20260818050000, 20260818060000: invoices predate profiles
 * entirely, and the ledger treats a profile as a property of the invoice or
 * credit it references rather than an independent fact). Live write paths still
 * produce nulls — a sales-order invoice and its transaction, a transferred
 * credit — and a null matches no moved profile, so those rows are stamped with
 * the moved default *before* the move. Stamping, rather than leaving them null,
 * is what keeps the blast radius: a client-wide credit of the absorbed client
 * must stay inside its own segment instead of becoming a credit the whole parent
 * can spend.
 */
export const PROFILE_HISTORY_TABLES: Array<{
  table: string;
  label: string;
  nullableBillingProfile?: boolean;
}> = [
  { table: 'invoices', label: 'invoice', nullableBillingProfile: true },
  { table: 'client_billing_cycles', label: 'billing cycle' },
  { table: 'payment_methods', label: 'payment method' },
  { table: 'transactions', label: 'transaction', nullableBillingProfile: true },
  { table: 'credit_tracking', label: 'credit', nullableBillingProfile: true },
  { table: 'client_tax_settings', label: 'tax setting' },
];
