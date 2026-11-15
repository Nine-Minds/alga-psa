import type {
  ChargeExplanation,
  IHourBlockCharge,
  IPrepaidBlockCharge,
  ISO8601String,
} from "@alga-psa/types";
import { formatCurrencyFromMinorUnits } from "@alga-psa/core";
import { LOCALE_CONFIG } from "@alga-psa/core/i18n/config";
import { prorateRecurringCoverageByRatio } from "@alga-psa/shared/billingClients/coverageProration";
import { resolveChargeProfileFor } from "../billingProfileResolution";
import {
  aggregateHourBlockBurnRows,
  computeHourBlockCharges,
  type HourBlockBurnRow,
} from "./computeHourBlockCharges";
import type {
  ChargeComputeClient,
  ChargeComputeTaxContext,
  ChargeProfileAssignments,
} from "./types";

/**
 * Pure compute for the prepaid-block family: the up-front `prepaid_block`
 * charge for one scheduled issuance, and the $0 `hour_block` consumption lines
 * for the time that drew a line's blocks. No I/O. Which issuances and which
 * allocation rows reach these functions is decided by the charge resolver
 * (chargeResolution/prepaidBlockRules.ts); a source only supplies the data.
 */

/** One block issuance as a source supplies it. All amounts are minor units. */
export interface PrepaidBlockIssuanceInput {
  issuanceId: string;
  /** `contract_lines.contract_line_id` carrying the block configuration. */
  contractLineId: string;
  clientContractId?: string | null;
  contractName?: string | null;
  /**
   * Attribution to a client contract line. Present only when the source
   * attributes the block to a line (the simulator); absent otherwise.
   */
  clientContractLineId?: string | null;
  /** Present only when the source stamps charges with a tenant. */
  tenant?: string;
  blockMinutes: number;
  blockPrice: number;
  expiryMonths: number | null;
  scopeServiceIds: string[];
  /** Catalog service the invoice line is sold as. */
  soldAsServiceId: string;
  /** Display name of the invoice line. */
  serviceName: string;
  soldAsTaxRateId: string | null;
  currencyCode: string;
  /** `undefined` leaves the key off the charge. */
  locationId?: string | null;
  /** Date the block's tax is evaluated on. */
  taxDate: ISO8601String;
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
}

export interface PrepaidBlockChargeComputeInputs {
  client: ChargeComputeClient;
  issuance: PrepaidBlockIssuanceInput;
  /** Profile of the issuance's line; absent leaves the profile keys off. */
  billingProfile?: ChargeProfileAssignments | null;
}

export interface PrepaidBlockChargeComputeResult {
  charges: IPrepaidBlockCharge[];
  explanations: ChargeExplanation[];
}

/**
 * Formats minor units in the currency's own minor-unit scale (JPY has none,
 * KWD has three). The currency is always the contract's; there is no default.
 * The explanation text has no viewer, so it renders in the platform default
 * locale.
 */
function formatMinorUnits(minorUnits: number, currencyCode: string): string {
  return formatCurrencyFromMinorUnits(minorUnits, LOCALE_CONFIG.defaultLocale, currencyCode);
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
}

function computeBlockTax(input: {
  client: ChargeComputeClient;
  taxContext: ChargeComputeTaxContext;
  soldAsServiceId: string;
  soldAsTaxRateId: string | null;
  amount: number;
  taxDate: ISO8601String;
  currencyCode: string;
  label: string;
}) {
  const { client, taxContext } = input;
  const { taxRegion: serviceTaxRegion, isTaxable } =
    taxContext.getTaxInfoFromService({
      service_id: input.soldAsServiceId,
      tax_rate_id: input.soldAsTaxRateId,
    });
  // Region chain of a block: the sold-as service, then the client default. A
  // block is not tied to a service location.
  const effectiveTaxRegion =
    serviceTaxRegion ??
    taxContext.getClientDefaultTaxRegionCode(client.client_id) ??
    undefined;

  let taxAmount = 0;
  let taxRate = 0;
  if (
    !taxContext.isTaxExemptForProfile(null) &&
    isTaxable &&
    effectiveTaxRegion
  ) {
    try {
      const result = taxContext.calculateTax(
        client.client_id,
        input.amount,
        input.taxDate,
        effectiveTaxRegion,
        true,
        input.currencyCode,
      );
      taxRate = result.taxRate;
      taxAmount = result.taxAmount;
    } catch (error) {
      console.error(`Error calculating tax for ${input.label}:`, error);
    }
  }
  return { taxAmount, taxRate, effectiveTaxRegion, isTaxable };
}

