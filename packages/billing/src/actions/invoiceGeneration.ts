// @ts-nocheck
'use server'

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { requireTenantId } from '@alga-psa/db';
import { SharedNumberingService } from '@alga-psa/shared/services/numberingService';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getAnalyticsAsync } from '../lib/authHelpers';
import { BillingEngine } from '../lib/billing/billingEngine';
import ClientContractLine from '../models/clientContractLine';
import { Session } from 'next-auth';
import {
  IInvoiceCharge,
  IInvoice,
  IRecurringDueSelectionInput,
  PreviewInvoiceResponse,
  InvoiceViewModel
} from '@alga-psa/types';
import { WasmInvoiceViewModel } from '@alga-psa/types';
import { IBillingResult, IBillingCharge, IBucketCharge, IUsageBasedCharge, ITimeBasedCharge, IFixedPriceCharge, IProductCharge, ILicenseCharge, BillingCycleType } from '@alga-psa/types';
import { IClient, IClientWithLocation } from '@alga-psa/types';
import Invoice from '@alga-psa/billing/models/invoice';
import { createTenantKnex } from '@alga-psa/db';
import { Temporal } from '@js-temporal/polyfill';
import { createPDFGenerationService } from '../services/pdfGenerationService';
import { toPlainDate, toISODate, toISOTimestamp } from '@alga-psa/core';
import { ISO8601String } from '@alga-psa/types';
import { TaxService } from '../services/taxService';
import { ITaxCalculationResult } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { auditLog } from '@alga-psa/db';
import { getClientLogoUrl } from '@alga-psa/formatting/avatarUtils';
import { calculateAndDistributeTax, getClientDetails, persistInvoiceCharges, updateInvoiceTotalsAndRecordTransaction, validateClientBillingEmail } from '../services/invoiceService';




// TODO: Import these from billingAndTax.ts once created
import { getNextBillingDate, getDueDate } from './billingAndTax'; // Updated import
import { getClientDefaultTaxRegionCode } from '@alga-psa/shared/billingClients';
import { applyCreditToInvoice } from './creditActions';
import { getCurrencySymbol } from '@alga-psa/core';
import { getInitialInvoiceTaxSource, shouldUseTaxDelegation } from './taxSourceActions';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import { finalizeInvoiceWithKnex } from './invoiceModification';
import {
  computePurchaseOrderOverage,
  getClientContractPurchaseOrderContext,
  getPurchaseOrderConsumedCents
} from '@alga-psa/billing/services/purchaseOrderService';
import {
  buildClientCadenceDueSelectionInput,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import { DUPLICATE_RECURRING_INVOICE_CODE } from './invoiceGeneration.constants';
// TODO: Move these type guards to billingAndTax.ts or a shared utility file
const POSTGRES_UNDEFINED_TABLE = '42P01';

function isMissingRelationError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === POSTGRES_UNDEFINED_TABLE
  );
}

function isFixedPriceCharge(charge: IBillingCharge): charge is IFixedPriceCharge {
  return charge.type === 'fixed';
}

function isTimeBasedCharge(charge: IBillingCharge): charge is ITimeBasedCharge {
  return charge.type === 'time';
}

function isUsageBasedCharge(charge: IBillingCharge): charge is IUsageBasedCharge {
  return charge.type === 'usage';
}

function isBucketCharge(charge: IBillingCharge): charge is IBucketCharge {
  return charge.type === 'bucket';
}

function isProductCharge(charge: IBillingCharge): charge is IProductCharge {
  return charge.type === 'product';
}

function isLicenseCharge(charge: IBillingCharge): charge is ILicenseCharge {
  return charge.type === 'license';
}

function getSingleClientContractIdFromCharges(charges: IBillingCharge[]): string | null {
  const ids = Array.from(
    new Set(
      charges
        .map((c) => c.client_contract_id)
        .filter((value): value is string => Boolean(value && value.trim().length > 0))
    )
  );

  if (ids.length === 0) {
    return null;
  }
  if (ids.length > 1) {
    throw new Error(
      `Invoice spans multiple client contracts (${ids.join(', ')}). Only one client contract per invoice is supported.`
    );
  }
  return ids[0];
}

// TODO: Move to billingAndTax.ts or a shared utility file
// Uses local type guards now
function getChargeQuantity(charge: IBillingCharge): number {
  if (isBucketCharge(charge)) return charge.overageHours;
  if (isFixedPriceCharge(charge) || isUsageBasedCharge(charge)) return charge.quantity;
  if (isTimeBasedCharge(charge)) return charge.duration;
  if (isProductCharge(charge) || isLicenseCharge(charge)) return charge.quantity;
  return 1;
}

// TODO: Move to billingAndTax.ts or a shared utility file
// Uses local type guards now
function getChargeUnitPrice(charge: IBillingCharge): number {
  if (isBucketCharge(charge)) return charge.overageRate;
  return charge.rate;
}

function normalizePreviewRecurringDetailPeriods(
  item: Pick<IBillingCharge, 'recurringDetailPeriods' | 'servicePeriodStart' | 'servicePeriodEnd' | 'billingTiming'> |
    Pick<IInvoiceCharge, 'recurring_detail_periods' | 'service_period_start' | 'service_period_end' | 'billing_timing'>
) {
  const camelCaseCandidate = 'recurringDetailPeriods' in item ? item.recurringDetailPeriods : undefined;
  const snakeCaseCandidate = 'recurring_detail_periods' in item ? item.recurring_detail_periods : undefined;
  const candidate = Array.isArray(camelCaseCandidate)
    ? camelCaseCandidate
    : Array.isArray(snakeCaseCandidate)
      ? snakeCaseCandidate.map((detail) => ({
          servicePeriodStart: detail.service_period_start ?? null,
          servicePeriodEnd: detail.service_period_end ?? null,
          billingTiming: detail.billing_timing ?? null,
        }))
      : [];

  const normalized = candidate
    .map((detail) => ({
      servicePeriodStart: detail.servicePeriodStart ?? null,
      servicePeriodEnd: detail.servicePeriodEnd ?? null,
      billingTiming: detail.billingTiming ?? null,
    }))
    .filter((detail) => detail.servicePeriodStart || detail.servicePeriodEnd || detail.billingTiming)
    .sort((left, right) => {
      if (left.servicePeriodStart !== right.servicePeriodStart) {
        return String(left.servicePeriodStart ?? '').localeCompare(String(right.servicePeriodStart ?? ''));
      }
      return String(left.servicePeriodEnd ?? '').localeCompare(String(right.servicePeriodEnd ?? ''));
    });

  return normalized.length > 0 ? normalized : undefined;
}

