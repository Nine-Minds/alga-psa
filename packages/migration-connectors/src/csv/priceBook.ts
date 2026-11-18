import { AMP_PRICE_ERROR_EXTENSION_KEY, AMP_PRICE_TEXT_EXTENSION_KEY } from '@alga-psa/migration-spec';
import type { CsvConversionDiagnostic, EntityRowsInput } from './engine';
import { isPriceBookTarget, priceColumnCurrency } from './mapping';
import { normalizeCurrencyCode, parseMoneyToMinorUnits } from './values';

/**
 * Expands one price book spreadsheet into the AMP entity streams the existing
 * pipeline understands (plan §4.1):
 *  - `products` / `services` create items or match existing ones (no price on them);
 *  - `catalog_prices` carries one record per price cell, applied at the price book date.
 *
 * Streams are built from canonical-named synthetic rows with an identity
 * mapping, so the CSV engine does all value normalization. Every synthetic row
 * carries an explicit source id built from the ORIGINAL 1-based data row number
 * (`row-<n>`; prices `row-<n>-<CCY|DEFAULT>`), so identities and the report's row
 * order do not depend on which rows were skipped.
 */

export interface PriceBookExpandOptions {
  label: string;
  /** Job currency (or the tenant default); used for a blank currency cell. Explicit, never an assumption marker. */
  defaultCurrency?: string;
  /** Receives warnings carrying original row numbers. */
  diagnostics?: CsvConversionDiagnostic[];
}

const SOURCE_ID = '__source_id';

type ItemKind = 'product' | 'service';

function kindFromCell(value: string | undefined): ItemKind | undefined {
  const text = value?.trim().toLowerCase();
  if (!text) return undefined;
  if (text.startsWith('prod')) return 'product';
  if (text.startsWith('serv')) return 'service';
  return undefined;
}

type Stream = { headers: Set<string>; rows: Array<Record<string, string>> };

function newStream(): Stream {
  return { headers: new Set([SOURCE_ID]), rows: [] };
}

function pushRow(stream: Stream, row: Record<string, string | undefined>): void {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined && value !== '') {
      clean[key] = value;
      stream.headers.add(key);
    }
  }
  stream.rows.push(clean);
}

function toInput(
  entityType: EntityRowsInput['entityType'],
  label: string,
  stream: Stream,
  defaultCurrency: string | undefined,
  extra: Record<string, string> = {}
): EntityRowsInput[] {
  if (stream.rows.length === 0) return [];
  const headers = [...stream.headers];
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    mapping[header] = header === SOURCE_ID ? 'source_record_id' : (extra[header] ?? header);
  }
  return [{ entityType, label, headers, rows: stream.rows, mapping, defaultCurrency }];
}

