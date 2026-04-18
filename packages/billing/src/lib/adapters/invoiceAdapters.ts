// Import the source and target types with aliases for clarity
import type {
  InvoiceViewModel as DbInvoiceViewModel, // Source type from DB/interfaces
  IInvoiceCharge
} from '@alga-psa/types';
import type {
  WasmInvoiceViewModel,
  WasmInvoiceLineItem,
  WasmInvoiceLineItemLocation,
  WasmInvoiceLocationGroup,
  DateValue,
} from '@alga-psa/types';
import type { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
// toPlainDate is likely not needed here as we format to string for Wasm

// Helper function to convert DateValue (Date or ISO string or Temporal) to ISO string for Wasm
function formatDateValueToString(date: DateValue | undefined | null): string {
  if (!date) return '';
  if (date instanceof Date) {
    return date.toISOString(); // Standard JS Date to ISO string
  }
  // Check for Temporal types (PlainDate, ZonedDateTime, etc.) which have toString()
  if (typeof date === 'object' && date !== null && 'calendarId' in date) { // A reasonable check for Temporal objects
      // Temporal objects usually have a suitable toString() method
      return date.toString();
  }
  // Otherwise, assume it's already a string or can be converted
  return String(date);
}

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const looksLikeLegacyMajorUnitPayload = (params: {
  subtotal: number;
  tax: number;
  total: number;
  itemTotalsSum: number;
}): boolean => {
  if (params.total <= 0 || params.itemTotalsSum <= 0) {
    return false;
  }
  const hasExplicitSubtotals = Math.abs(params.subtotal) > 0 || Math.abs(params.tax) > 0;
  if (hasExplicitSubtotals) {
    return false;
  }
  return Math.abs(params.itemTotalsSum - params.total) <= 1;
};

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

type RendererRecurringDetailPeriod = {
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
  billingTiming?: 'arrears' | 'advance' | null;
};

const normalizeDateLikeValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
};

const normalizeRecurringDetailPeriods = (item: Record<string, unknown>): RendererRecurringDetailPeriod[] | undefined => {
  const candidate = item.recurringDetailPeriods ?? item.recurring_detail_periods;
  if (!Array.isArray(candidate) || candidate.length === 0) {
    return undefined;
  }

  return candidate
    .filter((detail): detail is Record<string, unknown> => !!detail && typeof detail === 'object')
    .map((detail) => ({
      servicePeriodStart:
        normalizeDateLikeValue(detail.servicePeriodStart) ??
        normalizeDateLikeValue(detail.service_period_start) ??
        null,
      servicePeriodEnd:
        normalizeDateLikeValue(detail.servicePeriodEnd) ??
        normalizeDateLikeValue(detail.service_period_end) ??
        null,
      billingTiming:
        detail.billingTiming === 'advance' || detail.billingTiming === 'arrears'
          ? detail.billingTiming
          : detail.billing_timing === 'advance' || detail.billing_timing === 'arrears'
            ? detail.billing_timing
            : null,
    }) satisfies RendererRecurringDetailPeriod)
    .sort((left, right) => {
      if (left.servicePeriodStart !== right.servicePeriodStart) {
        return String(left.servicePeriodStart ?? '').localeCompare(String(right.servicePeriodStart ?? ''));
      }
      return String(left.servicePeriodEnd ?? '').localeCompare(String(right.servicePeriodEnd ?? ''));
    });
};

const resolveTenantClientSnapshot = (source: Record<string, unknown>): WasmInvoiceViewModel['tenantClient'] => {
  const candidate =
    source.tenantClient ??
    source.tenant_client ??
    source.tenantClientInfo ??
    source.tenant_client_info ??
    null;

  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const candidateRecord = candidate as Record<string, unknown>;
  const name = asTrimmedString(candidateRecord.name) || asTrimmedString(candidateRecord.client_name);
  const address = asTrimmedString(candidateRecord.address) || asTrimmedString(candidateRecord.location_address);
  const logoUrl = asTrimmedString(candidateRecord.logoUrl) || asTrimmedString(candidateRecord.logo_url) || null;

  if (name.length === 0 && address.length === 0 && !logoUrl) {
    return null;
  }

  return {
    name: name.length > 0 ? name : null,
    address: address.length > 0 ? address : null,
    logoUrl,
  };
};

const recurringServicePeriodDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const parseRecurringServicePeriodDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const trimmed = normalizeDateLikeValue(value);
  if (!trimmed) {
    return null;
  }

  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildRecurringServicePeriodLabel = (start: unknown, end: unknown): string | null => {
  const parsedStart = parseRecurringServicePeriodDate(start);
  const parsedEnd = parseRecurringServicePeriodDate(end);
  if (!parsedStart || !parsedEnd) {
    return null;
  }

  return `${recurringServicePeriodDateFormatter.format(parsedStart)} - ${recurringServicePeriodDateFormatter.format(parsedEnd)}`;
};

const resolveRecurringServicePeriodSummary = (source: Record<string, unknown>) => {
  const recurringServicePeriodStart =
    normalizeDateLikeValue(source.recurringServicePeriodStart) ||
    normalizeDateLikeValue(source.recurring_service_period_start) ||
    null;
  const recurringServicePeriodEnd =
    normalizeDateLikeValue(source.recurringServicePeriodEnd) ||
    normalizeDateLikeValue(source.recurring_service_period_end) ||
    null;

  return {
    recurringServicePeriodStart,
    recurringServicePeriodEnd,
    recurringServicePeriodLabel:
      recurringServicePeriodStart && recurringServicePeriodEnd
        ? buildRecurringServicePeriodLabel(recurringServicePeriodStart, recurringServicePeriodEnd)
        : null,
  };
};

const isRecurringItem = (item: WasmInvoiceLineItem): boolean =>
  (item.recurringDetailPeriods?.length ?? 0) > 0 || !!item.billingTiming;

const buildLocationAddressBlock = (location: WasmInvoiceLineItemLocation | null): string | null => {
  if (!location) return null;
  const lines: string[] = [];
  for (const field of [location.address_line1, location.address_line2, location.address_line3]) {
    const trimmed = asTrimmedString(field);
    if (trimmed) lines.push(trimmed);
  }
  const cityLine = [location.city, location.state_province, location.postal_code]
    .map(asTrimmedString)
    .filter((value) => value.length > 0)
    .join(', ');
  if (cityLine) lines.push(cityLine);
  const country = asTrimmedString(location.country_name) || asTrimmedString(location.country_code);
  if (country) lines.push(country);
  return lines.length > 0 ? lines.join('\n') : null;
};

const UNASSIGNED_LOCATION_GROUP_KEY = '__unassigned__';

/**
 * Pre-compute per-location groupings for the provided items. Preserves first-
 * seen order across items. Intended to be used after item-level `location_id`
 * / `location` have been resolved by `enrichInvoiceViewModelWithLocations`.
 */
export function buildInvoiceLocationGroups(items: WasmInvoiceLineItem[]): WasmInvoiceLocationGroup[] {
  const order: string[] = [];
  const grouped = new Map<string, WasmInvoiceLocationGroup>();

  for (const item of items) {
    const key = item.location_id ?? UNASSIGNED_LOCATION_GROUP_KEY;
    let entry = grouped.get(key);
    if (!entry) {
      entry = {
        location_id: key === UNASSIGNED_LOCATION_GROUP_KEY ? null : key,
        location: item.location ?? null,
        name: item.location?.location_name ?? null,
        address: buildLocationAddressBlock(item.location ?? null),
        items: [],
        subtotal: 0,
        tax: 0,
        total: 0,
      };
      grouped.set(key, entry);
      order.push(key);
    }
    entry.items.push(item);
  }

  for (const entry of grouped.values()) {
    entry.subtotal = entry.items.reduce((sum, item) => sum + toFiniteNumber(item.total), 0);
    entry.tax = entry.items.reduce((sum, item) => sum + toFiniteNumber(item.taxAmount), 0);
    entry.total = entry.subtotal + entry.tax;
  }

  return order.map((key) => grouped.get(key)!);
}

/**
 * Resolve each line item's `location_id` against `client_locations` via a
 * single batched tenant-scoped query and attach the full location object to
 * the item. Also populates `groupsByLocation` + `hasMultipleLocations` on the
 * view model. Mutates and returns the given view model. Safe to call when
 * no item carries a location_id (no-op in that case).
 */