function resolvePreviewRecurringSummary(
  item: Pick<IBillingCharge, 'recurringDetailPeriods' | 'servicePeriodStart' | 'servicePeriodEnd' | 'billingTiming'> |
    Pick<IInvoiceCharge, 'recurring_detail_periods' | 'service_period_start' | 'service_period_end' | 'billing_timing'>
) {
  const recurringDetailPeriods = normalizePreviewRecurringDetailPeriods(item);
  const explicitStart =
    'servicePeriodStart' in item ? item.servicePeriodStart : item.service_period_start;
  const explicitEnd =
    'servicePeriodEnd' in item ? item.servicePeriodEnd : item.service_period_end;
  const explicitBillingTiming =
    'billingTiming' in item ? item.billingTiming : item.billing_timing;

  const servicePeriodStart =
    explicitStart ?? recurringDetailPeriods?.[0]?.servicePeriodStart ?? null;
  const servicePeriodEnd =
    explicitEnd ?? recurringDetailPeriods?.[recurringDetailPeriods.length - 1]?.servicePeriodEnd ?? null;
  const billingTiming = explicitBillingTiming ?? (() => {
    if (!recurringDetailPeriods || recurringDetailPeriods.length === 0) {
      return null;
    }

    const timings = [...new Set(recurringDetailPeriods.map((detail) => detail.billingTiming).filter(Boolean))];
    return timings.length === 1 ? timings[0] ?? null : null;
  })();

  return {
    recurringDetailPeriods,
    servicePeriodStart,
    servicePeriodEnd,
    billingTiming,
  };
}

function buildPreviewViewModelItem(item: IInvoiceCharge) {
  const recurringSummary = resolvePreviewRecurringSummary(item);
  return {
    id: item.item_id,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    total: item.total_price,
    servicePeriodStart: recurringSummary.servicePeriodStart,
    servicePeriodEnd: recurringSummary.servicePeriodEnd,
    billingTiming: recurringSummary.billingTiming,
    recurringDetailPeriods: recurringSummary.recurringDetailPeriods,
  };
}

function hasPersistedInvoiceContent(billingResult: IBillingResult): boolean {
  return (
    (billingResult.charges?.length ?? 0) > 0 ||
    (billingResult.discounts?.length ?? 0) > 0 ||
    (billingResult.adjustments?.length ?? 0) > 0
  );
}

type RecurringBridgeMetadata = {
  billingCycleId?: string | null;
};

function resolveRecurringInvoiceBridgeId(bridgeMetadata?: RecurringBridgeMetadata | null): string | null {
  return bridgeMetadata?.billingCycleId ?? null;
}

function buildLegacyBillingWindowSelectionInput(input: {
  clientId: string;
  windowStart: ISO8601String;
  windowEnd: ISO8601String;
}): IRecurringDueSelectionInput {
  return {
    clientId: input.clientId,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    executionWindow: {
      kind: 'client_cadence_window',
      cadenceOwner: 'client',
      clientId: input.clientId,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      identityKey: `legacy_client_cadence_window:client:${input.clientId}:${input.windowStart}:${input.windowEnd}`,
    },
  };
}

function normalizeRecurringWindowDate(value: ISO8601String): ISO8601String {
  return toISODate(toPlainDate(value));
}

function buildRecurringWindowErrorContext(
  selectorInput: IRecurringDueSelectionInput,
  bridgeMetadata?: RecurringBridgeMetadata,
) {
  return {
    executionIdentityKey: selectorInput.executionWindow.identityKey,
    billingCycleId: resolveRecurringInvoiceBridgeId(bridgeMetadata),
  };
}

function withRecurringWindowErrorContext<T extends Error>(
  error: T,
  selectorInput: IRecurringDueSelectionInput,
  bridgeMetadata?: RecurringBridgeMetadata,
): T {
  Object.assign(error, buildRecurringWindowErrorContext(selectorInput, bridgeMetadata));
  return error;
}

function buildPreviewInvoiceFailure(
  selectorInput: IRecurringDueSelectionInput,
  error: string,
  bridgeMetadata?: RecurringBridgeMetadata,
): PreviewInvoiceResponse {
  return {
    success: false,
    error,
    ...buildRecurringWindowErrorContext(selectorInput, bridgeMetadata),
  };
}

function buildDuplicateRecurringInvoiceError(input: {
  selectorInput: IRecurringDueSelectionInput;
  invoiceId: string;
  bridgeMetadata?: RecurringBridgeMetadata;
}): Error {
  const billingCycleId = resolveRecurringInvoiceBridgeId(input.bridgeMetadata);
  const error = new Error(
    'Invoice already exists for this recurring execution window',
  );

  Object.assign(error, {
    code: DUPLICATE_RECURRING_INVOICE_CODE,
    billingCycleId,
    executionIdentityKey: input.selectorInput.executionWindow.identityKey,
    invoiceId: input.invoiceId,
  });

  return error;
}

async function findExistingRecurringInvoiceForSelectionInput(params: {
  knex: Knex;
  tenant: string;
  selectorInput: IRecurringDueSelectionInput;
}): Promise<{ invoiceId: string } | null> {
  const executionWindow = params.selectorInput.executionWindow;
  if (
    executionWindow.kind === 'client_cadence_window'
    && executionWindow.scheduleKey
    && executionWindow.periodKey
  ) {
    const linkedRow = await withTransaction(params.knex, async (trx: Knex.Transaction) => {
      return trx('recurring_service_periods')
        .where({
          tenant: params.tenant,
          cadence_owner: 'client',
          schedule_key: executionWindow.scheduleKey,
          period_key: executionWindow.periodKey,
          invoice_window_start: params.selectorInput.windowStart,
          invoice_window_end: params.selectorInput.windowEnd,
        })
        .whereNotNull('invoice_id')
        .first('invoice_id');
    });

    return linkedRow?.invoice_id ? { invoiceId: linkedRow.invoice_id } : null;
  }

  if (
    executionWindow.kind === 'contract_cadence_window'
    && executionWindow.contractLineId
  ) {
    const linkedRow = await withTransaction(params.knex, async (trx: Knex.Transaction) => {
      return trx('recurring_service_periods')
        .where({
          tenant: params.tenant,
          obligation_type: 'contract_line',
          obligation_id: executionWindow.contractLineId,
          invoice_window_start: params.selectorInput.windowStart,
          invoice_window_end: params.selectorInput.windowEnd,
        })
        .whereNotNull('invoice_id')
        .first('invoice_id');
    });

    return linkedRow?.invoice_id ? { invoiceId: linkedRow.invoice_id } : null;
  }

  return null;
}

