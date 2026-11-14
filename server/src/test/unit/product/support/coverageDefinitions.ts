import path from 'node:path';

import { TENANT_TABLE_MANIFEST, getTenantTableManifestEntry, tenantClientOwnership } from '@alga-psa/db';
import { BUNDLE_RULE_RESOURCE_TYPE_CATALOG } from '@alga-psa/authorization/bundles/catalog';

import {
  Program,
  allSourceFiles,
  createAnalyzer,
  findEntries,
  reachesAny,
  relativeToRepository,
  withoutControllerDelegates,
  type Analyzer,
  type Entry,
  type Summary,
} from './sourceAnalysis';

/**
 * The definitions the read-coverage and permission-coverage contracts share. Each is defined once here,
 * and nothing else in the test tree keeps a second copy.
 */

// ---------------------------------------------------------------------------------------------
// Covered resources: "a table whose ownership declaration maps to a kernel resource the plan covers"
// ---------------------------------------------------------------------------------------------

/** The resource types the authorization-completion plan covers (PRD D7). `billing` is in the kernel catalog but not in the plan. */
export const COVERED_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  'ticket', 'project', 'asset', 'document', 'client', 'contact', 'interaction', 'time_entry', 'schedule_entry', 'tag',
]);

/**
 * The table that IS each resource's record. The ownership declaration says how a table reaches a *client*;
 * it does not say which kernel *resource* a table belongs to, so this one-row-per-resource anchor is the
 * only hand-kept part of the map. Every other table gets its resource from its own declaration (below).
 *
 * `document_associations`, `tag_mappings`, `time_entries` and `schedule_entries` declare a `resolver`
 * (polymorphic) ownership and are the tables the resource's reads go through, so they anchor their resource.
 * `documents` declares no ownership at all (a document reaches clients only through its associations),
 * so it is the one anchor allowed without a declaration (`UNDECLARED_ANCHORS`).
 */
export const RESOURCE_ANCHOR_TABLES: Readonly<Record<string, string>> = {
  tickets: 'ticket',
  projects: 'project',
  assets: 'asset',
  documents: 'document',
  document_associations: 'document',
  clients: 'client',
  contacts: 'contact',
  interactions: 'interaction',
  time_entries: 'time_entry',
  schedule_entries: 'schedule_entry',
  tag_mappings: 'tag',
};
const UNDECLARED_ANCHORS = new Set(['documents']);

/**
 * The covered resource a table maps to, or undefined. A table maps to a resource when
 *   1. it is an anchor (`RESOURCE_ANCHOR_TABLES`) and either declares ownership or is a listed undeclared anchor, or
 *   2. its declaration is `parent` / `alternatives` and the first table of a chain maps to a resource.
 * `column`, `resolver` (non-anchor) and `exempt` declarations, and tables with no declaration, map to nothing:
 * a table that merely carries a `client_id` (RMA cases, sales orders) is not one of the plan's resources.
 * Anchors are validated against the kernel catalog (`BUNDLE_RULE_RESOURCE_TYPE_CATALOG`).
 */
export function coveredResourceOf(table: string, seen = new Set<string>()): string | undefined {
  if (seen.has(table)) return;
  seen.add(table);
  const ownership = tenantClientOwnership(table);
  const anchor = RESOURCE_ANCHOR_TABLES[table];
  if (anchor) return ownership || UNDECLARED_ANCHORS.has(table) ? anchor : undefined;
  if (!ownership || ownership.by === 'exempt') return;
  const chains = ownership.by === 'parent' ? [ownership.chain] : ownership.by === 'alternatives' ? ownership.parents : [];
  for (const chain of chains) {
    const resource = chain[0] && coveredResourceOf(chain[0].table, seen);
    if (resource) return resource;
  }
}

export const COVERED_TABLES: ReadonlyMap<string, string> = new Map(
  TENANT_TABLE_MANIFEST
    .map(({ table }) => [table, coveredResourceOf(table)] as const)
    .filter((pair): pair is readonly [string, string] => !!pair[1] && COVERED_RESOURCE_TYPES.has(pair[1]) && BUNDLE_RULE_RESOURCE_TYPE_CATALOG.has(pair[1])),
);

// ---------------------------------------------------------------------------------------------
// Authorization entry points (read coverage)
// ---------------------------------------------------------------------------------------------

