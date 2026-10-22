import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  ContractBillingTrace,
  ContractBillingTraceInvoiceReason,
  ContractBillingTraceField,
  ContractBillingTraceProfile,
  ContractBillingTraceProfileSource,
  ContractBillingTraceTerms,
  ContractBillingTraceWarning,
  ISO8601String,
} from '@alga-psa/types';
import { resolveChargeProfile } from './billingProfileResolution';
import {
  listSeparatelyBillingProfiles,
  resolveEffectiveBillingIdentity,
  type EffectiveBillingIdentity,
} from './billingProfileSettings';
import { ensureClientDefaultBillingProfile } from './billingProfiles';
import { resolveBucketForLine } from './bucketUsageService';
import {
  buildInvoiceProfileScope,
  describeInvoiceProfileLanding,
  type InvoiceProfileScope,
} from './invoiceProfileScope';
import { dueDateForPaymentTerms } from './paymentDueDate';
import { DEFAULT_PAYMENT_TERMS, normalizePaymentTerms, paymentTermDays } from './paymentPreferences';

/**
 * Contract billing traceability: which billing profile(s) bill a contract, the
 * payment terms they carry, and where each value comes from.
 *
 * Nothing here is stored. The contract keeps only its pointers
 * (`contract_lines.billing_profile_id`, `client_contracts.billing_profile_id`);
 * the trace is resolved at read time through the engine's own functions —
 * `resolveChargeProfile` for which profile, `resolveEffectiveBillingIdentity`
 * for which value, `paymentTermDays` / `dueDateForPaymentTerms` for arithmetic —
 * so what an operator reads cannot disagree with the invoice that follows.
 *
 * Attribution is not invoicing. A charge attributed to profile P lands on P's
 * invoice only when the tenant flag is on and P bills separately; otherwise it
 * lands on the client default's invoice and carries the default's terms. The
 * trace therefore resolves attribution (`resolveChargeProfile`), then the invoice
 * profile (`resolveInvoiceProfileForAttribution`, the function the engine's
 * selection resolver calls), then terms and due date from the invoice profile.
 * The flag is evaluated by the caller and passed in as `perProfileInvoicing`.
 * This module must not grow a second `line ?? contract ?? workItem ?? default`
 * chain: the work-item step is just one more input to `resolveChargeProfile`.
 */

export interface ContractBillingTraceProfileRow {
  billingProfileId: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
}

export interface ContractBillingTraceLineInput {
  contractLineId: string;
  contractLineName?: string | null;
  billingProfileId: string | null;
  billingFrequency?: string | null;
  /**
   * Number of `contract_line_services` rows on the line. Absent counts as none.
   * The engine's time loader prices time on any line that has services.
   */
  serviceCount?: number;
  /**
   * How many of those services draw from a bucket pool on the line (or the line
   * carries a prepaid-block config, making all of them so). Absent counts as none.
   */
  bucketServiceCount?: number;
}

export interface BuildContractBillingTraceInput {
  asOf: ISO8601String;
  currencyCode: string;
  /** `contracts.billing_frequency`; used for cadence only when the contract has no lines. */
  contractBillingFrequency?: string | null;
  clientDefaultBillingProfileId: string;
  /** Tenant flag `billing-profiles-separate-invoicing`, evaluated by the caller. */
  perProfileInvoicing: boolean;
  /** `listSeparatelyBillingProfiles` ids for the client (active, `bills_separately`). */
  separatelyBillingProfileIds: string[];
  /** `client_contracts.billing_profile_id` of the binding being traced. */
  assignmentBillingProfileId: string | null;
  lines: ContractBillingTraceLineInput[];
  /** Every profile of the owning client, inactive ones included. */
  profiles: ContractBillingTraceProfileRow[];
  /** `resolveEffectiveBillingIdentity` output for every profile that bills, and for each work-item candidate. */
  identities: Record<string, EffectiveBillingIdentity>;
  /**
   * Distinct non-null `billing_profile_id` values carried by the client's tickets
   * and projects (step 4 of the chain). Each must be a row of `profiles` or of
   * `workItemProfileRows`.
   */
  workItemProfileIds?: string[];
  /**
   * Rows for work-item profiles that another client of the tenant owns. Nothing
   * on the write path or in the engine ties a ticket's or project's profile to
   * its client (the FK is tenant-scoped), and the engine bills whatever id it
   * reads, so such a profile is a real step-4 outcome.
   */
  workItemProfileRows?: ContractBillingTraceProfileRow[];
}