async function resolveCanonicalClientCadenceSelectorInput(params: {
  knex: Knex;
  tenant: string;
  clientId: string;
  windowStart: ISO8601String;
  windowEnd: ISO8601String;
}): Promise<IRecurringDueSelectionInput> {
  const normalizedWindowStart = normalizeRecurringWindowDate(params.windowStart);
  const normalizedWindowEnd = normalizeRecurringWindowDate(params.windowEnd);

  const recurringServicePeriod = await withTransaction(
    params.knex,
    async (trx: Knex.Transaction) =>
      trx('recurring_service_periods as rsp')
        .join('client_contract_lines as ccl', function () {
          this.on('ccl.client_contract_line_id', '=', 'rsp.obligation_id')
            .andOn('ccl.tenant', '=', 'rsp.tenant');
        })
        .where({
          'rsp.tenant': params.tenant,
          'rsp.cadence_owner': 'client',
          'rsp.obligation_type': 'client_contract_line',
          'ccl.client_id': params.clientId,
          'rsp.invoice_window_start': normalizedWindowStart,
          'rsp.invoice_window_end': normalizedWindowEnd,
        })
        .whereNotIn('rsp.lifecycle_state', ['archived', 'superseded'])
        .orderBy('rsp.service_period_start', 'asc')
        .orderBy('rsp.revision', 'asc')
        .first('rsp.schedule_key', 'rsp.period_key'),
  );

  if (!recurringServicePeriod?.schedule_key || !recurringServicePeriod?.period_key) {
    throw new Error(
      'Recurring service periods were not materialized for this client billing schedule window.',
    );
  }

  return buildClientCadenceDueSelectionInput({
    clientId: params.clientId,
    scheduleKey: recurringServicePeriod.schedule_key,
    periodKey: recurringServicePeriod.period_key,
    windowStart: normalizedWindowStart,
    windowEnd: normalizedWindowEnd,
  });
}

async function normalizeRecurringSelectorInput(params: {
  knex: Knex;
  tenant: string;
  selectorInput: IRecurringDueSelectionInput;
}): Promise<IRecurringDueSelectionInput> {
  return params.selectorInput;
}

// TODO: Move to billingAndTax.ts
async function calculatePreviewTax(
  charges: IBillingCharge[],
  clientId: string,
  cycleEnd: ISO8601String,
  defaultTaxRegion: string
): Promise<number> {
  // Sum the pre-calculated tax amounts from the BillingEngine charges
  // BillingEngine already handles multi-region tax allocation for fixed fees
  // and calculates tax for other charge types.
  let totalTax = 0;
  for (const charge of charges) {
    // Add the tax_amount if it exists and is greater than 0
    if (charge.tax_amount && charge.tax_amount > 0) {
      totalTax += charge.tax_amount;
    }
  }
  console.log(`[calculatePreviewTax] Summed pre-calculated tax: ${totalTax}`);

  return totalTax;
}

export async function calculateBillingForInvoiceWindow(input: {
  billingEngine: BillingEngine;
  clientId: string;
  cycleStart: ISO8601String;
  cycleEnd: ISO8601String;
  billingCycleId: string;
}) {
  return calculateBillingForSelectionInput({
    billingEngine: input.billingEngine,
    selectorInput: buildLegacyBillingWindowSelectionInput({
      clientId: input.clientId,
      windowStart: input.cycleStart,
      windowEnd: input.cycleEnd,
    }),
  });
}

export async function calculateBillingForSelectionInput(input: {
  billingEngine: BillingEngine;
  selectorInput: IRecurringDueSelectionInput;
}) {
  const recurringTimingSelections =
    await input.billingEngine.selectDueRecurringServicePeriodsForBillingWindow(
      input.selectorInput.clientId,
      input.selectorInput.windowStart,
      input.selectorInput.windowEnd,
    );

  return input.billingEngine.calculateBillingForExecutionWindow(
    input.selectorInput.clientId,
    input.selectorInput.windowStart,
    input.selectorInput.windowEnd,
    {
      recurringTimingSelections,
      recurringTimingSelectionSource: 'persisted',
    },
  );
}

export type PurchaseOrderOverageDecision = 'allow' | 'skip';

export type PurchaseOrderOverageResult = {
  client_contract_id: string;
  po_number: string | null;
  authorized_cents: number;
  consumed_cents: number;
  remaining_cents: number;
  invoice_total_cents: number;
  overage_cents: number;
};

async function getPurchaseOrderOverageForSelectionInputInternal(params: {
  knex: Knex;
  tenant: string;
  selectorInput: IRecurringDueSelectionInput;
}): Promise<PurchaseOrderOverageResult | null> {
  const { knex, tenant } = params;
  const selectorInput = await normalizeRecurringSelectorInput(params);
  const client_id = selectorInput.clientId;
  const cycleEnd = selectorInput.windowEnd;

  const billingEngine = new BillingEngine();
  const billingResult = await calculateBillingForSelectionInput({
    billingEngine,
    selectorInput,
  });
  if (billingResult.error) {
    throw new Error(billingResult.error);
  }

  const clientContractId = getSingleClientContractIdFromCharges(billingResult.charges);
  if (!clientContractId) {
    return null;
  }

  const poContext = await getClientContractPurchaseOrderContext({
    knex,
    tenant,
    clientContractId,
  });

  if (poContext.po_amount == null) {
    return null;
  }

  const client = await getClientDetails(knex, tenant, client_id);
  const defaultRegion = await getClientDefaultTaxRegionCode(knex, tenant, client_id);
  const previewTax = await calculatePreviewTax(
    billingResult.charges,
    client_id,
    cycleEnd,
    defaultRegion || client?.tax_region || '',
  );
  const invoiceTotal = Math.trunc(billingResult.totalAmount + previewTax);

  const consumed = await getPurchaseOrderConsumedCents({ knex, tenant, clientContractId });
  const computed = computePurchaseOrderOverage({
    authorizedCents: poContext.po_amount,
    consumedCents: consumed,
    invoiceTotalCents: invoiceTotal,
  });

  return {
    client_contract_id: clientContractId,
    po_number: poContext.po_number,
    authorized_cents: computed.authorizedCents,
    consumed_cents: computed.consumedCents,
    remaining_cents: computed.remainingCents,
    invoice_total_cents: computed.invoiceTotalCents,
    overage_cents: computed.overageCents,
  };
}

export const getPurchaseOrderOverageForSelectionInput = withAuth(async (
  user,
  { tenant },
  selectorInput: IRecurringDueSelectionInput,
): Promise<PurchaseOrderOverageResult | null> => {
  const { knex } = await createTenantKnex();

  if (!hasPermission(user, 'invoice', 'create') && !hasPermission(user, 'invoice', 'generate')) {
    throw new Error('Permission denied: Cannot generate invoices');
  }

  return getPurchaseOrderOverageForSelectionInputInternal({
    knex,
    tenant,
    selectorInput,
  });
});

