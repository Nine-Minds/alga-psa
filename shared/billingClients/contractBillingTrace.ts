import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  ContractBillingTrace,
  ContractBillingTraceField,
  ContractBillingTraceProfile,
  ContractBillingTraceProfileSource,
  ContractBillingTraceTerms,
  ContractBillingTraceWarning,
  ISO8601String,
} from '@alga-psa/types';
import { resolveChargeProfile } from './billingProfileResolution';
import {
  resolveEffectiveBillingIdentity,
  type EffectiveBillingIdentity,
} from './billingProfileSettings';
import { ensureClientDefaultBillingProfile } from './billingProfiles';
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
 * This module must not grow a second `line ?? contract ?? default` chain.
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
}

export interface BuildContractBillingTraceInput {
  asOf: ISO8601String;
  currencyCode: string;
  /** `contracts.billing_frequency`; used for cadence only when the contract has no lines. */
  contractBillingFrequency?: string | null;
  clientDefaultBillingProfileId: string;
  /** `client_contracts.billing_profile_id` of the binding being traced. */
  assignmentBillingProfileId: string | null;
  lines: ContractBillingTraceLineInput[];
  /** Every profile of the owning client, inactive ones included. */
  profiles: ContractBillingTraceProfileRow[];
  /** `resolveEffectiveBillingIdentity` output for every profile that bills. */
  identities: Record<string, EffectiveBillingIdentity>;
}

// Most specific step first; a profile reached by several steps reports the most specific.
const SOURCE_SPECIFICITY: ContractBillingTraceProfileSource[] = ['contract_line', 'contract', 'client_default'];

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

/** Which profile bills one line (or the contract as a whole when `line` is null). */
function resolveForLine(
  input: Pick<BuildContractBillingTraceInput, 'assignmentBillingProfileId' | 'clientDefaultBillingProfileId'>,
  lineBillingProfileId: string | null,
) {
  return resolveChargeProfile({
    contractLineBillingProfileId: lineBillingProfileId,
    contractBillingProfileId: input.assignmentBillingProfileId,
    clientDefaultBillingProfileId: input.clientDefaultBillingProfileId,
  });
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
    .map(([billingProfileId, entry]) => {
      const row = requireProfile(billingProfileId);
      const identity = input.identities[billingProfileId];
      if (!identity) {
        throw new Error(`Missing billing identity for profile ${billingProfileId}.`);
      }
      const cadence = entry.frequencies.size > 0
        ? [...entry.frequencies].join(',')
        : input.contractBillingFrequency ?? null;
      return {
        billingProfileId,
        name: row.name,
        source: entry.source,
        lineCount: entry.lineCount,
        isActive: row.isActive,
        isDefault: row.isDefault,
        terms: buildTerms(identity, input.asOf),
        fields: buildFields(identity, input.currencyCode, cadence),
      };
    })
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
    warnings.push({ code: 'mixed_profiles', profileCount: profiles.length });
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

  const primary = profiles[0];
  return {
    asOf: input.asOf,
    profiles,
    terms: primary.terms,
    fields: primary.fields,
    warnings,
  };
}

export interface LoadContractBillingTraceOptions {
  contractId: string;
  /** Trace one specific assignment (a merged-in client) instead of the owning client's. */
  clientContractId?: string | null;
  asOf?: ISO8601String;
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
  }));

  const asOf = options.asOf ?? (new Date().toISOString().slice(0, 10) as ISO8601String);
  const base = {
    assignmentBillingProfileId: assignment?.billing_profile_id ?? null,
    clientDefaultBillingProfileId,
  };
  const billingProfileIds = new Set<string>(
    resolveTracedLines({ ...base, lines }).map(({ resolved }) => resolved.billingProfileId),
  );
  const identities: Record<string, EffectiveBillingIdentity> = {};
  for (const billingProfileId of billingProfileIds) {
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
  });
}