// Most specific step first; a profile reached by several steps reports the most specific.
const SOURCE_SPECIFICITY: ContractBillingTraceProfileSource[] = ['contract_line', 'contract', 'work_item', 'client_default'];

const ENGLISH_LABELS: Record<ContractBillingTraceField['key'], string> = {
  bill_to: 'Bill to',
  payment_method: 'Payment method',
  tax_exemption: 'Tax exemption',
  tax_region: 'Tax region',
  delivery: 'Invoice delivery',
  template: 'Invoice template',
  po_number: 'PO number',
  currency: 'Currency',
  cadence: 'Billing cadence',
  profile_billing_cycle: 'Profile billing cycle',
};

type LandingInput = Pick<
  BuildContractBillingTraceInput,
  'clientDefaultBillingProfileId' | 'perProfileInvoicing' | 'separatelyBillingProfileIds'
>;

function defaultInvoiceScope(input: LandingInput): InvoiceProfileScope {
  return buildInvoiceProfileScope({
    billingProfileId: input.clientDefaultBillingProfileId,
    defaultProfileId: input.clientDefaultBillingProfileId,
    perProfileInvoicing: input.perProfileInvoicing,
    separatelyBillingProfileIds: input.separatelyBillingProfileIds,
  });
}

/** On which profile's invoice does a charge attributed to `attributedProfileId` land, and why. */
export function resolveTraceInvoiceLanding(
  input: LandingInput,
  attributedProfileId: string,
): { invoiceProfileId: string; reason: ContractBillingTraceInvoiceReason } {
  return describeInvoiceProfileLanding(attributedProfileId, defaultInvoiceScope(input), input.perProfileInvoicing);
}

/** Which profile bills one line (or the contract as a whole when `line` is null). */
function resolveForLine(
  input: Pick<BuildContractBillingTraceInput, 'assignmentBillingProfileId' | 'clientDefaultBillingProfileId'>,
  lineBillingProfileId: string | null,
  workItemBillingProfileId: string | null = null,
) {
  return resolveChargeProfile({
    contractLineBillingProfileId: lineBillingProfileId,
    contractBillingProfileId: input.assignmentBillingProfileId,
    workItemBillingProfileId,
    clientDefaultBillingProfileId: input.clientDefaultBillingProfileId,
  });
}

type StepFourInput = Pick<
  BuildContractBillingTraceInput,
  'assignmentBillingProfileId' | 'clientDefaultBillingProfileId' | 'lines'
>;

/**
 * Lines whose charges can reach step 4 (the work item's profile). Engine facts
 * (`billingEngine.ts` `loadTimeBasedObligation`, run for every live client contract
 * line): time entries are the charges that carry `work_item_billing_profile_id`.
 * The loader takes a line's entries by explicit `time_entries.contract_line_id`, or
 * unassigned entries whose service belongs to only that line, and it filters on
 * the line's services (`contract_line_services`), never on `contract_line_type`.
 * So any line with services can price time, whatever its type. Fixed-price,
 * usage, bucket and product/license charges carry no work-item profile; project
 * milestone/deposit charges do (the project's profile) but have no contract line,
 * so they are outside this trace. A line only reaches step 4 when steps 2 and 3 are
 * both empty, i.e. it lands on the client default.
 *
 * Bucket and prepaid-block coverage does NOT follow the work item. Engine facts:
 * bucket overage charges and "Prepaid hour block" charges are attributed from the
 * line's assignments only (`loadBucketObligation`, the hour-block path and prepaid
 * block issuance call `loadChargeProfileAssignments` / `resolveChargeProfile` with
 * no work-item profile), and the time loader skips entries explicitly assigned to a
 * bucket-covered service. So a line whose services are all bucket-covered is not
 * reachable; a mixed line stays reachable for its non-bucket services. Whether a work item has
 * anything to point at is decided by the caller (several profiles, or a work item
 * carrying a profile owned by another client).
 */