export const getPurchaseOrderOverageForBillingCycle = withAuth(async (
  user,
  { tenant },
  billing_cycle_id: string
): Promise<PurchaseOrderOverageResult | null> => {
  const { knex } = await createTenantKnex();

  const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
    if (!hasPermission(user, 'invoice', 'create') && !hasPermission(user, 'invoice', 'generate')) {
      throw new Error('Permission denied: Cannot generate invoices');
    }

    return await trx('client_billing_cycles')
      .where({ billing_cycle_id, tenant })
      .first();
  });

  if (!billingCycle) {
    throw new Error('Billing cycle not found');
  }

  const { client_id, period_start_date, period_end_date, effective_date } = billingCycle;

  let cycleStart: ISO8601String;
  let cycleEnd: ISO8601String;

  if (period_start_date && period_end_date) {
    cycleStart = toISOTimestamp(toPlainDate(period_start_date));
    cycleEnd = toISOTimestamp(toPlainDate(period_end_date));
  } else if (effective_date) {
    const effectiveDateUTC = toISOTimestamp(toPlainDate(effective_date));
    cycleStart = effectiveDateUTC;
    cycleEnd = await getNextBillingDate(client_id, effectiveDateUTC);
  } else {
    throw new Error('Invalid billing cycle dates');
  }

  return getPurchaseOrderOverageForSelectionInputInternal({
    knex,
    tenant,
    selectorInput: await resolveCanonicalClientCadenceSelectorInput({
      knex,
      tenant,
      clientId: client_id,
      windowStart: cycleStart,
      windowEnd: cycleEnd,
    }),
  });
});

// TODO: Move to billingAndTax.ts
async function calculateChargeDetails(
  charge: IBillingCharge,
  clientId: string,
  endDate: ISO8601String,
  taxService: TaxService,
  defaultTaxRegion: string
): Promise<{ netAmount: number; taxCalculationResult: ITaxCalculationResult }> {
  let netAmount: number;

  if ('overageHours' in charge && 'overageRate' in charge) {
    const bucketCharge = charge as IBucketCharge;
    netAmount = bucketCharge.overageHours > 0 ? Math.ceil(bucketCharge.total) : 0;
  } else {
    netAmount = Math.ceil(charge.total);
  }

  let taxCalculationResult: ITaxCalculationResult;

  // Check if it's a fixed price charge with pre-calculated tax
  if (isFixedPriceCharge(charge) && charge.tax_amount !== undefined && charge.tax_rate !== undefined) {
    // Use the pre-calculated tax from BillingEngine for fixed fee charges
    taxCalculationResult = {
      taxAmount: charge.tax_amount,
      taxRate: charge.tax_rate,
    };
  } else {
    // Otherwise, calculate tax (for time, usage, etc., or if fixed fee somehow missed pre-calc)
    taxCalculationResult = charge.is_taxable !== false && netAmount > 0
      ? await taxService.calculateTax(
        clientId,
        netAmount,
        endDate,
        charge.tax_region || defaultTaxRegion
      )
      : { taxAmount: 0, taxRate: 0 };
  }
  return { netAmount, taxCalculationResult };
}

// TODO: Move to billingAndTax.ts
function getPaymentTermDays(paymentTerms: string): number {
  switch (paymentTerms) {
    case 'net_30':
      return 30;
    case 'net_15':
      return 15;
    case 'due_on_receipt':
      return 0;
    default:
      return 30; // Default to 30 days if unknown payment term
  }
}

// Adapter function to convert data to WasmInvoiceViewModel
async function adaptToWasmViewModel(
  billingResult: IBillingResult,
  client: IClientWithLocation | null,
  invoiceItems: IInvoiceCharge[],
  dueDate: string,
  previewTax: number,
  tenant: string | null // Added tenant for fetching tenant client info
): Promise<WasmInvoiceViewModel> {
  // Fetch Tenant Client Info (similar logic to getFullInvoiceById)
  let tenantClientInfo: { name: any; address: any; logoUrl: string | null } | null = null;
  let poNumber: string | null = null;
  if (tenant) {
    const { knex } = await createTenantKnex(tenant); // Get knex instance again if needed
    const tenantClientLink = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('tenant_companies')
        .where({ tenant: tenant, is_default: true })
        .select('client_id')
        .first();
    });

    if (tenantClientLink) {
      const tenantClientDetails = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('clients as c')
          .leftJoin('client_locations as cl', function() {
            this.on('c.client_id', '=', 'cl.client_id')
                .andOn('c.tenant', '=', 'cl.tenant')
                .andOn('cl.is_default', '=', trx.raw('true'));
          })
          .select(
            'c.client_name',
            'cl.address_line1 as address'
          )
          .where({
            'c.client_id': tenantClientLink.client_id,
            'c.tenant': tenant
          })
          .first();
      });

      if (tenantClientDetails) {
        const logoUrl = await getClientLogoUrl(tenantClientLink.client_id, tenant);
        tenantClientInfo = {
          name: tenantClientDetails.client_name,
          address: tenantClientDetails.address || 'N/A',
          logoUrl: logoUrl || null, // Use null if logoUrl is empty/null
        };
      }
    }

    const clientContractId = getSingleClientContractIdFromCharges(billingResult.charges);
    if (clientContractId) {
      poNumber = (await getClientContractPurchaseOrderContext({ knex, tenant, clientContractId })).po_number;
    }
  }

  const previewViewModelItems = invoiceItems.map(buildPreviewViewModelItem);

  return {
    invoiceNumber: 'PREVIEW',
    issueDate: toISODate(Temporal.Now.plainDateISO()),
    dueDate: dueDate,
    currencyCode: billingResult.currency_code || 'USD',
    poNumber,
    customer: {
      name: client?.client_name || 'N/A',
      address: client?.location_address || 'N/A',
    },
    tenantClient: tenantClientInfo, // Use fetched tenant client info
    items: previewViewModelItems,
    subtotal: billingResult.totalAmount,
    tax: previewTax,
    total: billingResult.totalAmount + previewTax,
    // notes: undefined, // Add if needed
  };
}

