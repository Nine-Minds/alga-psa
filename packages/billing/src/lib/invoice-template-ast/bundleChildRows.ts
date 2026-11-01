import type { TemplateDynamicTableNode } from '@alga-psa/types';

export type BundleChildRows = NonNullable<TemplateDynamicTableNode['childRows']>;

export interface BundleChildRowsPresetOptions {
  /** Bind component prices. Binding a price is what lets component prices reach client-visible data. */
  prices: boolean;
  /** Show the green +N / red −N change beside each quantity. */
  showChange: boolean;
  /**
   * Ids of the table's columns the cells attach to. Defaults match the
   * standard templates; the designer passes the ids of the table's actual
   * columns so a custom-built table gets working component rows too.
   */
  columnIds?: Partial<BundleColumnIds>;
}

export interface BundleColumnIds {
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
}

export const DEFAULT_BUNDLE_COLUMN_IDS: BundleColumnIds = {
  description: 'description',
  quantity: 'quantity',
  unitPrice: 'unit-price',
  total: 'line-total',
};

/** Which table column plays which role, judged by its binding key (falls back to the default ids). */
export function resolveBundleColumnIds(columns: Array<{ id: string; key?: unknown }>): BundleColumnIds {
  const byKey = (suffix: string, fallback: string) => {
    const hit = columns.find((column) => typeof column.key === 'string' && column.key.replace(/^item\./, '') === suffix);
    return hit?.id ?? fallback;
  };
  return {
    description: byKey('description', DEFAULT_BUNDLE_COLUMN_IDS.description),
    quantity: byKey('quantity', DEFAULT_BUNDLE_COLUMN_IDS.quantity),
    unitPrice: byKey('unitPrice', DEFAULT_BUNDLE_COLUMN_IDS.unitPrice),
    total: byKey('total', DEFAULT_BUNDLE_COLUMN_IDS.total),
  };
}

/** Component fields an author can bind a column's component cell to. */
export const BUNDLE_COMPONENT_CELL_FIELDS: ReadonlyArray<{
  path: string;
  format: 'text' | 'number' | 'currency';
  /** Binding a money field is what exposes component prices to clients. */
  priced: boolean;
}> = [
  { path: 'component.name', format: 'text', priced: false },
  { path: 'component.quantity', format: 'number', priced: false },
  { path: 'component.periodLabelStart|daterange', format: 'text', priced: false },
  { path: 'component.pricingBasis', format: 'text', priced: false },
  { path: 'component.unitPrice', format: 'currency', priced: true },
  { path: 'component.total', format: 'currency', priced: true },
];

/**
 * The one definition of "bundle component rows" for a line-items table whose
 * columns are `description`, `quantity`, `unit-price`, `line-total`. The
 * standard template and the designer's presets both build from it, so what the
 * designer produces is exactly what ships.
 */
export function buildBundleChildRowsPreset(options: BundleChildRowsPresetOptions): BundleChildRows {
  const ids: BundleColumnIds = { ...DEFAULT_BUNDLE_COLUMN_IDS, ...(options.columnIds ?? {}) };
  const quantity: BundleChildRows['cells'][string] = {
    value: { type: 'path', path: 'component.quantity' },
    format: 'number',
    ...(options.showChange
      ? { change: { value: { type: 'path', path: 'component.quantityChange' }, format: 'signed-number' as const } }
      : {}),
  };
  return {
    sourcePath: 'item.components',
    itemBinding: 'component',
    parentBlankColumns: options.prices ? [] : [ids.quantity, ids.unitPrice],
    cells: {
      [ids.description]: {
        value: { type: 'path', path: 'component.name' },
        lines: [
          { id: 'component-name', value: { type: 'path', path: 'component.name' } },
          {
            id: 'component-period',
            value: { type: 'path', path: 'component.periodLabelStart|daterange' },
            supplemental: true,
            style: { inline: { color: '#6b7280', fontSize: '12px' } },
          },
        ],
      },
      [ids.quantity]: quantity,
      ...(options.prices
        ? {
            [ids.unitPrice]: { value: { type: 'path' as const, path: 'component.unitPrice' }, format: 'currency' as const },
            [ids.total]: { value: { type: 'path' as const, path: 'component.total' }, format: 'currency' as const },
          }
        : {}),
    },
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Structural equality that ignores object key order (jsonb reorders keys) and
 * treats a key set to `undefined` the same as a missing key (jsonb drops them).
 * Array order is significant, except under `parentBlankColumns`, which is a set.
 */
function structurallyEqual(a: unknown, b: unknown, key?: string): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (key === 'parentBlankColumns') {
      const sortedA = [...a].map(String).sort();
      const sortedB = [...b].map(String).sort();
      return sortedA.every((value, index) => value === sortedB[index]);
    }
    return a.every((value, index) => structurallyEqual(value, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!structurallyEqual(a[k], b[k], k)) return false;
    }
    return true;
  }
  return Object.is(a, b);
}

/** Whether a table's childRows binds the quantity-change field (key-order independent). */
export function bundleChildRowsShowChange(childRows: unknown): boolean {
  return JSON.stringify(childRows ?? '').includes('component.quantityChange');
}

/** Which preset (if any) a table's childRows matches; 'custom' for hand-authored ones. */
export function detectBundleChildRowsPreset(childRows: unknown, columnIds?: Partial<BundleColumnIds>): 'off' | 'quantities' | 'quantities-and-prices' | 'custom' {
  if (!childRows) return 'off';
  for (const showChange of [true, false]) {
    const candidates: Array<['quantities' | 'quantities-and-prices', boolean]> = [['quantities', false], ['quantities-and-prices', true]];
    for (const [name, prices] of candidates) {
      if (structurallyEqual(childRows, buildBundleChildRowsPreset({ prices, showChange, columnIds }))) return name;
    }
  }
  return 'custom';
}