/**
 * The functions S9–S18 call to keep a client-scoped read inside the caller's authorized scope, by name.
 * A function satisfies the read-coverage contract when its reachable closure calls one of these.
 * Grouped by the resource slice that introduced them. Adding a name here widens what counts as
 * enforcement: review additions as carefully as additions to the pinned list.
 *
 * Deliberately absent: `applyProjectVisibilityFilter` / `applyAssetVisibilityFilter` (client-portal
 * visibility, not the kernel) and `projectReadableRecord` (field redaction, not a row gate).
 */
/**
 * Client-portal scope helpers. A portal session belongs to one contact, and these derive that contact's own
 * client (and visibility groups) from the session instead of taking a client id from input, so what follows
 * is scoped to the caller's own client. They count as read-coverage entry points. They are NOT permission
 * checks: they decide which client, never whether the caller may do the thing, so a portal action that
 * only calls them is still pinned by the permission-coverage contract.
 * Verified by grep: each name is defined once, in `packages/billing/src/lib/clientPortalAccess.ts`,
 * `packages/client-portal/src/lib/clientAuth.ts` and `packages/authorization/src/portal/visibility.server.ts`.
 */
// LEVERAGE: pattern portal-own-client-helper — five local copies of session-contact -> client derivation (getClientIdFromUser in client-portal/account.ts, getClientPortalUserClientId in billing/invoiceQueries.ts and clients/authHelpers.ts, ...) cannot be recognised by name; one shared helper would let this set name it
export const CLIENT_PORTAL_OWN_CLIENT_SCOPE: ReadonlySet<string> = new Set([
  'getClientIdFromPortalUser', 'getAuthenticatedClientId', 'getClientContactVisibilityContext',
]);

/**
 * Every name below was checked against the tree: each is defined only in the authorization package, the
 * slice's own read-authorization module, or the S18 REST kernel adapter, so a bare-name match cannot hit an
 * unrelated function. The method names `authorizeResource` and `authorizeMutation` are defined only on the
 * kernel (`packages/authorization/src/kernel/{contracts,engine,providers/builtinProvider}.ts`).
 */
export const AUTHORIZATION_ENTRY_POINTS: ReadonlySet<string> = new Set([
  // tickets
  'createTicketReadScope', 'createTicketReadScopeFromRules', 'narrowTicketQueryToReadable', 'narrowTicketsToReadable',
  'readableTicketIds', 'authorizeTicketRecordAccess', 'authorizeTicketRecordAccessConcealed', 'createTicketAuthorizationContext',
  'applyTicketReadAuthorizationSql',
  // projects
  'createProjectReadAuthorizer', 'createProjectReadDecider', 'assertProjectReadAllowed', 'assertProjectReadAllowedById',
  // assets
  'createAssetReadContext', 'createAssetReadContextWithRules', 'isAssetReadAllowed', 'isAssetActionAllowed',
  'isAssetClientActionAllowed', 'isAssetClientReadAllowed', 'authorizeAssetsForAction', 'filterAssetsAllowedForAction',
  'filterReadableAssets', 'projectReadableAssets', 'loadReadableAssetById', 'assertAssetAccess',
  // documents
  'authorizeAndRedactDocuments', 'authorizeAndRedactDocumentsForAction', 'resolveDocumentReadScope',
  // clients, contacts, interactions, time entries, schedule entries
  'createClientScopeContext', 'resolveClientReadScope', 'resolveInteractionReadScope', 'resolveTimeEntryReadScope',
  'createScheduleEntryReadScope', 'unreadableScheduleEntryIds', 'isScheduleEntryReadable', 'canReadScheduleEntry',
  'maskEntriesOutsideReadScope',
  // kernel decision and read-SQL primitives the slices call directly (`kernel.authorizeResource(...)` etc.)
  'authorizeResource', 'authorizeMutation', 'compileResourceReadAuthorizationSql',
  'compileTenantScopedResourceReadAuthorizationSql', 'compileBundleReadNarrowingSql', 'compileBuiltinResolverReadNarrowingSql',
  // generic kernel read scope (tags, lists, pagination)
  'resolveNarrowedReadScope', 'applyReadScope', 'resolveReadableScope', 'projectNarrowedPage', 'buildAuthorizationAwarePage',
  'resolveRowClients',
  // reports
  'resolveReportClientScope', 'clientScopedTenantDb', 'planQueryNarrowing',
  // search
  'resolveClientAccess',
  // client portal: the caller's own client, derived from the session (see CLIENT_PORTAL_OWN_CLIENT_SCOPE)
  ...CLIENT_PORTAL_OWN_CLIENT_SCOPE,
  // REST and MCP (S18)
  'authorizeApiResourceAction', 'authorizeApiResource', 'authorizeApiResourceRead',
]);