async function buildPreviewInvoiceForSelectionInput(params: {
  knex: Knex;
  tenant: string;
  selectorInput: IRecurringDueSelectionInput;
}): Promise<WasmInvoiceViewModel> {
  const { knex, tenant, selectorInput } = params;
  const client_id = selectorInput.clientId;
  const cycleEnd = selectorInput.windowEnd;
  const previewInvoiceKey = selectorInput.executionWindow.identityKey;

  const clientForValidation = await knex('clients')
    .where({ client_id, tenant })
    .select('client_name')
    .first();

  if (clientForValidation) {
    const emailValidation = await validateClientBillingEmail(
      knex,
      tenant,
      client_id,
      clientForValidation.client_name,
    );
    if (!emailValidation.valid) {
      throw withRecurringWindowErrorContext(new Error(emailValidation.error!), selectorInput);
    }
  }

  const billingEngine = new BillingEngine();
  const billingResult = await calculateBillingForSelectionInput({
    billingEngine,
    selectorInput,
  });

  if (billingResult.error) {
    throw withRecurringWindowErrorContext(new Error(billingResult.error), selectorInput);
  }

  if (billingResult.charges.length === 0) {
    throw withRecurringWindowErrorContext(new Error('Nothing to bill'), selectorInput);
  }

  const client = await getClientDetails(knex, tenant, client_id);
  const due_date = await getDueDate(client_id, cycleEnd);
  const chargesByContractGroup: { [key: string]: IBillingCharge[] } = {};
  const nonContractAssociatedCharges: IBillingCharge[] = [];

  for (const charge of billingResult.charges) {
    if (charge.client_contract_id && charge.contract_name) {
      const contractKey = charge.contract_name;
      if (!chargesByContractGroup[contractKey]) {
        chargesByContractGroup[contractKey] = [];
      }
      chargesByContractGroup[contractKey].push(charge);
    } else {
      nonContractAssociatedCharges.push(charge);
    }
  }

  const invoiceItems: IInvoiceCharge[] = [];

  nonContractAssociatedCharges.forEach(charge => {
    const recurringSummary = resolvePreviewRecurringSummary(charge);
    invoiceItems.push({
      item_id: 'preview-' + uuidv4(),
      invoice_id: `preview-${previewInvoiceKey}`,
      service_id: charge.serviceId,
      description: charge.serviceName || 'Charge',
      quantity: getChargeQuantity(charge),
      unit_price: getChargeUnitPrice(charge),
      total_price: charge.total,
      tax_amount: charge.tax_amount || 0,
      tax_rate: charge.tax_rate || 0,
      tax_region: charge.tax_region || '',
      net_amount: charge.total - (charge.tax_amount || 0),
      is_manual: false,
      rate: charge.rate,
      service_period_start: recurringSummary.servicePeriodStart,
      service_period_end: recurringSummary.servicePeriodEnd,
      billing_timing: recurringSummary.billingTiming,
      recurring_detail_periods: recurringSummary.recurringDetailPeriods?.map((period) => ({
        service_period_start: period.servicePeriodStart ?? null,
        service_period_end: period.servicePeriodEnd ?? null,
        billing_timing: period.billingTiming ?? null,
      })),
    });
  });

  for (const [contractKey, charges] of Object.entries(chargesByContractGroup)) {
    const contractGroupName = contractKey;
    const clientContractGroupId = charges[0].client_contract_id;
    const contractGroupHeaderId = 'preview-' + uuidv4();
    invoiceItems.push({
      item_id: contractGroupHeaderId,
      invoice_id: `preview-${previewInvoiceKey}`,
      description: `Contract: ${contractGroupName}`,
      quantity: 1,
      unit_price: 0,
      total_price: 0,
      net_amount: 0,
      tax_amount: 0,
      tax_rate: 0,
      is_manual: false,
      is_bundle_header: true,
      client_contract_id: clientContractGroupId,
      contract_name: contractGroupName,
      rate: 0
    });

    charges.forEach(charge => {
      const recurringSummary = resolvePreviewRecurringSummary(charge);
      let description = charge.serviceName;
      if (isBucketCharge(charge)) {
        const hoursIncluded = charge.hoursUsed - charge.overageHours;
        const currencySymbol = getCurrencySymbol(billingResult.currency_code || 'USD');
        if (charge.overageHours > 0) {
          description = `${charge.serviceName} - ${charge.hoursUsed.toFixed(2)} hrs used (${hoursIncluded.toFixed(2)} hrs included + ${charge.overageHours.toFixed(2)} hrs overage @ ${currencySymbol}${(charge.overageRate / 100).toFixed(2)}/hr)`;
        } else {
          description = `${charge.serviceName} - ${charge.hoursUsed.toFixed(2)} hrs used (within ${hoursIncluded.toFixed(2)} hrs included)`;
        }
      }

      invoiceItems.push({
        item_id: 'preview-' + uuidv4(),
        invoice_id: `preview-${previewInvoiceKey}`,
        service_id: charge.serviceId,
        description: description,
        quantity: getChargeQuantity(charge),
        unit_price: getChargeUnitPrice(charge),
        total_price: charge.total,
        tax_amount: charge.tax_amount || 0,
        tax_rate: charge.tax_rate || 0,
        tax_region: charge.tax_region || '',
        net_amount: charge.total - (charge.tax_amount || 0),
        is_manual: false,
        client_contract_id: clientContractGroupId,
        contract_name: contractGroupName,
        parent_item_id: contractGroupHeaderId,
        rate: charge.rate,
        service_period_start: recurringSummary.servicePeriodStart,
        service_period_end: recurringSummary.servicePeriodEnd,
        billing_timing: recurringSummary.billingTiming,
        recurring_detail_periods: recurringSummary.recurringDetailPeriods?.map((period) => ({
          service_period_start: period.servicePeriodStart ?? null,
          service_period_end: period.servicePeriodEnd ?? null,
          billing_timing: period.billingTiming ?? null,
        })),
      });
    });
  }

  const previewTax = await calculatePreviewTax(
    billingResult.charges,
    client_id,
    cycleEnd,
    client?.tax_region || '',
  );

  return adaptToWasmViewModel(
    billingResult,
    client,
    invoiceItems,
    due_date,
    previewTax,
    tenant,
  );
}

export const previewInvoiceForSelectionInput = withAuth(async (
  user,
  { tenant },
  selectorInput: IRecurringDueSelectionInput,
): Promise<PreviewInvoiceResponse> => {
  const { knex } = await createTenantKnex();
  let normalizedSelectorInput = selectorInput;

  try {
    if (!hasPermission(user, 'invoice', 'create') && !hasPermission(user, 'invoice', 'generate')) {
      throw new Error('Permission denied: Cannot preview invoices');
    }
    normalizedSelectorInput = await normalizeRecurringSelectorInput({
      knex,
      tenant,
      selectorInput,
    });
    return {
      success: true,
      data: await buildPreviewInvoiceForSelectionInput({
        knex,
        tenant,
        selectorInput: normalizedSelectorInput,
      }),
    };
  } catch (error) {
    return buildPreviewInvoiceFailure(
      normalizedSelectorInput,
      error instanceof Error ? error.message : 'An error occurred while previewing the invoice',
    );
  }
});

export const previewInvoice = withAuth(async (
  user,
  { tenant },
  billing_cycle_id: string
): Promise<PreviewInvoiceResponse> => {
  const { knex } = await createTenantKnex();
  let selectorInput: IRecurringDueSelectionInput | null = null;

  try {
    if (!hasPermission(user, 'invoice', 'create') && !hasPermission(user, 'invoice', 'generate')) {
      throw new Error('Permission denied: Cannot preview invoices');
    }

    const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('client_billing_cycles')
        .where({
          billing_cycle_id,
          tenant
        })
        .first();
    });

    if (!billingCycle) {
      return {
        success: false,
        error: 'Invalid billing cycle'
      };
    }

    const { client_id, period_start_date, period_end_date, effective_date } = billingCycle;

    let cycleStart: ISO8601String;
    let cycleEnd: ISO8601String;

    if (period_start_date && period_end_date) {
      cycleStart = normalizeRecurringWindowDate(period_start_date);
      cycleEnd = normalizeRecurringWindowDate(period_end_date);
    } else if (effective_date) {
      cycleStart = normalizeRecurringWindowDate(effective_date);
      cycleEnd = normalizeRecurringWindowDate(
        await getNextBillingDate(client_id, cycleStart),
      );
    } else {
      throw new Error('Invalid billing cycle dates');
    }

    selectorInput = await resolveCanonicalClientCadenceSelectorInput({
      knex,
      tenant,
      clientId: client_id,
      windowStart: cycleStart,
      windowEnd: cycleEnd,
    });

    return {
      success: true,
      data: await buildPreviewInvoiceForSelectionInput({
        knex,
        tenant,
        selectorInput,
      })
    };
  } catch (error) {
    return selectorInput
      ? buildPreviewInvoiceFailure(
          selectorInput,
          error instanceof Error ? error.message : 'An error occurred while previewing the invoice',
          { billingCycleId: billing_cycle_id },
        )
      : {
          success: false,
          error: error instanceof Error ? error.message : 'An error occurred while previewing the invoice'
        };
  }
});

