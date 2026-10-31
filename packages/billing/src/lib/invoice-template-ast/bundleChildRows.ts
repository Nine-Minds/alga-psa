import type { TemplateDynamicTableNode } from '@alga-psa/types';

export type BundleChildRows = NonNullable<TemplateDynamicTableNode['childRows']>;

export interface BundleChildRowsPresetOptions {
  /** Bind component prices. Binding a price is what lets component prices reach client-visible data. */
  prices: boolean;
  /** Show the green +N / red −N change beside each quantity. */
  showChange: boolean;
}

/**
 * The one definition of "bundle component rows" for a line-items table whose
 * columns are `description`, `quantity`, `unit-price`, `line-total`. The
 * standard template and the designer's presets both build from it, so what the
 * designer produces is exactly what ships.
 */
export function buildBundleChildRowsPreset(options: BundleChildRowsPresetOptions): BundleChildRows {
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
    parentBlankColumns: options.prices ? [] : ['quantity', 'unit-price'],
    cells: {
      description: {
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
      quantity,
      ...(options.prices
        ? {
            'unit-price': { value: { type: 'path' as const, path: 'component.unitPrice' }, format: 'currency' as const },
            'line-total': { value: { type: 'path' as const, path: 'component.total' }, format: 'currency' as const },
          }
        : {}),
    },
  };
}

/** Which preset (if any) a table's childRows matches; 'custom' for hand-authored ones. */
export function detectBundleChildRowsPreset(childRows: unknown): 'off' | 'quantities' | 'quantities-and-prices' | 'custom' {
  if (!childRows) return 'off';
  for (const showChange of [true, false]) {
    const candidates: Array<['quantities' | 'quantities-and-prices', boolean]> = [['quantities', false], ['quantities-and-prices', true]];
    for (const [name, prices] of candidates) {
      if (JSON.stringify(childRows) === JSON.stringify(buildBundleChildRowsPreset({ prices, showChange }))) return name;
    }
  }
  return 'custom';
}