// ---------------------------------------------------------------------------------------------
// Permission checks (permission coverage)
// ---------------------------------------------------------------------------------------------

/**
 * A call is a permission check when its name is a `has|check|require|assert|ensure|can` verb over
 * "Permission" (`hasPermission`, `checkPermission`, `requirePermission`, `assertMspPermission`,
 * `hasApiContextPermission`, ...), when it is one of the named gates below, or when it is an
 * authorization entry point (a kernel decision includes the RBAC decision).
 *
 * `withAuth` is NOT a permission check: it authenticates the caller and sets the tenant, and decides nothing
 * about what the caller may do. `isActionPermissionError`, `*PermissionError` builders and `updatePermissions`
 * are not checks either, which the verb anchor keeps out.
 */
export const PERMISSION_CHECK_NAME = /^(?:has|check|require|assert|ensure|can)[A-Za-z]*Permission[A-Za-z]*$/;

/** Gates that check access without "Permission" in the name. */
export const NAMED_PERMISSION_GATES: ReadonlySet<string> = new Set([
  'assertTicketReadAllowed', 'assertQuoteReadAllowed', 'assertQuoteReadAllowedForMutation', 'assertRecordCreateAllowed',
  'assertProjectCreateAllowed', 'assertManualProductAccess', 'assertProductApiAccess', 'assertInternalReadAccess',
  'assertPsaOnlyTenantAccess', 'assertAccess', 'assertTierAccess', 'assertCanActOnBehalf', 'assertCanApproveSubject',
  'withPermission', 'withAuthorizedAssetGroup',
]);

export function isPermissionCheck(name: string): boolean {
  return PERMISSION_CHECK_NAME.test(name) || NAMED_PERMISSION_GATES.has(name) || (AUTHORIZATION_ENTRY_POINTS.has(name) && !CLIENT_PORTAL_OWN_CLIENT_SCOPE.has(name));
}

// ---------------------------------------------------------------------------------------------
// Commercial tables
// ---------------------------------------------------------------------------------------------

/**
 * Commercial tables: pricing and contract data. A server action that touches tenant data without a
 * permission check must never read one of these. Criterion: the table holds what a service costs or what
 * a client has agreed to pay (the service catalog and its prices and rate tiers, contracts, contract
 * lines and their pricing configuration, contract templates, discounts, invoices and their charges,
 * quotes, project billing schedules and rate overrides).
 *
 * The tenant table manifest carries no tag for this, so it is one explicit set. A manifest rename that
 * leaves a name here dangling fails `commercial tables exist in the manifest`.
 * Not commercial for this purpose: payment-provider, tax and usage-metering tables.
 */
export const COMMERCIAL_TABLES: ReadonlySet<string> = new Set([
  // service catalog and prices
  'service_catalog', 'service_catalog_mode_defaults', 'service_prices', 'service_rate_tiers',
  // contracts and contract lines
  'contracts', 'client_contracts', 'contract_pricing_schedules', 'contract_discount_assignments', 'contract_recurring_unit_adjustments',
  'contract_lines', 'contract_line_services', 'contract_line_service_defaults', 'contract_line_service_configuration',
  'contract_line_service_fixed_config', 'contract_line_service_hourly_config', 'contract_line_service_hourly_configs',
  'contract_line_service_usage_config', 'contract_line_service_bucket_config', 'contract_line_service_rate_tiers',
  'contract_line_buckets', 'contract_line_bucket_services', 'contract_line_prepaid_blocks', 'contract_line_block_issuances',
  'contract_line_discounts', 'contract_line_unit_pricing_revisions', 'contract_line_unit_pricing_revision_history',
  'contract_line_presets', 'contract_line_preset_services', 'contract_line_preset_fixed_config', 'contract_line_preset_prepaid_blocks',
  // contract templates
  'contract_templates', 'contract_template_lines', 'contract_template_line_defaults', 'contract_template_line_services',
  'contract_template_line_terms', 'contract_template_line_buckets', 'contract_template_line_bucket_services',
  'contract_template_line_fixed_config', 'contract_template_line_prepaid_blocks', 'contract_template_line_service_configuration',
  'contract_template_line_service_fixed_config', 'contract_template_line_service_hourly_config',
  'contract_template_line_service_usage_config', 'contract_template_line_service_bucket_config',
  'contract_template_services', 'contract_template_prices', 'contract_template_price_sets', 'contract_template_pricing_schedules',
  'contract_template_discount_copies',
  'discounts',
  // invoices
  'invoices', 'invoice_charges', 'invoice_charge_details', 'invoice_charge_fixed_details', 'invoice_items',
  // quotes
  'quotes', 'quote_items',
  // project billing
  'project_billing_configs', 'project_billing_schedule_entries', 'project_billing_cap_usage', 'project_phase_rate_overrides',
]);

