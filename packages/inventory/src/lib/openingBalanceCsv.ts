import type { Knex } from 'knex';
import { recordStockMovement } from './movements';

export interface CsvParseResult {
  header: string[];
  rows: string[][];
}

export function parseCsv(text: string): CsvParseResult {
  const parsedRows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let atFieldStart = true;

  const commitField = () => {
    row.push(field);
    field = '';
    atFieldStart = true;
  };

  const commitRow = () => {
    commitField();
    if (row.length > 1 || row[0] !== '') {
      parsedRows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          atFieldStart = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (ch === ',') {
      commitField();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      commitRow();
    } else if (ch === '\n') {
      commitRow();
    } else {
      field += ch;
      atFieldStart = false;
    }
  }

  if (row.length > 0 || field !== '') {
    commitRow();
  }

  return {
    header: parsedRows[0] ?? [],
    rows: parsedRows.slice(1),
  };
}

export interface OpeningBalanceCsvRow {
  row: number;
  sku: string | null;
  product: string | null;
  location: string;
  quantity: number | null;
  serial_number: string | null;
  mac_address: string | null;
  unit_cost_cents: number | null;
}

export interface CsvShapeResult {
  rows: OpeningBalanceCsvRow[];
  errors: Array<{ row: number; message: string }>;
}

const OPENING_BALANCE_HEADERS = [
  'sku',
  'product',
  'location',
  'quantity',
  'serial_number',
  'mac_address',
  'unit_cost',
] as const;

type OpeningBalanceHeader = (typeof OPENING_BALANCE_HEADERS)[number];

function cleanCell(value: string | undefined): string {
  return (value ?? '').trim();
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = cleanCell(value);
  return trimmed ? trimmed : null;
}

function headerKey(value: string): string {
  return value.trim().replace(/^\uFEFF/, '').toLowerCase();
}

function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseCostCents(value: string): number | null {
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const cents = Math.round(parsed * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function shapeOpeningBalanceRows(parsed: CsvParseResult): CsvShapeResult {
  const errors: Array<{ row: number; message: string }> = [];
  const rows: OpeningBalanceCsvRow[] = [];

  if (parsed.rows.length > 5000) {
    return { rows: [], errors: [{ row: 0, message: 'CSV cannot contain more than 5000 data rows' }] };
  }

  if (parsed.header.length === 0) {
    return { rows: [], errors: [{ row: 0, message: 'header row is required' }] };
  }

  const indexes = new Map<OpeningBalanceHeader, number>();
  parsed.header.forEach((name, idx) => {
    const key = headerKey(name);
    if ((OPENING_BALANCE_HEADERS as readonly string[]).includes(key) && !indexes.has(key as OpeningBalanceHeader)) {
      indexes.set(key as OpeningBalanceHeader, idx);
    }
  });

  for (const name of OPENING_BALANCE_HEADERS) {
    if (!indexes.has(name)) {
      errors.push({ row: 0, message: `missing required header: ${name}` });
    }
  }
  if (errors.length > 0) return { rows: [], errors };

  const value = (record: string[], name: OpeningBalanceHeader): string => cleanCell(record[indexes.get(name)!]);

  parsed.rows.forEach((record, index) => {
    const rowNumber = index + 1;
    const sku = emptyToNull(value(record, 'sku'));
    const product = emptyToNull(value(record, 'product'));
    const location = value(record, 'location');
    const quantityText = value(record, 'quantity');
    const serial = emptyToNull(value(record, 'serial_number'));
    const rawMac = emptyToNull(value(record, 'mac_address'));
    const unitCostText = value(record, 'unit_cost');

    if (!sku && !product) {
      errors.push({ row: rowNumber, message: 'sku or product is required' });
    }
    if (!location) {
      errors.push({ row: rowNumber, message: 'location is required' });
    }

    let quantity: number | null = null;
    if (quantityText) {
      quantity = parsePositiveInteger(quantityText);
      if (quantity === null) {
        errors.push({ row: rowNumber, message: 'quantity must be a positive integer' });
      }
    }

    if (serial) {
      if (quantity !== null && quantity !== 1) {
        errors.push({ row: rowNumber, message: 'serialized rows must have quantity empty or 1' });
      }
    } else if (quantity === null) {
      errors.push({ row: rowNumber, message: 'quantity is required for bulk rows' });
    }

    let unitCostCents: number | null = null;
    if (unitCostText) {
      unitCostCents = parseCostCents(unitCostText);
      if (unitCostCents === null) {
        errors.push({ row: rowNumber, message: 'unit_cost must be a non-negative dollar amount' });
      }
    }

    rows.push({
      row: rowNumber,
      sku,
      product,
      location,
      quantity,
      serial_number: serial,
      mac_address: serial ? rawMac : null,
      unit_cost_cents: unitCostCents,
    });
  });

  return { rows, errors };
}

export interface OpeningBalanceOptions {
  batch_label?: string | null;
  create_missing_settings?: boolean;
}

export interface OpeningBalanceRowError {
  row: number;
  message: string;
}

export interface OpeningBalanceWarning {
  row?: number;
  message: string;
}

export interface OpeningBalancePreviewRow {
  row: number;
  service_id: string;
  service_name: string | null;
  sku: string | null;
  location_id: string;
  location_name: string;
  is_serialized: boolean;
  quantity: number;
  serial_number: string | null;
  mac_address: string | null;
  unit_cost_cents: number | null;
}

export interface OpeningBalanceValidation {
  ok: boolean;
  rows: OpeningBalancePreviewRow[];
  errors: OpeningBalanceRowError[];
  warnings: OpeningBalanceWarning[];
  summary: {
    data_rows: number;
    products: number;
    locations: number;
    serialized_units: number;
    bulk_quantity: number;
    total_value_cents: number;
    settings_to_create: number;
  };
}

export interface OpeningBalanceApplyResult {
  batch_label: string;
  receipts: number;
  units_created: number;
  settings_created: number;
  total_value_cents: number;
}

interface ServiceLookupRow {
  service_id: string;
  service_name: string | null;
  sku: string | null;
  cost_currency?: string | null;
}

interface LocationLookupRow {
  location_id: string;
  name: string;
}

interface SettingsLookupRow {
  service_id: string;
  track_stock: boolean;
  is_serialized: boolean;
  average_cost: number | string | null;
  cost_currency: string | null;
}

interface ResolvedValidationRow {
  source: OpeningBalanceCsvRow;
  service?: ServiceLookupRow;
  location?: LocationLookupRow;
  is_serialized: boolean;
}

interface OpeningBalancePreparation {
  validation: OpeningBalanceValidation;
  settingsByService: Map<string, SettingsLookupRow>;
  missingSettingsSerialized: Map<string, boolean>;
}

function normalizedKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function emptySummary(dataRows: number): OpeningBalanceValidation['summary'] {
  return {
    data_rows: dataRows,
    products: 0,
    locations: 0,
    serialized_units: 0,
    bulk_quantity: 0,
    total_value_cents: 0,
    settings_to_create: 0,
  };
}

function summarize(
  dataRows: number,
  rows: OpeningBalancePreviewRow[],
  missingSettingsSerialized: Map<string, boolean>,
): OpeningBalanceValidation['summary'] {
  const products = new Set<string>();
  const locations = new Set<string>();
  const settingsToCreate = new Set<string>();
  let serializedUnits = 0;
  let bulkQuantity = 0;
  let totalValueCents = 0;

  for (const row of rows) {
    products.add(row.service_id);
    locations.add(row.location_id);
    if (missingSettingsSerialized.has(row.service_id)) settingsToCreate.add(row.service_id);
    if (row.is_serialized) serializedUnits += row.quantity;
    else bulkQuantity += row.quantity;
    totalValueCents += row.quantity * (row.unit_cost_cents ?? 0);
  }

  return {
    data_rows: dataRows,
    products: products.size,
    locations: locations.size,
    serialized_units: serializedUnits,
    bulk_quantity: bulkQuantity,
    total_value_cents: totalValueCents,
    settings_to_create: settingsToCreate.size,
  };
}

async function prepareOpeningBalance(
  trx: Knex.Transaction,
  tenant: string,
  csvText: string,
  opts?: OpeningBalanceOptions,
): Promise<OpeningBalancePreparation> {
  const parsed = parseCsv(csvText);
  const shaped = shapeOpeningBalanceRows(parsed);
  const errors: OpeningBalanceRowError[] = [...shaped.errors];
  const warnings: OpeningBalanceWarning[] = [];
  const errorRows = new Set<number>();
  const settingsByService = new Map<string, SettingsLookupRow>();
  const missingSettingsSerialized = new Map<string, boolean>();

  const addError = (row: number, message: string) => {
    errors.push({ row, message });
    if (row > 0) errorRows.add(row);
  };

  for (const error of shaped.errors) {
    if (error.row > 0) errorRows.add(error.row);
  }

  if (shaped.errors.some((error) => error.row === 0) || shaped.rows.length === 0) {
    const validation: OpeningBalanceValidation = {
      ok: errors.length === 0,
      rows: [],
      errors,
      warnings,
      summary: emptySummary(parsed.rows.length),
    };
    return { validation, settingsByService, missingSettingsSerialized };
  }

  const candidates = shaped.rows.filter((row) => !errorRows.has(row.row));
  const services = (await trx('service_catalog')
    .where({ tenant })
    .select('service_id', 'service_name', 'sku', 'cost_currency')) as ServiceLookupRow[];
  const locations = (await trx('stock_locations')
    .where({ tenant, is_active: true })
    .select('location_id', 'name')) as LocationLookupRow[];

  const servicesBySku = new Map<string, ServiceLookupRow>();
  const servicesByName = new Map<string, ServiceLookupRow>();
  for (const service of services) {
    const skuKey = normalizedKey(service.sku);
    if (skuKey && !servicesBySku.has(skuKey)) servicesBySku.set(skuKey, service);
    const nameKey = normalizedKey(service.service_name);
    if (nameKey && !servicesByName.has(nameKey)) servicesByName.set(nameKey, service);
  }

  const locationsByName = new Map<string, LocationLookupRow>();
  for (const location of locations) {
    const key = normalizedKey(location.name);
    if (key && !locationsByName.has(key)) locationsByName.set(key, location);
  }

  const resolvedRows: ResolvedValidationRow[] = [];
  for (const source of candidates) {
    let service: ServiceLookupRow | undefined;
    if (source.sku) service = servicesBySku.get(normalizedKey(source.sku));
    if (!service && source.product) service = servicesByName.get(normalizedKey(source.product));
    if (!service) addError(source.row, 'product not found');

    const location = locationsByName.get(normalizedKey(source.location));
    if (!location) addError(source.row, 'stock location not found');

    resolvedRows.push({
      source,
      service,
      location,
      is_serialized: Boolean(source.serial_number),
    });
  }

  const rowsByService = new Map<string, ResolvedValidationRow[]>();
  for (const row of resolvedRows) {
    if (!row.service) continue;
    const bucket = rowsByService.get(row.service.service_id) ?? [];
    bucket.push(row);
    rowsByService.set(row.service.service_id, bucket);
  }

  const mixedServices = new Set<string>();
  for (const [serviceId, rows] of rowsByService) {
    const hasSerialized = rows.some((row) => row.is_serialized);
    const hasBulk = rows.some((row) => !row.is_serialized);
    if (hasSerialized && hasBulk) {
      mixedServices.add(serviceId);
      for (const row of rows) {
        addError(row.source.row, 'product rows mix serialized and bulk quantities');
      }
    }
  }

  const serviceIds = Array.from(rowsByService.keys());
  if (serviceIds.length > 0) {
    const settingsRows = (await trx('product_inventory_settings')
      .where({ tenant })
      .whereIn('service_id', serviceIds)
      .select('service_id', 'track_stock', 'is_serialized', 'average_cost', 'cost_currency')) as SettingsLookupRow[];
    for (const settings of settingsRows) {
      settingsByService.set(settings.service_id, settings);
    }
  }

  const createMissingSettings = opts?.create_missing_settings !== false;
  for (const [serviceId, rows] of rowsByService) {
    const settings = settingsByService.get(serviceId);
    if (!settings) {
      if (!createMissingSettings) {
        for (const row of rows) addError(row.source.row, 'inventory not enabled for product');
      } else if (!mixedServices.has(serviceId)) {
        missingSettingsSerialized.set(serviceId, rows[0]?.is_serialized ?? false);
      }
      continue;
    }

    if (!settings.track_stock) {
      for (const row of rows) addError(row.source.row, 'stock tracking is disabled for product');
      continue;
    }

    if (!mixedServices.has(serviceId)) {
      for (const row of rows) {
        if (Boolean(settings.is_serialized) !== row.is_serialized) {
          addError(
            row.source.row,
            settings.is_serialized ? 'product is configured for serialized inventory' : 'product is configured for bulk inventory',
          );
        }
      }
    }
  }

  const seenSerials = new Map<string, number>();
  const serialRows = resolvedRows.filter((row) => row.service && row.source.serial_number);
  for (const row of serialRows) {
    const serialKey = `${row.service!.service_id}:${normalizedKey(row.source.serial_number)}`;
    if (seenSerials.has(serialKey)) {
      addError(row.source.row, `duplicate serial_number in file: ${row.source.serial_number}`);
    } else {
      seenSerials.set(serialKey, row.source.row);
    }
  }

  const serialValues = Array.from(
    new Set(serialRows.map((row) => normalizedKey(row.source.serial_number)).filter(Boolean)),
  );
  if (serialRows.length > 0 && serialValues.length > 0) {
    const placeholders = serialValues.map(() => '?').join(',');
    const existingUnits = (await trx('stock_units')
      .where({ tenant })
      .whereIn('service_id', serviceIds)
      .whereRaw(`LOWER(serial_number) IN (${placeholders})`, serialValues)
      .select('service_id', 'serial_number')) as Array<{ service_id: string; serial_number: string }>;
    const existingSerials = new Set(
      existingUnits.map((unit) => `${unit.service_id}:${normalizedKey(unit.serial_number)}`),
    );
    for (const row of serialRows) {
      const key = `${row.service!.service_id}:${normalizedKey(row.source.serial_number)}`;
      if (existingSerials.has(key)) {
        addError(row.source.row, `serial already exists for product: ${row.source.serial_number}`);
      }
    }
  }

  const bulkPairs = resolvedRows.filter((row) => row.service && row.location && !row.is_serialized);
  if (bulkPairs.length > 0) {
    const bulkServiceIds = Array.from(new Set(bulkPairs.map((row) => row.service!.service_id)));
    const bulkLocationIds = Array.from(new Set(bulkPairs.map((row) => row.location!.location_id)));
    const stockLevels = (await trx('stock_levels')
      .where({ tenant })
      .whereIn('service_id', bulkServiceIds)
      .whereIn('location_id', bulkLocationIds)
      .select('service_id', 'location_id', 'quantity_on_hand')) as Array<{
      service_id: string;
      location_id: string;
      quantity_on_hand: number | string | null;
    }>;
    const onHandByPair = new Map(
      stockLevels.map((level) => [
        `${level.service_id}:${level.location_id}`,
        Number(level.quantity_on_hand ?? 0),
      ]),
    );
    for (const row of bulkPairs) {
      if (errorRows.has(row.source.row)) continue;
      const onHand = onHandByPair.get(`${row.service!.service_id}:${row.location!.location_id}`) ?? 0;
      if (onHand > 0) {
        warnings.push({
          row: row.source.row,
          message: `location already has ${onHand} on hand \u2014 import will ADD`,
        });
      }
    }
  }

  const previewRows: OpeningBalancePreviewRow[] = [];
  for (const row of resolvedRows) {
    if (errorRows.has(row.source.row) || !row.service || !row.location) continue;
    previewRows.push({
      row: row.source.row,
      service_id: row.service.service_id,
      service_name: row.service.service_name ?? null,
      sku: row.service.sku ?? null,
      location_id: row.location.location_id,
      location_name: row.location.name,
      is_serialized: row.is_serialized,
      quantity: row.is_serialized ? 1 : row.source.quantity ?? 0,
      serial_number: row.source.serial_number,
      mac_address: row.source.mac_address,
      unit_cost_cents: row.source.unit_cost_cents,
    });
  }

  const validation: OpeningBalanceValidation = {
    ok: errors.length === 0,
    rows: previewRows,
    errors,
    warnings,
    summary: summarize(parsed.rows.length, previewRows, missingSettingsSerialized),
  };
  return { validation, settingsByService, missingSettingsSerialized };
}

export async function validateOpeningBalance(
  trx: Knex.Transaction,
  tenant: string,
  csvText: string,
  opts?: OpeningBalanceOptions,
): Promise<OpeningBalanceValidation> {
  return (await prepareOpeningBalance(trx, tenant, csvText, opts)).validation;
}

async function totalOnHand(trx: Knex.Transaction, tenant: string, serviceId: string): Promise<number> {
  const row = await trx('stock_levels')
    .where({ tenant, service_id: serviceId })
    .sum<{ s: string | null }>('quantity_on_hand as s')
    .first();
  return Number(row?.s ?? 0);
}

export async function applyOpeningBalance(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  csvText: string,
  opts?: OpeningBalanceOptions,
): Promise<OpeningBalanceApplyResult> {
  const prepared = await prepareOpeningBalance(trx, tenant, csvText, opts);
  const validation = prepared.validation;
  if (!validation.ok) {
    const firstMessages = validation.errors
      .slice(0, 5)
      .map((error) => (error.row > 0 ? `row ${error.row}: ${error.message}` : error.message));
    const suffix = validation.errors.length > 5 ? `; and ${validation.errors.length - 5} more` : '';
    throw new Error(`Opening balance import failed validation: ${firstMessages.join('; ')}${suffix}`);
  }

  const batchLabel = opts?.batch_label?.trim() || 'opening-balance';
  const reason = `opening_balance_import: ${batchLabel}`;
  const rows = validation.rows;
  const serviceIds = Array.from(new Set(rows.map((row) => row.service_id)));

  let settingsCreated = 0;
  for (const [serviceId, isSerialized] of prepared.missingSettingsSerialized) {
    if (!rows.some((row) => row.service_id === serviceId)) continue;
    const inserted = await trx('product_inventory_settings')
      .insert({
        tenant,
        service_id: serviceId,
        track_stock: true,
        is_serialized: isSerialized,
        cost_currency: 'USD',
      })
      .onConflict(['tenant', 'service_id'])
      .ignore()
      .returning('service_id');
    settingsCreated += inserted.length;
  }

  const settingsRows = (await trx('product_inventory_settings')
    .where({ tenant })
    .whereIn('service_id', serviceIds)
    .forUpdate()
    .select('service_id', 'track_stock', 'is_serialized', 'average_cost', 'cost_currency')) as SettingsLookupRow[];
  const settingsByService = new Map(settingsRows.map((settings) => [settings.service_id, settings]));

  const oldBulkBasis = new Map<string, { quantity: number; average_cost: number; cost_currency: string }>();
  for (const serviceId of serviceIds) {
    const settings = settingsByService.get(serviceId);
    if (!settings || settings.is_serialized) continue;
    oldBulkBasis.set(serviceId, {
      quantity: await totalOnHand(trx, tenant, serviceId),
      average_cost: Number(settings.average_cost ?? 0),
      cost_currency: settings.cost_currency ?? 'USD',
    });
  }

  let receipts = 0;
  let unitsCreated = 0;
  let totalValueCents = 0;
  const costedBulkReceipts = new Map<string, { quantity: number; total_cost: number }>();

  for (const row of rows) {
    const settings = settingsByService.get(row.service_id);
    const costCurrency = settings?.cost_currency ?? 'USD';
    totalValueCents += row.quantity * (row.unit_cost_cents ?? 0);

    if (row.is_serialized) {
      const [unit] = await trx('stock_units')
        .insert({
          tenant,
          service_id: row.service_id,
          serial_number: row.serial_number,
          mac_address: row.mac_address,
          status: 'in_stock',
          location_id: row.location_id,
          unit_cost: row.unit_cost_cents,
          cost_currency: costCurrency,
          received_at: trx.fn.now(),
        })
        .returning('unit_id');

      await recordStockMovement(trx, tenant, {
        movement_type: 'receipt',
        service_id: row.service_id,
        quantity: 1,
        unit_id: unit.unit_id,
        to_location_id: row.location_id,
        unit_cost: row.unit_cost_cents,
        cost_currency: costCurrency,
        reason,
        performed_by: userId,
      });
      receipts += 1;
      unitsCreated += 1;
      continue;
    }

    await recordStockMovement(trx, tenant, {
      movement_type: 'receipt',
      service_id: row.service_id,
      quantity: row.quantity,
      to_location_id: row.location_id,
      unit_cost: row.unit_cost_cents,
      cost_currency: costCurrency,
      reason,
      performed_by: userId,
    });
    receipts += 1;

    if (row.unit_cost_cents !== null) {
      const aggregate = costedBulkReceipts.get(row.service_id) ?? { quantity: 0, total_cost: 0 };
      aggregate.quantity += row.quantity;
      aggregate.total_cost += row.quantity * row.unit_cost_cents;
      costedBulkReceipts.set(row.service_id, aggregate);
    }
  }

  for (const [serviceId, receipt] of costedBulkReceipts) {
    const oldBasis = oldBulkBasis.get(serviceId);
    if (!oldBasis) continue;
    const denominator = oldBasis.quantity + receipt.quantity;
    const averageCost =
      denominator > 0
        ? Math.round((oldBasis.quantity * oldBasis.average_cost + receipt.total_cost) / denominator)
        : Math.round(receipt.total_cost / receipt.quantity);
    await trx('product_inventory_settings')
      .where({ tenant, service_id: serviceId })
      .update({
        average_cost: averageCost,
        cost_currency: oldBasis.cost_currency,
        updated_at: trx.fn.now(),
      });
  }

  return {
    batch_label: batchLabel,
    receipts,
    units_created: unitsCreated,
    settings_created: settingsCreated,
    total_value_cents: totalValueCents,
  };
}