// Update return type to the interface InvoiceViewModel
export const generateInvoice = withAuth(async (
  user,
  { tenant },
  billing_cycle_id: string,
  options: { allowPoOverage?: boolean } = {}
): Promise<InvoiceViewModel | null> => {
  // Get billing cycle details
  const { knex } = await createTenantKnex();

  const billingCycle = await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check permissions within transaction
    if (!hasPermission(user, 'invoice', 'create') && !hasPermission(user, 'invoice', 'generate')) {
      throw new Error('Permission denied: Cannot generate invoices');
    }

    return await trx('client_billing_cycles')
      .where({
        billing_cycle_id,
        tenant
      })
      .first();
  });

  if (!billingCycle) {
    throw new Error('Billing cycle not found');
  }

  const { client_id, period_start_date, period_end_date, effective_date } = billingCycle;

  let cycleStart: ISO8601String;
  let cycleEnd: ISO8601String;

  if (period_start_date && period_end_date) {
    cycleStart = normalizeRecurringWindowDate(period_start_date);
    cycleEnd = normalizeRecurringWindowDate(period_end_date);
  } else if (effective_date) {
    cycleStart = normalizeRecurringWindowDate(effective_date);
    cycleEnd = normalizeRecurringWindowDate(
      await getNextBillingDate(client_id, cycleStart),
    );
  } else {
    throw new Error('Invalid billing cycle dates');
  }

  const selectorInput = await resolveCanonicalClientCadenceSelectorInput({
    knex,
    tenant,
    clientId: client_id,
    windowStart: cycleStart,
    windowEnd: cycleEnd,
  });

  return generateInvoiceForSelectionInput(
    selectorInput,
    options,
    { billingCycleId: billing_cycle_id },
  );
});

export const generateInvoiceForSelectionInput = withAuth(async (
  user,
  { tenant },
  selectorInput: IRecurringDueSelectionInput,
  options: { allowPoOverage?: boolean } = {},
  bridgeMetadata?: RecurringBridgeMetadata,
): Promise<InvoiceViewModel | null> => {
  const { knex } = await createTenantKnex();
  const normalizedSelectorInput = await normalizeRecurringSelectorInput({
    knex,
    tenant,
    selectorInput,
  });
  const billing_cycle_id = resolveRecurringInvoiceBridgeId(bridgeMetadata);
  const executionIdentityKey = normalizedSelectorInput.executionWindow.identityKey;
  const client_id = normalizedSelectorInput.clientId;
  const cycleStart = normalizedSelectorInput.windowStart;
  const cycleEnd = normalizedSelectorInput.windowEnd;

  // Validate that the client has a billing email (required for online payments)
  const clientForValidation = await knex('clients')
    .where({ client_id, tenant })
    .select('client_name')
    .first();

  if (clientForValidation) {
    const emailValidation = await validateClientBillingEmail(knex, tenant, client_id, clientForValidation.client_name);
    if (!emailValidation.valid) {
      throw withRecurringWindowErrorContext(
        new Error(emailValidation.error),
        normalizedSelectorInput,
        bridgeMetadata,
      );
    }
  }

  const existingInvoice = await findExistingRecurringInvoiceForSelectionInput({
    knex,
    tenant,
    selectorInput: normalizedSelectorInput,
  });

  if (existingInvoice) {
    throw buildDuplicateRecurringInvoiceError({
      selectorInput: normalizedSelectorInput,
      invoiceId: existingInvoice.invoiceId,
      bridgeMetadata,
    });
  }

  const billingEngine = new BillingEngine();
  const billingResult = await calculateBillingForSelectionInput({
    billingEngine,
    selectorInput: {
      ...normalizedSelectorInput,
      clientId: client_id,
      windowStart: cycleStart,
      windowEnd: cycleEnd,
    },
  });

  if (billingResult.error) {
    throw withRecurringWindowErrorContext(
      new Error(billingResult.error),
      normalizedSelectorInput,
      bridgeMetadata,
    );
  }

  const clientContractId = getSingleClientContractIdFromCharges(billingResult.charges);
  if (clientContractId) {
    const poContext = await getClientContractPurchaseOrderContext({
      knex,
      tenant,
      clientContractId
    });

    if (poContext.po_required && !poContext.po_number) {
      throw withRecurringWindowErrorContext(
        new Error(
          'Purchase Order is required for this contract but has not been provided. Please add a PO number to the contract before generating invoices.'
        ),
        normalizedSelectorInput,
        bridgeMetadata,
      );
    }

    if (poContext.po_amount != null) {
      const defaultRegion = await getClientDefaultTaxRegionCode(knex, tenant, client_id);
      const previewTax = await calculatePreviewTax(
        billingResult.charges,
        client_id,
        cycleEnd,
        defaultRegion || ''
      );
      const invoiceTotal = Math.trunc(billingResult.totalAmount + previewTax);

      const consumed = await getPurchaseOrderConsumedCents({ knex, tenant, clientContractId });
      const computed = computePurchaseOrderOverage({
        authorizedCents: poContext.po_amount,
        consumedCents: consumed,
        invoiceTotalCents: invoiceTotal,
      });

      if (computed.overageCents > 0 && !options.allowPoOverage) {
        const currencyCode = billingResult.currency_code || 'USD';
        console.warn(
          `[generateInvoice] PO overage detected (client_contract_id=${clientContractId}). ` +
            `Over by ${formatCurrencyFromMinorUnits(computed.overageCents, 'en-US', currencyCode)}; continuing because PO limits are advisory.`
        );
      }
    }
  }

  // Get zero-dollar invoice settings
  const clientSettings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('client_billing_settings')
      .where({ client_id: client_id, tenant })
      .first();
  });

  const defaultSettings = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('default_billing_settings')
      .where({ tenant: tenant })
      .first();
  });

  const settings = clientSettings || defaultSettings;

  if (!settings) {
    throw new Error('No billing settings found');
  }

  const zeroDollarInvoice = billingResult.finalAmount === 0;
  const zeroDollarHasPersistableContent = hasPersistedInvoiceContent(billingResult);

  // Handle zero-dollar invoices. Empty windows may still be suppressed, but
  // zero-dollar invoices with real persisted billing content must be created so
  // canonical recurring detail rows and other financial artifacts are not lost.
  if (zeroDollarInvoice) {
    if (settings.suppress_zero_dollar_invoices && !zeroDollarHasPersistableContent) {
      return null;
    }

    const createdInvoice = await createInvoiceFromBillingResult( // Uses local function
      billingResult,
      client_id,
      cycleStart,
      cycleEnd,
      billing_cycle_id,
      user.user_id
    );

    if (settings.zero_dollar_invoice_handling === 'finalized') {
      await finalizeInvoiceWithKnex(createdInvoice.invoice_id, knex, tenant, user.user_id);
    }

console.log(`[generateInvoice] Zero-dollar invoice created (${createdInvoice.invoice_id}). Fetching full ViewModel before returning.`);
    return await Invoice.getFullInvoiceById(knex, tenant, createdInvoice.invoice_id);
  }

  if (billingResult.charges.length === 0) {
    throw withRecurringWindowErrorContext(
      new Error('Nothing to bill'),
      normalizedSelectorInput,
      bridgeMetadata,
    );
  }

  for (const charge of billingResult.charges) {
    if (charge.rate === undefined || charge.rate === null) {
      throw withRecurringWindowErrorContext(
        new Error(`Service "${charge.serviceName}" has an undefined rate`),
        normalizedSelectorInput,
        bridgeMetadata,
      );
    }
  }

  const createdInvoice = await createInvoiceFromBillingResult( // Uses local function
    billingResult,
    client_id,
    cycleStart,
    cycleEnd,
    billing_cycle_id,
    user.user_id
  );

  // Get the next billing date as a PlainDate string (YYYY-MM-DD)
  const nextBillingDateStr = await getNextBillingDate(client_id, cycleEnd); // Uses temporary import

  // Convert the PlainDate string to a proper ISO 8601 timestamp for rolloverUnapprovedTime
  const nextBillingDate = toPlainDate(nextBillingDateStr);
  const nextBillingTimestamp = toISOTimestamp(nextBillingDate);

  // Pass the ISO timestamp to rolloverUnapprovedTime
  await billingEngine.rolloverUnapprovedTime(client_id, cycleEnd, nextBillingTimestamp);