export function computePrepaidBlockCharges(
  inputs: PrepaidBlockChargeComputeInputs,
  taxContext: ChargeComputeTaxContext,
): PrepaidBlockChargeComputeResult {
  const { client, issuance, billingProfile } = inputs;
  const hours = issuance.blockMinutes / 60;
  const rate = Math.round(issuance.blockPrice / hours);

  const { taxAmount, taxRate, effectiveTaxRegion, isTaxable } = computeBlockTax({
    client,
    taxContext,
    soldAsServiceId: issuance.soldAsServiceId,
    soldAsTaxRateId: issuance.soldAsTaxRateId,
    amount: issuance.blockPrice,
    taxDate: issuance.taxDate,
    currencyCode: issuance.currencyCode,
    label: `prepaid block issuance ${issuance.issuanceId}`,
  });

  const profile = resolveChargeProfileFor(billingProfile);
  const charge: IPrepaidBlockCharge = {
    type: "prepaid_block",
    ...(issuance.tenant ? { tenant: issuance.tenant } : {}),
    issuance_id: issuance.issuanceId,
    contract_line_id: issuance.contractLineId,
    ...(issuance.clientContractLineId
      ? { client_contract_line_id: issuance.clientContractLineId }
      : {}),
    client_contract_id: issuance.clientContractId as string,
    contract_name: issuance.contractName || undefined,
    serviceId: issuance.soldAsServiceId,
    serviceName: issuance.serviceName,
    block_minutes: issuance.blockMinutes,
    block_price: issuance.blockPrice,
    currency_code: issuance.currencyCode,
    expiry_months: issuance.expiryMonths,
    scope_service_ids: issuance.scopeServiceIds,
    quantity: hours,
    rate,
    total: issuance.blockPrice,
    tax_amount: taxAmount,
    tax_rate: taxRate,
    tax_region: effectiveTaxRegion,
    is_taxable: isTaxable,
    servicePeriodStart: issuance.servicePeriodStart,
    servicePeriodEnd: issuance.servicePeriodEnd,
    billingTiming: "advance",
    ...(issuance.locationId !== undefined
      ? { location_id: issuance.locationId }
      : {}),
    ...(profile
      ? {
          billing_profile_id: profile.billingProfileId,
          billing_profile_source: profile.source,
        }
      : {}),
  };

  return {
    charges: [charge],
    explanations: [
      {
        chargeKey: `prepaid_block:${issuance.issuanceId}`,
        serviceName: issuance.serviceName,
        chargeType: "prepaid_block",
        inputs: [
          { label: "Block size", value: `${formatHours(hours)} hrs` },
          {
            label: "Block price",
            value: formatMinorUnits(issuance.blockPrice, issuance.currencyCode),
          },
        ],
        steps: [
          `${formatHours(hours)} hrs block at ${formatMinorUnits(issuance.blockPrice, issuance.currencyCode)} = ${formatMinorUnits(issuance.blockPrice, issuance.currencyCode)}`,
        ],
        markers: [],
      },
    ],
  };
}

/**
 * One cadence-mode Prepaid Block: the block fee for one recurring service
 * period, billed in advance. There is no issuance; the service period record
 * is the charge's identity. All amounts are minor units of `currencyCode`.
 */
export interface CadencePrepaidBlockInput {
  /** `contract_lines.contract_line_id` carrying the block configuration. */
  contractLineId: string;
  clientContractLineId: string;
  clientContractId?: string | null;
  contractName?: string | null;
  tenant?: string;
  /** Full-period block size and price, before proration. */
  blockMinutes: number;
  blockPrice: number;
  rolloverPeriods: number;
  scopeServiceIds: string[];
  soldAsServiceId: string;
  serviceName: string;
  soldAsTaxRateId: string | null;
  /** The contract's currency. */
  currencyCode: string;
  locationId?: string | null;
  /** Date the block's tax is evaluated on. */
  taxDate: ISO8601String;
  /** The service period the block covers (end inclusive, like every charge). */
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
  servicePeriodRecordId: string | null;
  /** Share of the cadence period covered, in [0, 1]. */
  coverageRatio: number;
  /** When false the block is billed whole whatever the coverage. */
  enableProration: boolean;
  /** First and last (inclusive) day the issued block may be drawn. */
  validFrom: ISO8601String;
  expirationDate: ISO8601String;
}

export interface CadencePrepaidBlockChargeComputeInputs {
  client: ChargeComputeClient;
  block: CadencePrepaidBlockInput;
  billingProfile?: ChargeProfileAssignments | null;
}