export function resolveStepFourLines(input: StepFourInput): ContractBillingTraceLineInput[] {
  return input.lines.filter(
    (line) =>
      (line.serviceCount ?? 0) - (line.bucketServiceCount ?? 0) > 0 &&
      resolveForLine(input, line.billingProfileId).source === 'client_default',
  );
}

/**
 * One `resolveChargeProfile` call per line. A contract with no lines still
 * bills the profile its assignment (or the client default) resolves to.
 */
export function resolveTracedLines(
  input: Pick<BuildContractBillingTraceInput, 'assignmentBillingProfileId' | 'clientDefaultBillingProfileId' | 'lines'>,
) {
  return input.lines.length > 0
    ? input.lines.map((line) => ({ line: line as ContractBillingTraceLineInput | null, resolved: resolveForLine(input, line.billingProfileId) }))
    : [{ line: null as ContractBillingTraceLineInput | null, resolved: resolveForLine(input, null) }];
}

function requireIdentity(input: Pick<BuildContractBillingTraceInput, 'identities'>, billingProfileId: string) {
  const identity = input.identities[billingProfileId];
  if (!identity) {
    throw new Error(`Missing billing identity for profile ${billingProfileId}.`);
  }
  return identity;
}

function buildTerms(identity: EffectiveBillingIdentity, asOf: ISO8601String): ContractBillingTraceTerms {
  // Stored terms the engine does not recognise (legacy free text) bill as Net 30,
  // so they are attributed to the default rather than to the profile or client.
  const known = normalizePaymentTerms(identity.paymentTerms);
  return {
    value: known ?? DEFAULT_PAYMENT_TERMS,
    source: known === null ? 'default' : identity.overriddenFields.includes('payment_terms') ? 'profile' : 'client',
    days: paymentTermDays(identity.paymentTerms),
    dueDateExample: {
      invoiceDate: asOf,
      dueDate: dueDateForPaymentTerms(asOf, identity.paymentTerms),
    },
  };
}

function buildFields(
  identity: EffectiveBillingIdentity,
  currencyCode: string,
  cadence: string | null,
): ContractBillingTraceField[] {
  const origin = (field: string) => (identity.overriddenFields.includes(field) ? 'profile' : 'client') as 'profile' | 'client';
  const field = (
    key: ContractBillingTraceField['key'],
    value: string | null,
    source: ContractBillingTraceField['source'],
    applied?: boolean,
  ): ContractBillingTraceField => ({
    key,
    label: ENGLISH_LABELS[key],
    value,
    source,
    ...(applied === undefined ? {} : { applied }),
  });

  return [
    field('bill_to', identity.billToName, origin('bill_to_name')),
    field('payment_method', identity.preferredPaymentMethod, origin('preferred_payment_method')),
    field('tax_exemption', identity.isTaxExempt ? 'exempt' : 'taxable', origin('is_tax_exempt')),
    // Tax region is deliberately not profile-scoped: service region, then the
    // contract-line location, then the client default. It is a chain, not a value.
    field('tax_region', null, 'client'),
    field('delivery', identity.invoiceDeliveryMethod, origin('invoice_delivery_method')),
    field('template', identity.invoiceTemplateId, origin('invoice_template_id')),
    field('po_number', identity.poNumber, 'profile'),
    field('currency', currencyCode, 'contract'),
    field('cadence', cadence, 'contract'),
    // Invoice generation never reads the profile billing cycle.
    field('profile_billing_cycle', identity.billingCycle, origin('billing_cycle'), false),
  ];
}

