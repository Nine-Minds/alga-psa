import type {
  ChargeExplanation,
  IBillingPeriod,
  IClientContractLine,
  ITimeBasedCharge,
  InvoiceTimeEntrySnapshot,
} from "@alga-psa/types";
import type {
  ChargeComputeClient,
  ChargeComputeTaxPorts,
  ChargeComputeTiming,
  ChargeProfileAssignments,
} from "./types";
import { resolveChargeProfileFor } from "../billingProfileResolution";

/**
 * Time-entry charge math extracted from BillingEngine.calculateTimeBasedCharges.
 * The engine's load phase supplies approved, positively-billable time entries
 * and hourly service configuration; this module reproduces the duration
 * rounding, rate resolution, and overtime arithmetic byte-for-byte with zero
 * I/O outside the injected tax ports. The simulator feeds synthetic aggregate
 * entries through the same math.
 */

export interface TimeEntryComputeRow {
  entry_id: string;
  user_id: string;
  user_type?: string | null;
  start_time: Date;
  end_time: Date;
  service_id: string;
  service_name?: string | null;
  tax_rate_id?: string | null;
  custom_rate?: number | null;
  /** service_prices rate for the contract currency, when present. */
  currency_rate?: number | string | null;
  /** Authoritative billable minutes; the loaders exclude zero-billable rows. */
  billable_duration: number;
  project_phase_id?: string | null;
  project_id?: string | null;
  /**
   * Work-item billing profile — step 4 of the resolution chain. Selected from
   * the ticket / project joins the time-entry loader already performs, which is
   * why time is one of only two charge types that can reach step 4.
   */
  work_item_billing_profile_id?: string | null;
  /**
   * Work-item identity + customer-visible descriptive fields, selected from
   * the same ticket / project-task joins. Feed the immutable invoice
   * snapshot only — they never alter charge math or descriptions. Absent in
   * callers that predate the snapshot (e.g. the simulator's synthetic rows).
   */
  work_item_id?: string | null;
  work_item_type?: string | null;
  ticket_number?: string | null;
  ticket_title?: string | null;
  /** Customer-visible ticket description (tickets.attributes->>'description'). */
  ticket_description?: string | null;
  project_task_name?: string | null;
}

export interface HourlyServiceConfigEntry {
  config: {
    config_id: string;
    hourly_rate: number;
    minimum_billable_time: number;
    round_up_to_nearest: number;
  };
  userTypeRates: Map<string, number>;
}

export interface TimeBasedPhaseRateOverride {
  /** null and undefined behave differently in the missing-pricing check; preserve both. */
  rate?: number | null;
  override_service_id?: string | null;
  override_service_name?: string | null;
  override_tax_rate_id?: string | null;
}

export interface TimeBasedProjectChargeConfig {
  billing_model?: string | null;
  project_id: string;
  project_name?: string | null;
  project_number?: string | null;
  config_id: string;
}

export interface TimeBasedChargeComputeInputs {
  billingPeriod: IBillingPeriod;
  clientContractLine: IClientContractLine;
  timing: ChargeComputeTiming;
  client: ChargeComputeClient;
  /** contract_lines row fields used for overtime. */
  plan: {
    enable_overtime?: boolean | null;
    overtime_threshold?: number | null;
    overtime_rate?: number | null;
  };
  serviceConfigMap: Map<string, HourlyServiceConfigEntry>;
  timeEntries: TimeEntryComputeRow[];
  contractCurrency: string;
  /** Contract-line/contract/client-default profile assignments (F016–F024). */
  billingProfile?: ChargeProfileAssignments | null;
  /** Project-billing hooks; production wires these to ProjectBillingContext, the simulator passes null. */
  resolvePhaseRateOverride?:
    | ((
        phaseId: string | null | undefined,
        serviceId: string,
      ) => TimeBasedPhaseRateOverride | null)
    | null;
  getProjectChargeConfig?:
    | ((projectId: string) => TimeBasedProjectChargeConfig | undefined)
    | null;
}

export interface TimeBasedChargeComputeResult {
  charges: ITimeBasedCharge[];
  explanations: ChargeExplanation[];
}

function formatCents(cents: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
  }).format(cents / 100);
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
}