export function computeCadencePrepaidBlockCharges(
  inputs: CadencePrepaidBlockChargeComputeInputs,
  taxContext: ChargeComputeTaxContext,
): PrepaidBlockChargeComputeResult {
  const { client, block, billingProfile } = inputs;
  const coverageRatio = block.enableProration
    ? Math.max(0, Math.min(block.coverageRatio, 1))
    : 1;
  // Hours and price scale together through the one shared coverage primitive,
  // so a part-period block is the same fraction of both.
  const blockMinutes = prorateRecurringCoverageByRatio(block.blockMinutes, coverageRatio);
  const blockPrice = prorateRecurringCoverageByRatio(block.blockPrice, coverageRatio);
  const hours = blockMinutes / 60;
  // The total is authoritative; the rate is the rounded price per hour.
  const rate = hours > 0 ? Math.round(blockPrice / hours) : 0;

  const { taxAmount, taxRate, effectiveTaxRegion, isTaxable } = computeBlockTax({
    client,
    taxContext,
    soldAsServiceId: block.soldAsServiceId,
    soldAsTaxRateId: block.soldAsTaxRateId,
    amount: blockPrice,
    taxDate: block.taxDate,
    currencyCode: block.currencyCode,
    label: `cadence prepaid block ${block.contractLineId} (${block.servicePeriodStart})`,
  });

  const profile = resolveChargeProfileFor(billingProfile);
  const charge: IPrepaidBlockCharge = {
    type: "prepaid_block",
    ...(block.tenant ? { tenant: block.tenant } : {}),
    issuance_id: null,
    contract_line_id: block.contractLineId,
    client_contract_line_id: block.clientContractLineId,
    config_id: block.contractLineId,
    client_contract_id: block.clientContractId as string,
    contract_name: block.contractName || undefined,
    serviceId: block.soldAsServiceId,
    serviceName: block.serviceName,
    block_minutes: blockMinutes,
    block_price: blockPrice,
    currency_code: block.currencyCode,
    expiry_months: null,
    scope_service_ids: block.scopeServiceIds,
    quantity: hours,
    rate,
    total: blockPrice,
    tax_amount: taxAmount,
    tax_rate: taxRate,
    tax_region: effectiveTaxRegion,
    is_taxable: isTaxable,
    servicePeriodStart: block.servicePeriodStart,
    servicePeriodEnd: block.servicePeriodEnd,
    servicePeriodRecordId: block.servicePeriodRecordId,
    billingTiming: "advance",
    valid_from: block.validFrom,
    expiration_date: block.expirationDate,
    rollover_periods: block.rolloverPeriods,
    ...(block.locationId !== undefined ? { location_id: block.locationId } : {}),
    ...(profile
      ? {
          billing_profile_id: profile.billingProfileId,
          billing_profile_source: profile.source,
        }
      : {}),
  };

  const prorated = coverageRatio < 1;
  return {
    charges: [charge],
    explanations: [
      {
        chargeKey: `prepaid_block:${block.contractLineId}:${block.servicePeriodStart}`,
        serviceName: block.serviceName,
        chargeType: "prepaid_block",
        inputs: [
          { label: "Block size", value: `${formatHours(block.blockMinutes / 60)} hrs` },
          {
            label: "Block price",
            value: formatMinorUnits(block.blockPrice, block.currencyCode),
          },
          ...(prorated
            ? [{ label: "Coverage", value: `${(coverageRatio * 100).toFixed(2)}%` }]
            : []),
        ],
        steps: [
          `${formatHours(block.blockMinutes / 60)} hrs block at ${formatMinorUnits(block.blockPrice, block.currencyCode)}`,
          ...(prorated
            ? [
                `${(coverageRatio * 100).toFixed(2)}% coverage = ${formatHours(hours)} hrs at ${formatMinorUnits(blockPrice, block.currencyCode)}`,
              ]
            : []),
        ],
        markers: prorated ? ["proration"] : [],
      },
    ],
  };
}

export interface HourBlockDrawChargeComputeInputs {
  period: { startDate: ISO8601String; endDate: ISO8601String };
  /** Allocation rows already selected for the line, in draw (FIFO) order. */
  allocations: HourBlockDrawRow[];
  clientContractLine: {
    client_contract_line_id: string;
    client_contract_id?: string | null;
    contract_name?: string | null;
    location_id?: string | null;
  };
  billingProfile?: ChargeProfileAssignments | null;
}

/** A burn row; `time_entry_id` is null when the source has no time entries. */
export type HourBlockDrawRow = HourBlockBurnRow;

export interface HourBlockDrawChargeComputeResult {
  charges: IHourBlockCharge[];
  explanations: ChargeExplanation[];
}

export function computeHourBlockDrawCharges(
  inputs: HourBlockDrawChargeComputeInputs,
): HourBlockDrawChargeComputeResult {
  const { clientContractLine: line } = inputs;
  const profile = resolveChargeProfileFor(inputs.billingProfile);
  const blocks = aggregateHourBlockBurnRows(inputs.allocations);
  const charges = computeHourBlockCharges({
    billingPeriod: inputs.period,
    blocks,
  }).charges.map(
    (charge): IHourBlockCharge => ({
      ...charge,
      client_contract_line_id: line.client_contract_line_id,
      client_contract_id: line.client_contract_id || undefined,
      contract_name: line.contract_name || undefined,
      location_id: line.location_id ?? null,
      billing_profile_id: profile?.billingProfileId ?? null,
      billing_profile_source: profile?.source ?? null,
    }),
  );
  return {
    charges,
    explanations: charges.map((charge) => ({
      chargeKey: `hour_block:${charge.block_id}`,
      serviceName: charge.serviceName,
      chargeType: "hour_block",
      inputs: [
        { label: "Hours drawn", value: `${formatHours(charge.hoursUsed)} hrs` },
        {
          label: "Hours remaining",
          value: `${formatHours(charge.hoursRemaining)} hrs`,
        },
      ],
      steps: [
        `${formatHours(charge.hoursUsed)} hrs drawn from a prepaid block (no charge)`,
      ],
      markers: [],
    })),
  };
}