function buildTraceProfile(
  input: BuildContractBillingTraceInput,
  rowFor: (billingProfileId: string) => ContractBillingTraceProfileRow,
  attributedId: string,
  extras: { source: ContractBillingTraceProfileSource; lineCount: number; cadence: string | null },
): ContractBillingTraceProfile {
  const row = rowFor(attributedId);
  const landing = resolveTraceInvoiceLanding(input, attributedId);
  const invoiceRow = rowFor(landing.invoiceProfileId);
  // Terms, due date and identity fields all come from the profile whose invoice
  // carries the charge; the attributed profile is only the reporting dimension.
  const identity = requireIdentity(input, landing.invoiceProfileId);
  return {
    billingProfileId: attributedId,
    name: row.name,
    source: extras.source,
    lineCount: extras.lineCount,
    isActive: row.isActive,
    isDefault: row.isDefault,
    invoiceProfile: {
      billingProfileId: landing.invoiceProfileId,
      name: invoiceRow.name,
      isActive: invoiceRow.isActive,
      isDefault: invoiceRow.isDefault,
    },
    invoiceReason: landing.reason,
    terms: buildTerms(identity, input.asOf),
    fields: buildFields(identity, input.currencyCode, extras.cadence),
  };
}

export function buildContractBillingTrace(input: BuildContractBillingTraceInput): ContractBillingTrace {
  const profileById = new Map(input.profiles.map((profile) => [profile.billingProfileId, profile]));
  const requireProfile = (billingProfileId: string): ContractBillingTraceProfileRow => {
    const row = profileById.get(billingProfileId);
    if (!row) {
      throw new Error('That billing profile belongs to a different client.');
    }
    return row;
  };

  const resolutions = resolveTracedLines(input);

  const grouped = new Map<string, { lineCount: number; source: ContractBillingTraceProfileSource; frequencies: Set<string> }>();
  for (const { line, resolved } of resolutions) {
    requireProfile(resolved.billingProfileId);
    const source = resolved.source as ContractBillingTraceProfileSource;
    const entry = grouped.get(resolved.billingProfileId) ?? { lineCount: 0, source, frequencies: new Set<string>() };
    if (line) {
      entry.lineCount += 1;
      if (line.billingFrequency) entry.frequencies.add(line.billingFrequency);
    }
    if (SOURCE_SPECIFICITY.indexOf(source) < SOURCE_SPECIFICITY.indexOf(entry.source)) {
      entry.source = source;
    }
    grouped.set(resolved.billingProfileId, entry);
  }

  const profiles: ContractBillingTraceProfile[] = [...grouped.entries()]
    .map(([billingProfileId, entry]) =>
      buildTraceProfile(input, requireProfile, billingProfileId, {
        source: entry.source,
        lineCount: entry.lineCount,
        cadence: entry.frequencies.size > 0
          ? [...entry.frequencies].join(',')
          : input.contractBillingFrequency ?? null,
      }),
    )
    .sort(
      (a, b) =>
        b.lineCount - a.lineCount ||
        Number(b.isDefault) - Number(a.isDefault) ||
        a.name.localeCompare(b.name),
    );

  const warnings: ContractBillingTraceWarning[] = [];
  // An inactive profile still bills: say so rather than substituting the default.
  for (const profile of profiles) {
    if (!profile.isActive) {
      warnings.push({ code: 'inactive_profile', billingProfileId: profile.billingProfileId, profileName: profile.name });
    }
  }
  if (profiles.length > 1) {
    const invoiceProfileIds = new Set(profiles.map((profile) => profile.invoiceProfile.billingProfileId));
    warnings.push({
      code: 'mixed_profiles',
      profileCount: profiles.length,
      invoiceProfileCount: invoiceProfileIds.size,
      invoiceProfileName: invoiceProfileIds.size === 1 ? profiles[0].invoiceProfile.name : null,
    });
  }
  // A line override matters only where it moves the line off the profile the
  // contract would otherwise bill.
  for (const { line, resolved } of resolutions) {
    if (!line || resolved.source !== 'contract_line') continue;
    const withoutOverride = resolveForLine(input, null);
    if (withoutOverride.billingProfileId !== resolved.billingProfileId) {
      warnings.push({
        code: 'line_override',
        contractLineId: line.contractLineId,
        contractLineName: line.contractLineName ?? null,
        billingProfileId: resolved.billingProfileId,
        profileName: requireProfile(resolved.billingProfileId).name,
      });
    }
  }

  // Step 4. Lines that fell through to the client default may instead follow the
  // work item's profile. The default entry above stays: it is the fallback.
  const stepFourLines = resolveStepFourLines(input);
  const workItemProfiles: ContractBillingTraceProfile[] = [];
  const workItemRowById = new Map([...input.profiles, ...(input.workItemProfileRows ?? [])].map((row) => [row.billingProfileId, row]));
  const requireWorkItemProfile = (billingProfileId: string): ContractBillingTraceProfileRow => {
    const row = workItemRowById.get(billingProfileId);
    if (!row) {
      throw new Error('That billing profile belongs to a different client.');
    }
    return row;
  };
  const candidateIds = input.workItemProfileIds ?? [];
  // A one-profile client has nothing for a work item to point at unless a work
  // item carries another client's profile.
  const stepFourReachable = stepFourLines.length > 0 && (input.profiles.length > 1 || candidateIds.length > 0);
  if (stepFourReachable) {
    const candidates = new Map<string, number>();
    for (const line of stepFourLines) {
      for (const candidateId of candidateIds) {
        requireWorkItemProfile(candidateId);
        const resolved = resolveForLine(input, line.billingProfileId, candidateId);
        // Landing where the line lands without a work item is not an alternative outcome.
        if (resolved.source !== 'work_item') continue;
        if (resolved.billingProfileId === resolveForLine(input, line.billingProfileId).billingProfileId) continue;
        candidates.set(resolved.billingProfileId, (candidates.get(resolved.billingProfileId) ?? 0) + 1);
      }
    }
    for (const [billingProfileId, lineCount] of candidates) {
      workItemProfiles.push(
        buildTraceProfile(input, requireWorkItemProfile, billingProfileId, {
          source: 'work_item',
          lineCount,
          cadence: input.contractBillingFrequency ?? null,
        }),
      );
    }
    workItemProfiles.sort((a, b) => a.name.localeCompare(b.name));
    // Raised even with no candidates today: a ticket or project can be given a
    // profile at any time, and the client default must not read as final.
    warnings.push({
      code: 'work_item_override_possible',
      contractLineIds: stepFourLines.map((line) => line.contractLineId),
      candidateProfiles: workItemProfiles.map((profile) => ({
        billingProfileId: profile.billingProfileId,
        name: profile.name,
      })),
      bucketTimeExcluded: input.lines.some((line) => (line.bucketServiceCount ?? 0) > 0),
    });
  }

  const primary = profiles[0];
  return {
    asOf: input.asOf,
    profiles,
    terms: primary.terms,
    fields: primary.fields,
    warnings,
    ...(workItemProfiles.length > 0 ? { workItemProfiles } : {}),
  };
}