console.log(`[generateInvoice] Regular invoice created (${createdInvoice.invoice_id}). Fetching full ViewModel before returning.`);
  let invoiceView = await Invoice.getFullInvoiceById(knex, tenant, createdInvoice.invoice_id);

  return invoiceView;
});

export const generateInvoiceNumber = withAuth(async (
  user,
  { tenant },
  _trx?: Knex.Transaction
): Promise<string> => {
  // Check permissions
  if (!hasPermission(user, 'invoice', 'create') && !hasPermission(user, 'invoice', 'generate')) {
    throw new Error('Permission denied: Cannot generate invoice numbers');
  }

  const { knex } = await createTenantKnex();
  return SharedNumberingService.getNextNumber('INVOICE', {
    knex: _trx ?? knex,
    tenant,
  });
});

export const generateInvoicePDF = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<{ file_id: string }> => {
  const { knex } = await createTenantKnex();

  // Check permissions
  if (!hasPermission(user, 'invoice', 'create') && !hasPermission(user, 'invoice', 'generate')) {
    throw new Error('Permission denied: Cannot generate invoice PDFs');
  }

  // Use the factory function to create the PDF generation service
  const pdfGenerationService = createPDFGenerationService(tenant);

  const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('invoices')
      .where({ invoice_id: invoiceId, tenant })
      .first(['invoice_number']);
  });

  if (!invoice?.invoice_number) {
    throw new Error('Invoice not found');
  }

  const fileRecord = await pdfGenerationService.generateAndStore({
    invoiceId,
    invoiceNumber: invoice.invoice_number,
    userId: user.user_id
  });

  return { file_id: fileRecord.file_id };
});

export const downloadInvoicePDF = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<{ pdfData: number[]; invoiceNumber: string }> => {
  try {
    console.log('[downloadInvoicePDF] Called with invoiceId:', invoiceId);

    const { knex } = await createTenantKnex();

    // Check permissions
    if (!hasPermission(user, 'invoice', 'read')) {
      throw new Error('Permission denied: Cannot download invoice PDFs');
    }

    // Get invoice details
    const invoice = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoices')
        .where({ invoice_id: invoiceId, tenant })
        .first();
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    console.log('[downloadInvoicePDF] Generating PDF for invoice:', invoice.invoice_number);
    // Use the PDF generation service to generate the PDF
    const pdfGenerationService = createPDFGenerationService(tenant);

    const pdfBuffer = await pdfGenerationService.generatePDF({
      invoiceId,
      userId: user.user_id
    });

    console.log('[downloadInvoicePDF] PDF generated, size:', pdfBuffer.length, 'bytes');
    // Convert Buffer to plain array for serialization across server/client boundary
    return {
      pdfData: Array.from(pdfBuffer),
      invoiceNumber: invoice.invoice_number
    };
  } catch (error) {
    console.error('[downloadInvoicePDF] Error:', error);
    console.error('[downloadInvoicePDF] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    throw error;
  }
});