export function expandPriceBookSheet(
  sheet: { headers: string[]; rows: Array<Record<string, string>> },
  mapping: Record<string, string>,
  options: PriceBookExpandOptions
): EntityRowsInput[] {
  const { label, defaultCurrency, diagnostics } = options;
  const targetHeaders = new Map<string, string[]>();
  for (const [header, target] of Object.entries(mapping)) {
    if (!isPriceBookTarget(target)) {
      throw new Error(`${label}: mapping target "${target}" is not a price book column.`);
    }
    if (!sheet.headers.includes(header)) {
      throw new Error(`${label}: mapped source column "${header}" is not present in the file header (${sheet.headers.join(', ')}).`);
    }
    targetHeaders.set(target, [...(targetHeaders.get(target) ?? []), header]);
  }
  const priceColumns = [...targetHeaders.keys()].filter((target) => priceColumnCurrency(target) !== null);

  const warn = (sourceRow: number, code: string, message: string) =>
    diagnostics?.push({ severity: 'warning', code, message: `${label} row ${sourceRow}: ${message}` });

  const products = newStream();
  const services = newStream();
  const prices = newStream();

  sheet.rows.forEach((row, index) => {
    const n = index + 1;
    const cell = (target: string): string | undefined => {
      for (const header of targetHeaders.get(target) ?? []) {
        const value = row[header];
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
      }
      return undefined;
    };

    const itemRef = cell('item_ref');
    const sku = cell('sku');
    const name = cell('name');
    const kindCell = cell('item_kind');
    const explicitKind = kindFromCell(kindCell);
    if (kindCell && !explicitKind) {
      warn(n, 'CSV_INVALID_ITEM_KIND', `"${kindCell}" is not a recognized item type (product or service); it was inferred from the row.`);
    }
    if (!itemRef && !sku && !name) {
      warn(n, 'CSV_MISSING_REQUIRED', 'required column(s) item_ref, sku, name are all missing; the row was skipped.');
      return;
    }
    const kind: ItemKind = explicitKind ?? (sku ? 'product' : 'service');
    const sourceId = `row-${n}`;
    const itemRecordCreated = !itemRef && Boolean(name);

    if (itemRecordCreated) {
      if (kind === 'product') {
        pushRow(products, {
          [SOURCE_ID]: sourceId,
          name,
          sku,
          category_name: cell('category'),
          unit_of_measure: cell('unit_of_measure'),
          cost_minor: cell('cost'),
          cost_currency: cell('cost_currency'),
          description: cell('description'),
          is_active: cell('is_active'),
        });
      } else {
        pushRow(services, {
          [SOURCE_ID]: sourceId,
          name,
          sku,
          service_type_name: cell('service_type'),
          category_name: cell('category'),
          unit_of_measure: cell('unit_of_measure'),
          description: cell('description'),
          is_active: cell('is_active'),
        });
      }
    }

    const rowCurrencyText = cell('currency');
    const rowCurrency = rowCurrencyText ? normalizeCurrencyCode(rowCurrencyText) : undefined;

    // (price text, currency | error, suffix) per price cell.
    const cells: Array<{ text: string; currency?: string; error?: string; suffix: string }> = [];
    const generic = cell('price');
    if (generic !== undefined) {
      if (rowCurrencyText && !rowCurrency) {
        cells.push({ text: generic, error: 'currency_unsupported', suffix: 'DEFAULT' });
      } else {
        const currency = rowCurrency ?? defaultCurrency;
        cells.push(
          currency
            ? { text: generic, currency, suffix: rowCurrency ?? 'DEFAULT' }
            : { text: generic, error: 'currency_unresolved', suffix: 'DEFAULT' }
        );
      }
    }
    for (const target of priceColumns) {
      const text = cell(target);
      if (text !== undefined) cells.push({ text, currency: priceColumnCurrency(target) as string, suffix: priceColumnCurrency(target) as string });
    }

    if (cells.length === 0 && !itemRecordCreated) {
      warn(n, 'CSV_MISSING_REQUIRED', 'the row has no price and creates no item; it was skipped.');
    }

    for (const priceCell of cells) {
      let error = priceCell.error;
      let amount: string | undefined;
      if (!error && priceCell.currency) {
        const parsed = parseMoneyToMinorUnits(priceCell.text, priceCell.currency);
        if (parsed.ok) amount = priceCell.text;
        else error = parsed.reason;
      }
      if (error) {
        warn(n, 'CSV_INVALID_PRICE', `price "${priceCell.text}" could not be read (${error}); the row will be reported as invalid.`);
      }
      pushRow(prices, {
        [SOURCE_ID]: `${sourceId}-${priceCell.suffix}`,
        product_package_record_id: itemRecordCreated && kind === 'product' ? sourceId : undefined,
        service_package_record_id: itemRecordCreated && kind === 'service' ? sourceId : undefined,
        item_kind: explicitKind ?? (itemRef ? undefined : kind),
        item_ref: itemRef,
        sku,
        name,
        service_type_name: kind === 'service' ? cell('service_type') : undefined,
        currency: error === 'currency_unresolved' || error === 'currency_unsupported' ? undefined : priceCell.currency,
        rate_minor: amount,
        [AMP_PRICE_TEXT_EXTENSION_KEY]: error ? priceCell.text : undefined,
        [AMP_PRICE_ERROR_EXTENSION_KEY]: error,
      });
    }
  });

  const priceExtensions = {
    [AMP_PRICE_TEXT_EXTENSION_KEY]: AMP_PRICE_TEXT_EXTENSION_KEY,
    [AMP_PRICE_ERROR_EXTENSION_KEY]: AMP_PRICE_ERROR_EXTENSION_KEY,
  };
  return [
    ...toInput('products', label, products, defaultCurrency),
    ...toInput('services', label, services, defaultCurrency),
    // Prices never assume a currency: it is explicit per cell, so no default is passed.
    ...toInput('catalog_prices', label, prices, undefined, priceExtensions),
  ];
}