export const isTenantTable = (name: string) => !!getTenantTableManifestEntry(name);

// ---------------------------------------------------------------------------------------------
// Analysis over a program
// ---------------------------------------------------------------------------------------------

export interface AnalyzedEntry { entry: Entry; summary: Summary }

/** Authentication and authorization infrastructure: its own session/role table reads are not what the caller does with tenant data. */
export const OPAQUE_PATH = /(^|\/)(packages\/(auth|authorization|db)|shared\/(db|core)|server\/src\/lib\/(auth|db)|server\/src\/lib\/api\/middleware)\//;

/**
 * Recipient-authorization modules: they decide what a notification's RECIPIENT may be told and return
 * only that decision (a recipient classification, an audience, an admission), never a covered row. Their
 * own reads (the S33 boundary reads `tickets.client_id`/`board_id`, `comments`, `comment_threads` to
 * place a seat technician) are therefore not what the caller does with tenant data, exactly as for
 * `OPAQUE_PATH`. Opaque, NOT an authorization entry point: reaching one gates nothing for the caller,
 * so an action's own covered reads stay visible and still need a real entry point.
 * Each file listed here must export no function that returns a covered table's rows.
 */
export const OPAQUE_FILES: ReadonlySet<string> = new Set([
  'shared/lib/notificationAudience.ts',
]);

export const isOpaqueFile = (file: string): boolean => {
  const normalized = file.split(path.sep).join('/');
  return OPAQUE_PATH.test(normalized) || [...OPAQUE_FILES].some((opaque) => normalized === opaque || normalized.endsWith(`/${opaque}`));
};

export interface Analysis { analyzed: AnalyzedEntry[]; analyzer: Analyzer }

/** Entries sorted by file, then export, so every list and message is in one stable order. */
export function analyzeFiles(program: Program, files: string[]): Analysis {
  const analyzer = createAnalyzer({
    program,
    isTable: isTenantTable,
    opaqueFile: isOpaqueFile,
  });
  const entries: Entry[] = [];
  for (const file of files) entries.push(...findEntries(program.source(file), relativeToRepository(file)));
  const analyzed = withoutControllerDelegates(entries, analyzer)
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.export < b.export ? -1 : a.export > b.export ? 1 : 0))
    .map((entry) => ({ entry, summary: analyzer.summarize(entry.unit) }));
  return { analyzed, analyzer };
}

let repositoryAnalysis: Analysis | undefined;
/** One pass over the real tree, shared by every contract that runs in the same module graph. */
export function analyzeRepository(): Analysis {
  return (repositoryAnalysis ??= analyzeFiles(new Program(), allSourceFiles()));
}

export const entryId = (entry: Entry) => `${entry.file}#${entry.export}`;

/** Read coverage: reads a covered table and reaches no authorization entry point. */
export function readCoverageViolations(analyzed: AnalyzedEntry[]): AnalyzedEntry[] {
  return analyzed.filter(({ summary }) => [...summary.reads].some((t) => COVERED_TABLES.has(t)) && !reachesAny(summary, AUTHORIZATION_ENTRY_POINTS));
}

/** Permission coverage: touches a tenant table and reaches no permission check. */
export function permissionCoverageViolations(analyzed: AnalyzedEntry[]): AnalyzedEntry[] {
  return analyzed.filter(({ entry, summary }) => entry.kind === 'server-action' && summary.touches.size > 0 && !reachesAny(summary, new Set(), isPermissionCheck));
}

// ---------------------------------------------------------------------------------------------
// Pinned lists
// ---------------------------------------------------------------------------------------------

export interface PinnedEntry { file: string; export: string; reason: string }

export interface PinnedProblems {
  /** Violations nobody pinned: the list cannot grow. */
  unpinned: string[];
  /** Pinned entries that are no longer violations: delete them. */
  stale: string[];
  emptyReasons: string[];
  duplicates: string[];
}

const pinnedId = (entry: PinnedEntry) => `${entry.file}#${entry.export}`;