export const createInvoiceFromBillingResult = withAuth(async (
  user,
  { tenant },
  billingResult: IBillingResult,
  clientId: string,
  cycleStart: ISO8601String,
  cycleEnd: ISO8601String,
  billing_cycle_id: string | null,
  userId: string
): Promise<IInvoice> => {
  // Verify that the userId matches the current user
  if (user.user_id !== userId) {
    throw new Error('Permission denied: User ID mismatch');
  }

  const { knex } = await createTenantKnex();

  const client = await getClientDetails(knex, tenant, clientId);
  let region_code = await getClientDefaultTaxRegionCode(knex, tenant, clientId);
  const taxService = new TaxService();

  if (!region_code) {
    console.warn(`[createInvoiceFromBillingResult] Client ${clientId} (${client.client_name}) has no default tax region. Attempting to create default tax settings automatically.`);
    try {
      await taxService.ensureDefaultTaxSettings(clientId);
      region_code = await getClientDefaultTaxRegionCode(knex, tenant, clientId);
    } catch (autoConfigError) {
      console.error(`[createInvoiceFromBillingResult] Failed to auto-configure default tax region for client ${clientId}:`, autoConfigError);
    }
  }

  if (!region_code) {
    console.error(`[createInvoiceFromBillingResult] Cannot create invoice for client ${clientId} (${client.client_name}) because it lacks a default tax region (region_code) even after auto-configuration attempt.`);
    throw new Error(`Client '${client.client_name}' does not have a default tax region configured. Please set one before generating invoices.`);
  }
  const currentDate = Temporal.Now.plainDateISO().toString();
  const due_date = await getDueDate(clientId, cycleEnd); // Uses temporary import
  // taxService initialized above
  // let subtotal = 0; // Subtotal will be calculated by persistInvoiceCharges

  // Determine tax source for this invoice based on client/tenant settings
  const taxSource = await getInitialInvoiceTaxSource(clientId);
  const useTaxDelegation = await shouldUseTaxDelegation(clientId);

  const clientContractId = getSingleClientContractIdFromCharges(billingResult.charges);
  const invoicePoNumber = clientContractId
    ? (await getClientContractPurchaseOrderContext({ knex, tenant, clientContractId })).po_number
    : null;

  // Create base invoice object
  const invoiceData = {
    client_id: clientId,
    client_contract_id: clientContractId,
    po_number: invoicePoNumber,
    invoice_date: toISODate(Temporal.PlainDate.from(currentDate)),
    due_date,
    subtotal: 0,
    tax: 0,
    total_amount: 0,
    status: 'draft',
    invoice_number: '',
    credit_applied: 0,
    billing_cycle_id,
    tenant,
    currency_code: billingResult.currency_code || 'USD',
    is_manual: false,
    // Add billing period dates to ensure validation works correctly
    billing_period_start: toPlainDate(cycleStart),
    billing_period_end: toPlainDate(cycleEnd),
    // Tax source: 'internal', 'pending_external', or 'external'
    tax_source: taxSource
  };

  let newInvoice: IInvoice | null = null;
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const invoiceNumber = await generateInvoiceNumber(); // Uses local function
      invoiceData.invoice_number = invoiceNumber;
      const [insertedInvoice] = await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Check permissions within transaction
        if (!hasPermission(user, 'invoice', 'create') && !hasPermission(user, 'invoice', 'generate')) {
          throw new Error('Permission denied: Cannot create invoices');
        }

        return await trx('invoices').insert(invoiceData).returning('*');
      });
      newInvoice = insertedInvoice;
      break;
    } catch (error: unknown) {
      if (error instanceof Error &&
        'code' in error &&
        error.code === '23505' &&
        'constraint' in error &&
        error.constraint === 'unique_invoice_number_per_tenant') {
        retryCount++;
        if (retryCount >= maxRetries) {
          throw new Error('Failed to generate unique invoice number after multiple attempts');
        }
      } else {
        throw error;
      }
    }
  }

  if (!newInvoice) {
    throw new Error('Failed to create invoice');
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Permission already checked in previous transaction, no need to recheck
    // Just use currentUser that we already validated

    // Persist all items (including fixed details) using the dedicated service function
    const sessionObject: Session = {
      user: {
        id: user.user_id,
        email: user.email,
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username,
        username: user.username,
        image: user.image,
        proToken: '', // Not available in user, using empty string
        tenant: user.tenant,
        user_type: user.user_type,
        clientId: undefined, // Not available in user
        contactId: user.contact_id
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
    };
    const calculatedSubtotal = await persistInvoiceCharges(
      trx,
      newInvoice!.invoice_id,
      billingResult.charges,
      client,
      sessionObject,
      tenant
    );

    // Mark ticket/project materials in this billing window as billed by this invoice.
    // These materials were included by BillingEngine as non-contract charges (like usage/time).
    try {
      const billedAt = Temporal.Now.instant().toString();
      await trx('ticket_materials')
        .where({ tenant, client_id: client.client_id, is_billed: false })
        .andWhere('currency_code', '=', billingResult.currency_code || 'USD')
        .andWhere('created_at', '>=', cycleStart)
        .andWhere('created_at', '<', cycleEnd)
        .update({
          is_billed: true,
          billed_invoice_id: newInvoice!.invoice_id,
          billed_at: billedAt,
          updated_at: billedAt
        });

      await trx('project_materials')
        .where({ tenant, client_id: client.client_id, is_billed: false })
        .andWhere('currency_code', '=', billingResult.currency_code || 'USD')
        .andWhere('created_at', '>=', cycleStart)
        .andWhere('created_at', '<', cycleEnd)
        .update({
          is_billed: true,
          billed_invoice_id: newInvoice!.invoice_id,
          billed_at: billedAt,
          updated_at: billedAt
        });
    } catch (err) {
      if (!isMissingRelationError(err)) {
        throw err;
      }
    }

    // Process discounts (if any) - This might need adjustment if persistInvoiceCharges handles them
    // For now, assume discounts are separate and need processing here.
    let discountSubtotalAdjustment = 0;
    for (const discount of billingResult.discounts) {
      const netAmount = Math.round(-(discount.amount || 0));
      const discountItem = {
        item_id: uuidv4(),
        invoice_id: newInvoice!.invoice_id,
        description: discount.discount_name,
        quantity: 1,
        unit_price: netAmount,
        net_amount: netAmount,
        tax_amount: 0,
        tax_rate: 0,
        total_price: netAmount,
        is_taxable: false,
        is_discount: true,
        is_manual: false,
        tenant,
        created_by: userId
      };
      await trx('invoice_charges').insert(discountItem);
      discountSubtotalAdjustment += netAmount; // Add negative amount
    }

    // Use the subtotal returned by persistInvoiceCharges + discount adjustment
    const subtotal = calculatedSubtotal + discountSubtotalAdjustment;

    // Leverage the shared tax helper so automated invoices mirror manual invoices
    const calculatedTax = await calculateAndDistributeTax(
      trx,
      newInvoice!.invoice_id,
      client,
      taxService,
      tenant
    );

    const finalSubtotal = Math.ceil(subtotal);
    const finalTax = Math.ceil(calculatedTax);
    const totalAmount = finalSubtotal + finalTax;
    const availableCredit = await ClientContractLine.getClientCredit(clientId);
    const creditToApply = Math.min(availableCredit, Math.ceil(totalAmount));

    // Update the invoice with subtotal, tax, and total amount
    await trx('invoices')
      .where({ invoice_id: newInvoice!.invoice_id, tenant })
      .update({
        subtotal: finalSubtotal,
        tax: finalTax,
        total_amount: Math.ceil(totalAmount),
        credit_applied: 0
      });

    // Corrected call signature: removed finalSubtotal and finalTax as they are recalculated internally
    await updateInvoiceTotalsAndRecordTransaction(
      trx,
      newInvoice!.invoice_id,
      client,
      tenant,
      invoiceData.invoice_number
      // expirationDate is optional and not needed here
    );
  });

  // Track analytics
  const { analytics, AnalyticsEvents } = await getAnalyticsAsync();
  analytics.capture(AnalyticsEvents.INVOICE_GENERATED, {
    invoice_id: newInvoice.invoice_id,
    invoice_number: newInvoice.invoice_number,
    client_id: clientId,
    subtotal: newInvoice.subtotal,
    tax: newInvoice.tax,
    total_amount: newInvoice.total_amount,
    billing_period_start: cycleStart,
    billing_period_end: cycleEnd,
    charge_count: billingResult.charges.length,
    discount_count: billingResult.discounts.length,
    is_manual: false
  }, userId);

  return newInvoice;
});
