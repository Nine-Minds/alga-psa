import type {
  ChargeExplanation,
  IBillingPeriod,
  IClientContractLine,
  ITimeBasedCharge,
} from "@alga-psa/types";
import type {
  ChargeComputeClient,
  ChargeComputeTaxPorts,
  ChargeComputeTiming,
} from "./types";

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
    resolvePhaseRateOverride,
    getProjectChargeConfig,
  } = inputs;

  const { servicePeriodStart, servicePeriodEnd } = timing;
  const explanations: ChargeExplanation[] = [];

  const charges = timeEntries.map((entry): ITimeBasedCharge => {
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

    let total = Math.round(duration * rate);
    let overtimeDetail: {
      regularHours: number;
      overtimeHours: number;
      overtimeRate: number;
    } | null = null;
    if (
      plan.enable_overtime &&
      plan.overtime_threshold &&
      duration > plan.overtime_threshold
    ) {
      const regularHours = plan.overtime_threshold;
      const overtimeHours = duration - regularHours;
      const overtimeRate = plan.overtime_rate || rate * 1.5;
      total = Math.round(regularHours * rate + overtimeHours * overtimeRate);
      overtimeDetail = { regularHours, overtimeHours, overtimeRate };
    }

    const { taxRegion: serviceTaxRegion, isTaxable } =
      taxPorts.getTaxInfoFromService({
        service_id: effectiveServiceId,
        tax_rate_id: effectiveTaxRateId,
      });

    let taxAmount = 0;
    let taxRate = 0;
    const effectiveTaxRegion =
      serviceTaxRegion ??
      taxPorts.getLocationTaxRegionCode(clientContractLine.location_id) ??
      taxPorts.getClientDefaultTaxRegionCode(client.client_id) ??
      undefined;

    if (!client.is_tax_exempt && isTaxable && effectiveTaxRegion) {
      try {
        const taxResult = taxPorts.calculateTax(
          client.client_id,
          total,
          billingPeriod.endDate,
          effectiveTaxRegion,
          true,
          clientContractLine.currency_code || "USD",
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
    const steps: string[] = [];
    if (minimumApplied || roundingApplied) {
      steps.push(
        `${rawDurationMinutes} min${minimumApplied ? ` → minimum ${serviceConfig!.config.minimum_billable_time} min` : ""}${roundingApplied ? ` → rounded up to ${durationMinutes} min` : ""} = ${formatHours(duration)} hrs`,
      );
    }
    if (overtimeDetail) {
      steps.push(
        `${formatHours(overtimeDetail.regularHours)} hrs × ${formatCents(rate, contractCurrency)} + ${formatHours(overtimeDetail.overtimeHours)} hrs × ${formatCents(overtimeDetail.overtimeRate, contractCurrency)} = ${formatCents(total, contractCurrency)}`,
      );
    } else {
      steps.push(
        `${formatHours(duration)} hrs × ${formatCents(rate, contractCurrency)} = ${formatCents(total, contractCurrency)}`,
      );
    }
    const markers: ChargeExplanation["markers"] = [];
    if (minimumApplied) markers.push("minimum_applied");
    if (roundingApplied) markers.push("rounding_applied");
    if (overtimeDetail) markers.push("overtime");
    explanations.push({
      chargeKey: `${serviceConfig?.config.config_id ?? clientContractLine.client_contract_line_id}:${effectiveServiceId}:${entry.entry_id}`,
      serviceName: effectiveServiceName ?? entry.service_id,
      chargeType: "time",
      inputs: explanationInputs,
      steps,
      markers,
    });

    return {
      serviceId: effectiveServiceId,
      serviceName: effectiveServiceName as string,
      config_id: serviceConfig?.config.config_id,
      client_contract_line_id: clientContractLine.client_contract_line_id,
      userId: entry.user_id,
      duration,
      quantity: duration,
      rate,
      total,
      type: "time",
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

  return { charges, explanations };
}
