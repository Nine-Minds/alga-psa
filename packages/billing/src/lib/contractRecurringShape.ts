/**
 * Canonical recurring shape of a contract.
 *
 * The contract wizard rebuilds a draft's lines from its own (smaller) data
 * model. Anything the wizard cannot hold is silently lost on Finish Setup /
 * Save Draft. This module projects BOTH the stored contract lines and the
 * resumed wizard data into one normalized list of the entries that affect
 * revenue, and returns an itemized difference. Resume uses it as a round-trip
 * fidelity check: if the two shapes differ the draft is refused rather than
 * opened in a wizard that would change its pricing.
 *
 * Pure: no I/O. Hourly/usage entries are compared per service, so merging
 * several lines that share every attribute into one line passes.
 */
import type { ContractWizardFixedLine, ContractDraftBucketOverlayInput } from '@alga-psa/types';

type Scalar = string | number | boolean | null;

export type RecurringShapeEntryKind = 'fixed' | 'product' | 'hourly' | 'usage';

export interface RecurringShapeEntry {
  kind: RecurringShapeEntryKind;
  /** Human label (line name or service name) used in messages. Not compared. */
  label: string;
  /** Pairs "the same thing" on both sides so a change is reported as a change, not a drop + add. */
  identity: string;
  /** Normalized revenue-affecting attributes. */
  attrs: Record<string, Scalar>;
}

export type RecurringShape = RecurringShapeEntry[];

export interface RecurringShapeDifference {
  /** Line or service the difference is about. */
  line: string;
  message: string;
}

/* ------------------------------ stored side ------------------------------ */

export interface StoredRecurringMember {
  service_id: string;
  service_name?: string;
  item_kind?: string | null;
  quantity: number | null;
  /** `contract_line_service_configuration.custom_rate` (products). */
  custom_rate: number | null;
  /** Fixed members: stored basis and unit rate (minor units). */
  pricing_basis?: string | null;
  unit_rate?: number | null;
  /** Hourly/usage members: the resolved rate, exactly as Resume shows it. */
  resolved_rate?: number | null;
  minimum_billable_time?: number | null;
  round_up_to_nearest?: number | null;
  unit_of_measure?: string | null;
  bucket?: ContractDraftBucketOverlayInput | null;
}

export interface StoredRecurringLine {
  contract_line_id: string;
  contract_line_name?: string | null;
  contract_line_type?: string | null;
  billing_frequency?: string | null;
  billing_timing?: string | null;
  cadence_owner?: string | null;
  location_id?: string | null;
  enable_proration?: boolean | null;
  /** `contract_lines.custom_rate` — the line's bundle base rate. */
  custom_rate?: number | null;
  members: StoredRecurringMember[];
}

/* ------------------------------ wizard side ------------------------------ */

export interface WizardRecurringInput {
  billing_frequency?: string | null;
  billing_timing?: string | null;
  cadence_owner?: string | null;
  fixed_lines?: ContractWizardFixedLine[];
  product_services?: Array<{ service_id: string; service_name?: string; quantity: number; custom_rate?: number | null }>;
  hourly_services?: Array<{
    service_id: string;
    service_name?: string;
    hourly_rate?: number | null;
    bucket_overlay?: ContractDraftBucketOverlayInput | null;
  }>;
  hourly_billing_frequency?: string | null;
  minimum_billable_time?: number | null;
  round_up_to_nearest?: number | null;
  usage_services?: Array<{
    service_id: string;
    service_name?: string;
    unit_rate?: number | null;
    unit_of_measure?: string | null;
    bucket_overlay?: ContractDraftBucketOverlayInput | null;
  }>;
  usage_billing_frequency?: string | null;
}

/* -------------------------------- helpers -------------------------------- */

const roundOrNull = (value: number | null | undefined): number | null =>
  value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value));

const bucketKey = (overlay: ContractDraftBucketOverlayInput | null | undefined): string => {
  if (!overlay) return '';
  return [
    overlay.total_minutes ?? '',
    roundOrNull(overlay.overage_rate) ?? '',
    Boolean(overlay.allow_rollover),
    overlay.billing_period === 'weekly' ? 'weekly' : 'monthly',
  ].join('/');
};