export async function enrichInvoiceViewModelWithLocations(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  viewModel: WasmInvoiceViewModel,
): Promise<WasmInvoiceViewModel> {
  const items = viewModel.items ?? [];

  const locationIds = Array.from(
    new Set(
      items
        .map((item) => item.location_id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
    ),
  );

  let locationsById = new Map<string, WasmInvoiceLineItemLocation>();

  if (locationIds.length > 0) {
    try {
      const rows = await knexOrTrx('client_locations')
        .select(
          'location_id as id',
          'location_name',
          'address_line1',
          'address_line2',
          'address_line3',
          'city',
          'state_province',
          'postal_code',
          'country_code',
          'country_name',
          'region_code',
        )
        .where({ tenant })
        .whereIn('location_id', locationIds);

      for (const row of rows) {
        const record = row as Record<string, unknown>;
        const base: WasmInvoiceLineItemLocation = {
          id: String(record.id),
          location_name: (record.location_name as string | null) ?? null,
          address_line1: (record.address_line1 as string | null) ?? null,
          address_line2: (record.address_line2 as string | null) ?? null,
          address_line3: (record.address_line3 as string | null) ?? null,
          city: (record.city as string | null) ?? null,
          state_province: (record.state_province as string | null) ?? null,
          postal_code: (record.postal_code as string | null) ?? null,
          country_code: (record.country_code as string | null) ?? null,
          country_name: (record.country_name as string | null) ?? null,
          region_code: (record.region_code as string | null) ?? null,
        };
        locationsById.set(base.id, { ...base, full_address: buildLocationAddressBlock(base) });
      }
    } catch (error) {
      console.error('[enrichInvoiceViewModelWithLocations] Failed to load client_locations:', error);
    }
  }

  for (const item of items) {
    if (item.location_id && locationsById.has(item.location_id)) {
      item.location = locationsById.get(item.location_id) ?? null;
    } else if (!item.location) {
      item.location = null;
    }
  }

  viewModel.groupsByLocation = buildInvoiceLocationGroups(items);
  viewModel.hasMultipleLocations = locationsById.size >= 2;

  return viewModel;
}

/**
 * Enriches a WasmInvoiceViewModel with recurring/one-time grouped item
 * collections and their separate subtotals, tax, and totals.
 * Derives grouping from existing timing fields — no database migration needed.
 */
export function enrichWithGroupedItems(vm: WasmInvoiceViewModel): WasmInvoiceViewModel {
  const recurringItems = vm.items.filter(isRecurringItem);
  const onetimeItems = vm.items.filter((item) => !isRecurringItem(item));

  const sumField = (items: WasmInvoiceLineItem[], field: 'total' | 'taxAmount') =>
    items.reduce((sum, item) => sum + toFiniteNumber(item[field]), 0);

  const recurringSubtotal = sumField(recurringItems, 'total');
  const onetimeSubtotal = sumField(onetimeItems, 'total');

  // Use per-item tax when available, otherwise split proportionally
  const hasPerItemTax = vm.items.some((item) => (item.taxAmount ?? 0) !== 0);
  let recurringTax: number;
  let onetimeTax: number;

  if (hasPerItemTax) {
    recurringTax = sumField(recurringItems, 'taxAmount');
    onetimeTax = sumField(onetimeItems, 'taxAmount');
  } else {
    const totalSubtotal = recurringSubtotal + onetimeSubtotal;
    recurringTax = totalSubtotal > 0 ? Math.round(vm.tax * (recurringSubtotal / totalSubtotal)) : 0;
    onetimeTax = vm.tax - recurringTax;
  }

  vm.recurringItems = recurringItems;
  vm.onetimeItems = onetimeItems;
  vm.recurringSubtotal = recurringSubtotal;
  vm.recurringTax = recurringTax;
  vm.recurringTotal = recurringSubtotal + recurringTax;
  vm.onetimeSubtotal = onetimeSubtotal;
  vm.onetimeTax = onetimeTax;
  vm.onetimeTotal = onetimeSubtotal + onetimeTax;

  return vm;
}

/**
 * Maps the detailed invoice data structure fetched from the database
 * (DbInvoiceViewModel from invoice.interfaces.ts) to the InvoiceViewModel
 * required by the invoice template renderer (WasmInvoiceViewModel).
 * @param dbData - The detailed invoice data from the database query.
 * @returns An InvoiceViewModel suitable for template rendering, or null if input is null.
 */
// Change input type to 'any' as the actual input structure seems to be WasmInvoiceViewModel based on logs
export function mapDbInvoiceToWasmViewModel(inputData: DbInvoiceViewModel | WasmInvoiceViewModel | any): WasmInvoiceViewModel | null {
  console.log('[mapDbInvoiceToWasmViewModel] Received Data:', JSON.stringify(inputData, null, 2));

  if (!inputData) {
    console.log('[mapDbInvoiceToWasmViewModel] Input data is null, returning null.');
    return null;
  }

  let viewModel: WasmInvoiceViewModel;

  try {
    // Check if the input data is in DbInvoiceViewModel format (from database)
    if (typeof inputData.invoice_number !== 'undefined' && typeof inputData.client !== 'undefined' && typeof inputData.invoice_charges !== 'undefined') {
      console.log('[mapDbInvoiceToWasmViewModel] Input data appears to be in DbInvoiceViewModel format. Mapping...');
      const dbData = inputData as DbInvoiceViewModel;
      const dbRecord = dbData as unknown as Record<string, unknown>;
      const rawSubtotal = toFiniteNumber((dbData as any).subtotal);
      const rawTax = toFiniteNumber((dbData as any).tax);
      const rawTotal = toFiniteNumber((dbData as any).total ?? (dbData as any).total_amount);
      const rawItemTotalsSum = (dbData.invoice_charges ?? []).reduce(
        (sum: number, item: IInvoiceCharge) => sum + toFiniteNumber(item.total_price),
        0
      );
      const useLegacyMajorUnits = looksLikeLegacyMajorUnitPayload({
        subtotal: rawSubtotal,
        tax: rawTax,
        total: rawTotal,
        itemTotalsSum: rawItemTotalsSum,
      });
      const toMinorUnits = (value: unknown): number => {
        const numeric = toFiniteNumber(value);
        if (!useLegacyMajorUnits) {
          return Math.trunc(numeric);
        }
        return Math.round(numeric * 100);
      };

      // Rendering keeps the canonical recurring detail list when it exists, but it still
      // provides one compatibility summary range for templates that can only show one row.
      // Mixed timing stays explicit on the detail rows and is flattened to `null` at the
      // summary level rather than inventing one winning timing value.
      const normalizedItems = (dbData.invoice_charges ?? []).map((item: IInvoiceCharge) => {
        const normalizedDetailPeriods = normalizeRecurringDetailPeriods(item as unknown as Record<string, unknown>);
        const summaryStart =
          normalizeDateLikeValue((item as any).servicePeriodStart) ??
          normalizeDateLikeValue((item as any).service_period_start) ??
          normalizedDetailPeriods?.[0]?.servicePeriodStart ??
          null;
        const summaryEnd =
          normalizeDateLikeValue((item as any).servicePeriodEnd) ??
          normalizeDateLikeValue((item as any).service_period_end) ??
          normalizedDetailPeriods?.[normalizedDetailPeriods.length - 1]?.servicePeriodEnd ??
          null;
        const summaryBillingTiming =
          (item as any).billingTiming ??
          (item as any).billing_timing ??
          (() => {
            if (!normalizedDetailPeriods || normalizedDetailPeriods.length === 0) {
              return null;
            }
            const timings = [...new Set(normalizedDetailPeriods.map((detail) => detail.billingTiming).filter(Boolean))];
            return timings.length === 1 ? timings[0] ?? null : null;
          })();

        return {
          id: String(item.item_id ?? ''),
          description: String(item.description ?? ''),
          quantity: toFiniteNumber(item.quantity),
          unitPrice: toMinorUnits(item.unit_price),
          total: toMinorUnits(item.total_price),
          taxAmount: toMinorUnits(item.tax_amount),
          servicePeriodStart: summaryStart,
          servicePeriodEnd: summaryEnd,
          billingTiming: summaryBillingTiming,
          recurringDetailPeriods: normalizedDetailPeriods,
          location_id: item.location_id ?? null,
          location: null,
        };
      });
      const computedSubtotal = normalizedItems.reduce((sum, item) => sum + item.total, 0);
      const subtotal = toMinorUnits(rawSubtotal);
      const tax = toMinorUnits(rawTax);
      const total = toMinorUnits(rawTotal);
      const recurringServicePeriodSummary = resolveRecurringServicePeriodSummary(dbRecord);

      viewModel = {
        invoiceNumber: String(dbData.invoice_number ?? 'N/A'),
        issueDate: formatDateValueToString(dbData.invoice_date),
        dueDate: formatDateValueToString(dbData.due_date),
        customer: {
          name: String(dbData.client?.name ?? 'N/A'),
          address: String(dbData.client?.address ?? 'N/A'),
        },
        poNumber: (dbData as any).po_number ?? null,
        recurringServicePeriodStart: recurringServicePeriodSummary.recurringServicePeriodStart,
        recurringServicePeriodEnd: recurringServicePeriodSummary.recurringServicePeriodEnd,
        recurringServicePeriodLabel: recurringServicePeriodSummary.recurringServicePeriodLabel,
        tenantClient: resolveTenantClientSnapshot(dbRecord),
        items: normalizedItems,
        subtotal: subtotal !== 0 ? subtotal : computedSubtotal,
        tax,
        total: total !== 0 ? total : (subtotal !== 0 ? subtotal : computedSubtotal) + tax,
        taxSource: dbData.tax_source || 'internal',
        currencyCode: (dbData as any).currency_code || (dbData as any).currencyCode || 'USD',
      };
    }
    // Check if the input data is already in WasmInvoiceViewModel format
    else if (typeof inputData.invoiceNumber !== 'undefined' && typeof inputData.customer !== 'undefined' && typeof inputData.items !== 'undefined') {
        console.log('[mapDbInvoiceToWasmViewModel] Input data appears to be in WasmInvoiceViewModel format. Using directly...');
        viewModel = inputData as WasmInvoiceViewModel;
        const wasmRecord = viewModel as unknown as Record<string, unknown>;
        // Ensure numeric types are correct in case they were strings
        viewModel.items = (viewModel.items ?? []).map(item => ({
            ...item,
            quantity: Number(item.quantity ?? 0),
            unitPrice: Number(item.unitPrice ?? 0),
            total: Number(item.total ?? 0),
        }));
        viewModel.subtotal = Number(viewModel.subtotal ?? 0);
        viewModel.tax = Number(viewModel.tax ?? 0);
        viewModel.total = Number(viewModel.total ?? 0);
        const recurringServicePeriodSummary = resolveRecurringServicePeriodSummary(wasmRecord);
        viewModel.recurringServicePeriodStart = recurringServicePeriodSummary.recurringServicePeriodStart;
        viewModel.recurringServicePeriodEnd = recurringServicePeriodSummary.recurringServicePeriodEnd;
        viewModel.recurringServicePeriodLabel = recurringServicePeriodSummary.recurringServicePeriodLabel;
        viewModel.tenantClient = resolveTenantClientSnapshot(wasmRecord);

    } else {
        console.error('[mapDbInvoiceToWasmViewModel] Input data format is unknown. Missing essential properties for both DbInvoiceViewModel and WasmInvoiceViewModel.');
        console.error('[mapDbInvoiceToWasmViewModel] Original Data causing error:', JSON.stringify(inputData, null, 2));
        return null; // Return null if format is unknown
    }


    enrichWithGroupedItems(viewModel);
    console.log('[mapDbInvoiceToWasmViewModel] Mapped ViewModel:', JSON.stringify(viewModel, null, 2));
    return viewModel;

  } catch (error) {
      console.error('[mapDbInvoiceToWasmViewModel] Error during mapping:', error);
      console.error('[mapDbInvoiceToWasmViewModel] Original Data causing error:', JSON.stringify(inputData, null, 2));
      return null; // Return null on error
  }
}

// --- The deprecated mapDbInvoiceToViewModel function below this line is now removed ---