export function checkPinned(violations: AnalyzedEntry[], pinned: readonly PinnedEntry[]): PinnedProblems {
  const violating = new Set(violations.map(({ entry }) => entryId(entry)));
  const listed = pinned.map(pinnedId);
  return {
    unpinned: [...violating].filter((id) => !listed.includes(id)).sort(),
    stale: listed.filter((id) => !violating.has(id)).sort(),
    emptyReasons: pinned.filter((p) => !p.reason.trim()).map(pinnedId),
    duplicates: listed.filter((id, index) => listed.indexOf(id) !== index),
  };
}

export interface CommercialProblems {
  /** Pinned entries that read a commercial table and are not in the known list: a new unchecked commercial read. */
  unknown: Record<string, string[]>;
  /** Known entries that are no longer pinned, or no longer read a commercial table: delete them. */
  stale: string[];
  emptyReasons: string[];
  duplicates: string[];
}

/**
 * Rule (d): no pinned permission-coverage entry may read a commercial table, except those named in the
 * shrink-only `known` list. Every known entry must itself still be pinned and still read a commercial table.
 */
export function commercialReadProblems(analyzed: AnalyzedEntry[], pinned: readonly PinnedEntry[], known: readonly PinnedEntry[]): CommercialProblems {
  const byId = new Map(analyzed.map((a) => [entryId(a.entry), a]));
  const commercialReads = (id: string) => {
    const found = byId.get(id);
    return found ? [...found.summary.reads].filter((t) => COMMERCIAL_TABLES.has(t)).sort() : [];
  };
  const knownIds = known.map(pinnedId);
  const pinnedIds = new Set(pinned.map(pinnedId));
  const unknown: Record<string, string[]> = {};
  for (const id of [...pinnedIds].sort()) {
    const hits = commercialReads(id);
    if (hits.length && !knownIds.includes(id)) unknown[id] = hits;
  }
  return {
    unknown,
    stale: knownIds.filter((id) => !pinnedIds.has(id) || commercialReads(id).length === 0).sort(),
    emptyReasons: known.filter((k) => !k.reason.trim()).map(pinnedId),
    duplicates: knownIds.filter((id, index) => knownIds.indexOf(id) !== index),
  };
}

export function describeCommercialProblems(problems: CommercialProblems): string[] {
  const lines: string[] = [];
  const unknown = Object.entries(problems.unknown);
  if (unknown.length) lines.push(`${unknown.length} pinned entr${unknown.length === 1 ? 'y reads' : 'ies read'} a commercial table and ${unknown.length === 1 ? 'is' : 'are'} not in KNOWN_COMMERCIAL_READS. An unchecked action must not read pricing or contract data; add the permission check instead of pinning:`, ...unknown.map(([id, tables]) => `  ! ${id} reads ${tables.join(', ')}`));
  if (problems.stale.length) lines.push(`KNOWN_COMMERCIAL_READS: ${problems.stale.length} entr${problems.stale.length === 1 ? 'y is' : 'ies are'} no longer an unchecked commercial read (fixed, or no longer pinned). Delete ${problems.stale.length === 1 ? 'it' : 'them'} from the list:`, ...problems.stale.map((id) => `  - ${id}`));
  if (problems.emptyReasons.length) lines.push('KNOWN_COMMERCIAL_READS: entries need a non-empty reason:', ...problems.emptyReasons.map((id) => `  ? ${id}`));
  if (problems.duplicates.length) lines.push('KNOWN_COMMERCIAL_READS: duplicate entries:', ...problems.duplicates.map((id) => `  = ${id}`));
  return lines;
}

export function describeProblems(label: string, problems: PinnedProblems, fixHint: string): string[] {
  const lines: string[] = [];
  if (problems.unpinned.length) lines.push(`${label}: ${problems.unpinned.length} violation(s) not in the pinned list. The list cannot grow; ${fixHint}:`, ...problems.unpinned.map((id) => `  + ${id}`));
  if (problems.stale.length) lines.push(`${label}: ${problems.stale.length} pinned entr${problems.stale.length === 1 ? 'y is' : 'ies are'} no longer a violation. Delete ${problems.stale.length === 1 ? 'it' : 'them'} from the list:`, ...problems.stale.map((id) => `  - ${id}`));
  if (problems.emptyReasons.length) lines.push(`${label}: pinned entries need a non-empty reason:`, ...problems.emptyReasons.map((id) => `  ? ${id}`));
  if (problems.duplicates.length) lines.push(`${label}: duplicate pinned entries:`, ...problems.duplicates.map((id) => `  = ${id}`));
  return lines;
}

export { Program };