export interface LoadContractBillingTraceOptions {
  contractId: string;
  /** Trace one specific assignment (a merged-in client) instead of the owning client's. */
  clientContractId?: string | null;
  asOf?: ISO8601String;
  /**
   * Tenant flag `billing-profiles-separate-invoicing`. Evaluated by the caller
   * (`perProfileInvoicingEnabled` in packages/billing): shared code must not
   * depend on the feature-flag client.
   */
  perProfileInvoicing: boolean;
}

/**
 * Tenant-scoped loader. Returns null for template contracts and for contracts
 * with no client to bill. Throws when an assignment or line points at a
 * profile that the assignment's client does not own (same guard as
 * `createClientContract`), so a cross-client pointer can never leak a name.
 */
export async function loadContractBillingTrace(
  knex: Knex | Knex.Transaction,
  tenant: string,
  options: LoadContractBillingTraceOptions,
): Promise<ContractBillingTrace | null> {
  const db = tenantDb(knex, tenant);

  const contract = await db
    .table('contracts')
    .where({ contract_id: options.contractId })
    .first('contract_id', 'owner_client_id', 'currency_code', 'billing_frequency');
  if (!contract) {
    return null; // template contracts live in contract_templates
  }

  const assignmentQuery = db.table('client_contracts').where({ contract_id: options.contractId });
  if (options.clientContractId) {
    assignmentQuery.where({ client_contract_id: options.clientContractId });
  }
  const assignments = (await assignmentQuery
    .orderBy('is_active', 'desc')
    .orderBy('start_date', 'desc')
    .select('client_contract_id', 'client_id', 'billing_profile_id')) as Array<{
    client_contract_id: string;
    client_id: string;
    billing_profile_id: string | null;
  }>;
  if (options.clientContractId && assignments.length === 0) {
    throw new Error('That assignment does not belong to this contract.');
  }
  const assignment =
    options.clientContractId || !contract.owner_client_id
      ? assignments[0] ?? null
      : assignments.find((row) => row.client_id === contract.owner_client_id) ?? assignments[0] ?? null;
  const clientId = assignment?.client_id ?? contract.owner_client_id ?? null;
  if (!clientId) {
    return null;
  }

  const clientDefaultBillingProfileId = await ensureClientDefaultBillingProfile(knex, tenant, clientId);

  const [lineRows, profileRows] = await Promise.all([
    db
      .table('contract_lines')
      .where({ contract_id: options.contractId })
      .orderBy('display_order', 'asc')
      .select('contract_line_id', 'contract_line_name', 'billing_profile_id', 'billing_frequency'),
    db
      .table('client_billing_profiles')
      .where({ client_id: clientId })
      .select('billing_profile_id', 'name', 'is_active', 'is_default'),
  ]);

  // LEVERAGE: pattern client-owns-profile-guard — same check as clientContracts.ts createClientContract; a shared assertion would serve both.
  // Ownership guard: every pointer must name a profile of the assignment's client.
  const ownedIds = new Set((profileRows as Array<{ billing_profile_id: string }>).map((row) => row.billing_profile_id));
  const pointers = [
    assignment?.billing_profile_id ?? null,
    ...(lineRows as Array<{ billing_profile_id: string | null }>).map((row) => row.billing_profile_id),
  ].filter((id): id is string => Boolean(id));
  if (pointers.some((id) => !ownedIds.has(id))) {
    throw new Error('That billing profile belongs to a different client.');
  }

  const profiles: ContractBillingTraceProfileRow[] = (profileRows as Array<{
    billing_profile_id: string;
    name: string;
    is_active: boolean;
    is_default: boolean;
  }>).map((row) => ({
    billingProfileId: row.billing_profile_id,
    name: row.name,
    isActive: Boolean(row.is_active),
    isDefault: Boolean(row.is_default),
  }));

  const lineIds = (lineRows as Array<{ contract_line_id: string }>).map((row) => row.contract_line_id);
  const serviceRows = lineIds.length === 0
    ? []
    : ((await db
        .table('contract_line_services')
        .whereIn('contract_line_id', lineIds)
        .select('contract_line_id', 'service_id')) as Array<{ contract_line_id: string; service_id: string }>);
  const serviceIdsByLine = new Map<string, string[]>();
  for (const row of serviceRows) {
    serviceIdsByLine.set(row.contract_line_id, [...(serviceIdsByLine.get(row.contract_line_id) ?? []), row.service_id]);
  }
  // Prepaid hour blocks are configured per line (`contract_line_prepaid_blocks`).
  const prepaidBlockLineIds = new Set<string>(
    lineIds.length === 0
      ? []
      : ((await db.table('contract_line_prepaid_blocks').whereIn('contract_line_id', lineIds).select('contract_line_id')) as Array<{
          contract_line_id: string;
        }>).map((row) => row.contract_line_id),
  );
  // Same pool rule the engine uses to decide whether a service draws from a bucket.
  const bucketCounts = new Map<string, number>();
  for (const lineId of lineIds) {
    const serviceIds = serviceIdsByLine.get(lineId) ?? [];
    if (prepaidBlockLineIds.has(lineId)) {
      bucketCounts.set(lineId, serviceIds.length);
      continue;
    }
    let covered = 0;
    for (const serviceId of serviceIds) {
      if (await resolveBucketForLine(knex, tenant, lineId, serviceId)) covered += 1;
    }
    bucketCounts.set(lineId, covered);
  }

  const lines: ContractBillingTraceLineInput[] = (lineRows as Array<{
    contract_line_id: string;
    contract_line_name: string | null;
    billing_profile_id: string | null;
    billing_frequency: string | null;
  }>).map((row) => ({
    contractLineId: row.contract_line_id,
    contractLineName: row.contract_line_name,
    billingProfileId: row.billing_profile_id,
    billingFrequency: row.billing_frequency,
    serviceCount: serviceIdsByLine.get(row.contract_line_id)?.length ?? 0,
    bucketServiceCount: bucketCounts.get(row.contract_line_id) ?? 0,
  }));

  const asOf = options.asOf ?? (new Date().toISOString().slice(0, 10) as ISO8601String);
  const separatelyBillingProfileIds = (await listSeparatelyBillingProfiles(knex, tenant, clientId)).map(
    (profile) => profile.billing_profile_id,
  );
  const base = {
    assignmentBillingProfileId: assignment?.billing_profile_id ?? null,
    clientDefaultBillingProfileId,
    perProfileInvoicing: options.perProfileInvoicing,
    separatelyBillingProfileIds,
  };
  const billingProfileIds = new Set<string>(
    resolveTracedLines({ ...base, lines }).map(({ resolved }) => resolved.billingProfileId),
  );

  // Step 4 candidates: the profiles this client's tickets and projects carry,
  // queried only when some line can reach step 4. The engine takes
  // COALESCE(ticket, linked-or-task project); the union of both columns is a
  // superset of what any one charge can see. A profile owned by another client
  // of the tenant is kept: the engine looks the id up without an ownership check
  // and bills with it. (The contract pointers above throw because an operator
  // authored them; this is data on a ticket or project.)
  const workItemProfileIds: string[] = [];
  const workItemProfileRows: ContractBillingTraceProfileRow[] = [];
  if (resolveStepFourLines({ ...base, lines }).length > 0) {
    const [ticketRows, projectRows] = await Promise.all([
      db.table('tickets').where({ client_id: clientId }).whereNotNull('billing_profile_id').distinct('billing_profile_id'),
      db.table('projects').where({ client_id: clientId }).whereNotNull('billing_profile_id').distinct('billing_profile_id'),
    ]);
    const found = new Set<string>(
      [...(ticketRows as Array<{ billing_profile_id: string }>), ...(projectRows as Array<{ billing_profile_id: string }>)].map(
        (row) => row.billing_profile_id,
      ),
    );
    workItemProfileIds.push(...[...found].sort());
    const foreignIds = workItemProfileIds.filter((id) => !ownedIds.has(id));
    if (foreignIds.length > 0) {
      const foreignRows = await db
        .table('client_billing_profiles')
        .whereIn('billing_profile_id', foreignIds)
        .select('billing_profile_id', 'name', 'is_active', 'is_default');
      workItemProfileRows.push(
        ...(foreignRows as Array<{ billing_profile_id: string; name: string; is_active: boolean; is_default: boolean }>).map((row) => ({
          billingProfileId: row.billing_profile_id,
          name: row.name,
          isActive: Boolean(row.is_active),
          isDefault: Boolean(row.is_default),
        })),
      );
    }
  }

  const identities: Record<string, EffectiveBillingIdentity> = {};
  // Terms and identity come from the invoice profile, not the attributed one.
  const invoiceProfileIds = new Set(
    [...billingProfileIds, ...workItemProfileIds].map((id) => resolveTraceInvoiceLanding(base, id).invoiceProfileId),
  );
  for (const billingProfileId of invoiceProfileIds) {
    identities[billingProfileId] = await resolveEffectiveBillingIdentity(knex, tenant, clientId, billingProfileId);
  }

  return buildContractBillingTrace({
    asOf,
    currencyCode: contract.currency_code ?? 'USD',
    contractBillingFrequency: contract.billing_frequency ?? null,
    ...base,
    lines,
    profiles,
    identities,
    workItemProfileIds,
    workItemProfileRows,
  });
}