const toIsoDateOrNull = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const trimmedOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Build the immutable work-item snapshot for one billed time entry. Shared by
 * the contract-line compute path and the engine's unresolved/catalog path so
 * both persist identical snapshot shapes. All money and duration values are
 * integers (minor units / whole minutes); customer-visible fields only.
 */
export function buildTimeEntryWorkItemSnapshot(
  entry: Pick<
    TimeEntryComputeRow,
    | "start_time"
    | "work_item_id"
    | "work_item_type"
    | "ticket_number"
    | "ticket_title"
    | "ticket_description"
    | "project_task_name"
  >,
  billed: {
    billedMinutes: number;
    rateKind?: 'uniform' | 'mixed' | 'unknown';
    uniformRate?: number | null;
    rate: number;
    netAmount: number;
    serviceId: string | null;
    serviceName: string | null;
    segment?: 'regular' | 'overtime';
  },
): InvoiceTimeEntrySnapshot {
  const workItemType: InvoiceTimeEntrySnapshot["workItemType"] =
    entry.work_item_type === "ticket"
      ? "ticket"
      : entry.work_item_type === "project_task"
        ? "project_task"
        : "ad_hoc";
  const isTicket = workItemType === "ticket";

  return {
    version: 2,
    rateKind: billed.billedMinutes > 0 ? (billed.rateKind ?? 'unknown') : 'unknown',
    uniformRate: billed.billedMinutes > 0 && billed.rateKind === 'uniform' ? (billed.uniformRate ?? null) : null,
    workItemType,
    workItemId: entry.work_item_id ?? null,
    ticketNumber: isTicket ? trimmedOrNull(entry.ticket_number) : null,
    title: isTicket
      ? trimmedOrNull(entry.ticket_title)
      : trimmedOrNull(entry.project_task_name),
    description: isTicket ? trimmedOrNull(entry.ticket_description) : null,
    entryDate: toIsoDateOrNull(entry.start_time),
    billedMinutes: Math.round(billed.billedMinutes),
    rate: Math.round(billed.rate),
    netAmount: Math.round(billed.netAmount),
    serviceId: billed.serviceId,
    serviceName: billed.serviceName,
    ...(billed.segment ? { segment: billed.segment } : {}),
  };
}