const qty = (value: number | null | undefined, fallback = 1): number => {
  const n = value == null ? fallback : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normTiming = (value: string | null | undefined): string => (value === 'advance' ? 'advance' : 'arrears');
const normOwner = (value: string | null | undefined): string => value ?? 'client';

interface FixedMemberKeyInput {
  service_id: string;
  basis: string;
  quantity: number;
  unit_rate: number | null;
  bucket: string;
}

const fixedMemberKey = (m: FixedMemberKeyInput): string =>
  `${m.service_id}|${m.basis}|${m.quantity}|${m.unit_rate ?? ''}|${m.bucket}`;

function fixedEntry(input: {
  label: string;
  frequency: string;
  timing: string;
  cadenceOwner: string;
  location: string | null;
  proration: boolean;
  baseRate: number | null;
  members: FixedMemberKeyInput[];
}): RecurringShapeEntry {
  const members = [...input.members].sort((a, b) => fixedMemberKey(a).localeCompare(fixedMemberKey(b)));
  const hasBundle = members.some((m) => m.basis === 'bundle');
  // The bundle total only means something when a member shares it; a line with
  // no members at all (service-less custom line) carries it on its own.
  const baseRate = members.length === 0 || hasBundle ? roundOrNull(input.baseRate) : null;
  const serviceIds = members.filter((m) => m.basis !== 'product').map((m) => m.service_id);
  return {
    kind: 'fixed',
    label: input.label,
    identity: members.length === 0 ? `fixed:custom:${input.label}` : `fixed:${[...serviceIds].sort().join(',')}`,
    attrs: {
      frequency: input.frequency,
      timing: input.timing,
      cadence_owner: input.cadenceOwner,
      location: input.location,
      proration: input.proration,
      base_rate: baseRate,
      services: members.map(fixedMemberKey).join(';'),
    },
  };
}

/* ------------------------------- projections ------------------------------ */

export function recurringShapeFromStoredLines(
  lines: StoredRecurringLine[],
  context: { contractBillingFrequency: string },
): RecurringShape {
  const shape: RecurringShape = [];

  for (const line of lines) {
    const frequency = line.billing_frequency ?? context.contractBillingFrequency;
    const timing = normTiming(line.billing_timing);
    const owner = normOwner(line.cadence_owner);
    const location = line.location_id ?? null;
    const lineLabel = line.contract_line_name || line.contract_line_id;

    if (line.contract_line_type === 'Fixed') {
      // Product members always surface as product entries (that is where the wizard keeps them),
      // including inside a mixed line — which then differs on the fixed entry below and is refused.
      for (const m of line.members.filter((member) => member.item_kind === 'product')) {
        shape.push({
          kind: 'product',
          label: m.service_name || m.service_id,
          identity: `product:${m.service_id}`,
          attrs: {
            quantity: qty(m.quantity),
            rate: roundOrNull(m.custom_rate),
            frequency,
            location,
          },
        });
      }
      if (line.members.length > 0 && line.members.every((m) => m.item_kind === 'product')) continue;
      if (line.members.length === 0 && line.custom_rate == null) continue; // carries no revenue
      shape.push(
        fixedEntry({
          label: lineLabel,
          frequency,
          timing,
          cadenceOwner: owner,
          location,
          proration: Boolean(line.enable_proration),
          baseRate: line.custom_rate ?? null,
          members: line.members.map((m) => ({
            service_id: m.service_id,
            // A product inside a mixed line has no wizard representation; a distinct basis makes that visible.
            basis: m.item_kind === 'product' ? 'product' : m.pricing_basis === 'unit' ? 'unit' : 'bundle',
            quantity: qty(m.quantity),
            unit_rate: m.pricing_basis === 'unit' ? roundOrNull(m.unit_rate) : null,
            bucket: bucketKey(m.bucket),
          })),
        }),
      );
    } else if (line.contract_line_type === 'Hourly') {
      for (const m of line.members) {
        shape.push({
          kind: 'hourly',
          label: m.service_name || m.service_id,
          identity: `hourly:${m.service_id}`,
          attrs: {
            rate: roundOrNull(m.resolved_rate),
            frequency,
            timing,
            cadence_owner: owner,
            location,
            minimum: m.minimum_billable_time ?? 0,
            round_up: m.round_up_to_nearest ?? 0,
            bucket: bucketKey(m.bucket),
          },
        });
      }
    } else if (line.contract_line_type === 'Usage') {
      for (const m of line.members) {
        shape.push({
          kind: 'usage',
          label: m.service_name || m.service_id,
          identity: `usage:${m.service_id}`,
          attrs: {
            rate: roundOrNull(m.resolved_rate),
            unit_of_measure: m.unit_of_measure ?? null,
            frequency,
            timing,
            cadence_owner: owner,
            location,
            bucket: bucketKey(m.bucket),
          },
        });
      }
    }
  }

  return shape;
}

export function recurringShapeFromWizard(data: WizardRecurringInput): RecurringShape {
  const contractFrequency = data.billing_frequency ?? 'monthly';
  const contractTiming = normTiming(data.billing_timing);
  const owner = normOwner(data.cadence_owner);
  const shape: RecurringShape = [];

  (data.fixed_lines ?? []).forEach((line, index) => {
    if (line.services.length === 0 && line.base_rate == null) return;
    shape.push(
      fixedEntry({
        label: line.contract_line_name || `Fixed line ${index + 1}`,
        frequency: line.billing_frequency ?? contractFrequency,
        timing: line.billing_timing ? normTiming(line.billing_timing) : contractTiming,
        cadenceOwner: owner,
        location: line.location_id ?? null,
        proration: Boolean(line.enable_proration),
        baseRate: line.base_rate ?? null,
        members: line.services.map((s) => ({
          service_id: s.service_id,
          basis: s.pricing_basis === 'unit' ? 'unit' : 'bundle',
          quantity: qty(s.quantity),
          unit_rate: s.pricing_basis === 'unit' ? roundOrNull(s.unit_rate) : null,
          bucket: bucketKey(s.bucket_overlay),
        })),
      }),
    );
  });

  for (const p of data.product_services ?? []) {
    shape.push({
      kind: 'product',
      label: p.service_name || p.service_id,
      identity: `product:${p.service_id}`,
      attrs: { quantity: qty(p.quantity), rate: roundOrNull(p.custom_rate), frequency: contractFrequency, location: null },
    });
  }

  for (const h of data.hourly_services ?? []) {
    shape.push({
      kind: 'hourly',
      label: h.service_name || h.service_id,
      identity: `hourly:${h.service_id}`,
      attrs: {
        rate: roundOrNull(h.hourly_rate),
        frequency: data.hourly_billing_frequency ?? contractFrequency,
        timing: contractTiming,
        cadence_owner: owner,
        location: null,
        minimum: data.minimum_billable_time ?? 0,
        round_up: data.round_up_to_nearest ?? 0,
        bucket: bucketKey(h.bucket_overlay),
      },
    });
  }

  for (const u of data.usage_services ?? []) {
    shape.push({
      kind: 'usage',
      label: u.service_name || u.service_id,
      identity: `usage:${u.service_id}`,
      attrs: {
        rate: roundOrNull(u.unit_rate),
        unit_of_measure: u.unit_of_measure ?? null,
        frequency: data.usage_billing_frequency ?? contractFrequency,
        timing: contractTiming,
        cadence_owner: owner,
        location: null,
        bucket: bucketKey(u.bucket_overlay),
      },
    });
  }

  return shape;
}

/* ---------------------------------- diff ---------------------------------- */

const entryKey = (e: RecurringShapeEntry): string =>
  `${e.kind}|${e.identity}|${JSON.stringify(Object.entries(e.attrs).sort(([a], [b]) => a.localeCompare(b)))}`;

const ATTR_LABELS: Record<string, string> = {
  frequency: 'billing frequency',
  timing: 'billing timing',
  cadence_owner: 'cadence owner',
  location: 'location',
  proration: 'proration',
  base_rate: 'recurring amount',
  services: 'services',
  rate: 'rate',
  quantity: 'quantity',
  minimum: 'minimum billable time',
  round_up: 'round-up',
  bucket: 'bucket',
  unit_of_measure: 'unit of measure',
};

const show = (value: Scalar): string => (value === null || value === '' ? 'none' : String(value));

/**
 * Itemized differences between two shapes (`a` = stored, `b` = wizard). Equal
 * entries cancel as a multiset; what is left is paired by identity into
 * "changed" items, and the remainder is reported as dropped / added.
 */
export function diffRecurringShapes(a: RecurringShape, b: RecurringShape): RecurringShapeDifference[] {
  const remainingB = [...b];
  const unmatchedA: RecurringShapeEntry[] = [];

  for (const entry of a) {
    const key = entryKey(entry);
    const idx = remainingB.findIndex((candidate) => entryKey(candidate) === key);
    if (idx >= 0) remainingB.splice(idx, 1);
    else unmatchedA.push(entry);
  }

  const differences: RecurringShapeDifference[] = [];
  for (const entry of unmatchedA) {
    const idx = remainingB.findIndex((candidate) => candidate.kind === entry.kind && candidate.identity === entry.identity);
    if (idx < 0) {
      differences.push({ line: entry.label, message: `${entry.label}: would be dropped` });
      continue;
    }
    const [counterpart] = remainingB.splice(idx, 1);
    for (const attr of Object.keys(entry.attrs)) {
      if (entry.attrs[attr] !== counterpart.attrs[attr]) {
        const name = ATTR_LABELS[attr] ?? attr;
        differences.push({
          line: entry.label,
          message: `${entry.label}: ${name} would change from ${show(entry.attrs[attr])} to ${show(counterpart.attrs[attr])}`,
        });
      }
    }
  }
  for (const entry of remainingB) {
    differences.push({ line: entry.label, message: `${entry.label}: would be added` });
  }
  return differences;
}