export function computeTimeBasedCharges(
  inputs: TimeBasedChargeComputeInputs,
  taxPorts: ChargeComputeTaxPorts,
): TimeBasedChargeComputeResult {
  const {
    billingPeriod,
    clientContractLine,
    timing,
    client,
    plan,
    serviceConfigMap,
    timeEntries,
    contractCurrency,
    billingProfile,
    resolvePhaseRateOverride,
    getProjectChargeConfig,
  } = inputs;

  const { servicePeriodStart, servicePeriodEnd } = timing;
  const explanations: ChargeExplanation[] = [];

  const charges = timeEntries.flatMap((entry): ITimeBasedCharge[] => {
    const serviceConfig = serviceConfigMap.get(entry.service_id);
    const isSystemManagedDefault =
      (clientContractLine as { is_system_managed_default?: boolean | null })
        .is_system_managed_default === true;

    const rawDurationMinutes = Number(entry.billable_duration);
    let durationMinutes = rawDurationMinutes;
    let minimumApplied = false;
    let roundingApplied = false;

    if (serviceConfig && !isSystemManagedDefault) {
      if (durationMinutes < serviceConfig.config.minimum_billable_time) {
        durationMinutes = serviceConfig.config.minimum_billable_time;
        minimumApplied = durationMinutes !== rawDurationMinutes;
      }

      if (serviceConfig.config.round_up_to_nearest > 0) {
        const remainder =
          durationMinutes % serviceConfig.config.round_up_to_nearest;
        if (remainder > 0) {
          durationMinutes +=
            serviceConfig.config.round_up_to_nearest - remainder;
          roundingApplied = true;
        }
      }
    }

    // Bill the fractional hours that remain after the minimum-billable-time
    // and round-up-to-nearest rules; the rate is per hour, so the quantity
    // must carry the partial hour.
    const duration = durationMinutes / 60;

    // Resolve rate, preferring overrides over the currency-specific catalog
    // price: per-entry custom rate -> per-user-type rate -> service_prices
    // row in the contract's currency. No fallback to the currency-untagged
    // legacy service_catalog.default_rate.
    const userTypeRate =
      !isSystemManagedDefault &&
      serviceConfig &&
      entry.user_type != null &&
      serviceConfig.userTypeRates.has(entry.user_type)
        ? (serviceConfig.userTypeRates.get(entry.user_type) as number)
        : undefined;
    const resolvedRate =
      entry.custom_rate ??
      userTypeRate ??
      (entry.currency_rate != null ? Number(entry.currency_rate) : undefined);
    const phaseOverride =
      resolvePhaseRateOverride?.(entry.project_phase_id, entry.service_id) ??
      null;
    if (resolvedRate === undefined && phaseOverride?.rate === undefined) {
      throw new Error(
        `Missing pricing for time entry on service "${entry.service_name}" (${entry.service_id}) in ${contractCurrency}. ` +
          `Add a ${contractCurrency} price in the service catalog or set a custom rate on the time entry / contract line.`,
      );
    }
    const effectiveServiceId =
      phaseOverride?.override_service_id ?? entry.service_id;
    const effectiveServiceName =
      phaseOverride?.override_service_name ?? entry.service_name;
    const effectiveTaxRateId =
      phaseOverride?.override_tax_rate_id ?? entry.tax_rate_id;
    const rate = Math.ceil(phaseOverride?.rate ?? (Number(resolvedRate) || 0));

    // An entry past the overtime threshold bills as two segments at two
    // rates. Each segment becomes its own charge so every stored line stays
    // quantity × rate = amount (invoice PDFs and accounting exports both
    // depend on that); equal rates collapse back into one plain line.
    const overtimeRate =
      plan.enable_overtime && plan.overtime_threshold
        ? Math.ceil(Number(plan.overtime_rate) || rate * 1.5)
        : null;
    const regularMinutes =
      overtimeRate !== null ? Math.round(Number(plan.overtime_threshold) * 60) : durationMinutes;
    const overtimeMinutes = durationMinutes - regularMinutes;
    const isOvertime = overtimeRate !== null && overtimeMinutes > 0;

    const segments: Array<{ kind: 'regular' | 'overtime' | null; minutes: number; rate: number }> =
      isOvertime && overtimeRate !== rate && regularMinutes > 0
        ? [
            { kind: 'regular', minutes: regularMinutes, rate },
            { kind: 'overtime', minutes: overtimeMinutes, rate: overtimeRate },
          ]
        : [
            {
              kind: null,
              minutes: durationMinutes,
              rate: isOvertime && regularMinutes <= 0 ? overtimeRate : rate,
            },
          ];
    const entryTotal = isOvertime
      ? Math.round((regularMinutes / 60) * rate + (overtimeMinutes / 60) * (overtimeRate as number))
      : Math.round(duration * rate);

    const { taxRegion: serviceTaxRegion, isTaxable } =
      taxPorts.getTaxInfoFromService({
        service_id: effectiveServiceId,
        tax_rate_id: effectiveTaxRateId,
      });

    // Time is one of only two charge types whose source record can carry a
    // segment, so this is the one place the work-item step of the chain is
    // reachable from recurring generation. Resolved before tax because
    // exemption is per profile (F131), not per client.
    const resolvedProfile = resolveChargeProfileFor(billingProfile, {
      workItemBillingProfileId: entry.work_item_billing_profile_id,
    });

    const effectiveTaxRegion =
      serviceTaxRegion ??
      taxPorts.getLocationTaxRegionCode(clientContractLine.location_id) ??
      taxPorts.getClientDefaultTaxRegionCode(client.client_id) ??
      undefined;
    const taxApplies =
      !taxPorts.isTaxExemptForProfile(resolvedProfile?.billingProfileId) &&
      isTaxable &&
      Boolean(effectiveTaxRegion);

    const projectConfig = entry.project_id
      ? getProjectChargeConfig?.(entry.project_id)
      : undefined;

    const explanationInputs = [
      {
        label: "Rate",
        value: `${formatCents(rate, contractCurrency)} / hr${entry.custom_rate != null ? " (entry custom rate)" : userTypeRate !== undefined ? " (user-type rate)" : ""}`,
      },
      { label: "Hours", value: `${formatHours(duration)} hrs` },
    ];
    const durationSteps: string[] = [];
    if (minimumApplied || roundingApplied) {
      durationSteps.push(
        `${rawDurationMinutes} min${minimumApplied ? ` → minimum ${serviceConfig!.config.minimum_billable_time} min` : ""}${roundingApplied ? ` → rounded up to ${durationMinutes} min` : ""} = ${formatHours(duration)} hrs`,
      );
    }
    if (isOvertime) {
      durationSteps.push(
        `${formatHours(regularMinutes / 60)} hrs × ${formatCents(rate, contractCurrency)} + ${formatHours(overtimeMinutes / 60)} hrs × ${formatCents(overtimeRate as number, contractCurrency)} = ${formatCents(entryTotal, contractCurrency)}`,
      );
    }
    const markers: ChargeExplanation["markers"] = [];
    if (minimumApplied) markers.push("minimum_applied");
    if (roundingApplied) markers.push("rounding_applied");
    if (isOvertime) markers.push("overtime");
    const baseChargeKey = `${serviceConfig?.config.config_id ?? clientContractLine.client_contract_line_id}:${effectiveServiceId}:${entry.entry_id}`;

    let remainingTotal = entryTotal;
    return segments.map((segment, index): ITimeBasedCharge => {
      const segmentHours = segment.minutes / 60;
      // Rounding remainder lands on the last segment so the segments sum to
      // the entry total exactly.
      const total =
        index === segments.length - 1
          ? remainingTotal
          : Math.round(segmentHours * segment.rate);
      remainingTotal -= total;

      let taxAmount = 0;
      let taxRate = 0;
      if (taxApplies) {
        try {
          const taxResult = taxPorts.calculateTax(
            client.client_id,
            total,
            billingPeriod.endDate,
            effectiveTaxRegion as string,
            true,
            contractCurrency,
            resolvedProfile?.billingProfileId ?? null,
          );
          taxRate = taxResult.taxRate;
          taxAmount = taxResult.taxAmount;
        } catch (error) {
          console.error(
            `Error calculating initial tax for time entry ${entry.entry_id}:`,
            error,
          );
        }
      }

      explanations.push({
        chargeKey: segment.kind ? `${baseChargeKey}:${segment.kind}` : baseChargeKey,
        serviceName: effectiveServiceName ?? entry.service_id,
        chargeType: "time",
        inputs: explanationInputs,
        steps: [
          ...durationSteps,
          `${segment.kind ? `${segment.kind === 'overtime' ? 'Overtime' : 'Regular'}: ` : ''}${formatHours(segmentHours)} hrs × ${formatCents(segment.rate, contractCurrency)} = ${formatCents(total, contractCurrency)}`,
        ],
        markers,
      });

      return {
        serviceId: effectiveServiceId,
        serviceName: effectiveServiceName as string,
        config_id: serviceConfig?.config.config_id,
        client_contract_line_id: clientContractLine.client_contract_line_id,
        userId: entry.user_id,
        duration: segmentHours,
        quantity: segmentHours,
        rate: segment.rate,
        total,
        type: "time",
        ...(segment.kind ? { timeSegment: segment.kind } : {}),
        workItemSnapshot: buildTimeEntryWorkItemSnapshot(entry, {
          billedMinutes: segment.minutes,
          rateKind: 'uniform',
          uniformRate: segment.rate,
          rate: segment.rate,
          netAmount: total,
          serviceId: effectiveServiceId ?? null,
          serviceName: (effectiveServiceName as string) ?? null,
          ...(segment.kind ? { segment: segment.kind } : {}),
        }),
        tax_amount: taxAmount,
        tax_rate: taxRate,
        tax_region: effectiveTaxRegion,
        entryId: entry.entry_id,
        is_taxable: isTaxable,
        servicePeriodStart,
        servicePeriodEnd,
        servicePeriodRecordId: timing.servicePeriodRecordId ?? null,
        billingTiming: timing.duePosition,
        client_contract_id: clientContractLine.client_contract_id || undefined,
        contract_name: clientContractLine.contract_name || undefined,
        location_id: clientContractLine.location_id ?? null,
        billing_profile_id: resolvedProfile?.billingProfileId ?? null,
        billing_profile_source: resolvedProfile?.source ?? null,
        ...(projectConfig?.billing_model === "time_and_materials"
          ? {
              project_id: projectConfig.project_id,
              project_name: projectConfig.project_name,
              project_number: projectConfig.project_number,
              project_billing_config_id: projectConfig.config_id,
            }
          : {}),
      };
    });
  });

  return { charges, explanations };
}
