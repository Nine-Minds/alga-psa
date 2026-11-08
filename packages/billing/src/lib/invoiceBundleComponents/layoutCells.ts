import type {
  InvoiceBundleRowsLayout,
  TemplateChildRowCell,
  TemplateValueExpression,
  TemplateValueFormat,
  WasmInvoiceBundleComponent,
} from '@alga-psa/types';
import { decodeTemplatePathExpression } from '../invoice-template-ast/templateInterpolationFilters';

/** The line-item roles a fixed-column surface (the portal details dialog) draws. */
export type BundleRowRole = keyof InvoiceBundleRowsLayout['columnIds'];

export const BUNDLE_ROW_ROLES: readonly BundleRowRole[] = ['description', 'quantity', 'unitPrice', 'total'];

export interface BundleCellFormatters {
  currency: (amount: number) => string;
  number: (value: number) => string;
  date: (value: string) => string;
  /** `component.periodLabelStart|daterange`: start and the sibling `periodLabelEnd`. */
  dateRange: (start: string, end: string | null) => string;
}

export interface ResolvedBundleCellLine {
  text: string;
  supplemental: boolean;
}

export interface ResolvedBundleCell {
  lines: ResolvedBundleCellLine[];
  /** Signed quantity change; null when absent or zero. */
  change: number | null;
}

type Scope = Record<string, unknown>;

const getPath = (scope: Scope, path: string): unknown =>
  path.split('.').reduce<unknown>((value, segment) => {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, scope);

const siblingPath = (path: string, from: string, to: string) =>
  path.endsWith(from) ? `${path.slice(0, -from.length)}${to}` : null;

const formatScalar = (value: unknown, format: TemplateValueFormat | undefined, fmt: BundleCellFormatters): string => {
  // An unbound value is blank whatever the format (currency would otherwise render $0.00).
  if (value === undefined || value === null || value === '') return '';
  if (format === 'currency' || format === 'number') {
    const numeric = typeof value === 'number' ? value : Number(String(value));
    if (Number.isFinite(numeric)) return format === 'currency' ? fmt.currency(numeric) : fmt.number(numeric);
  }
  if (format === 'date') return fmt.date(String(value));
  return String(value);
};

const resolvePath = (rawPath: string, format: TemplateValueFormat | undefined, scope: Scope, fmt: BundleCellFormatters): string => {
  const { path, filter } = decodeTemplatePathExpression(rawPath);
  const value = getPath(scope, path);
  if (filter === 'daterange') {
    if (value === undefined || value === null || value === '') return '';
    const endPath = siblingPath(path, 'Start', 'End');
    const end = endPath ? getPath(scope, endPath) : null;
    return fmt.dateRange(String(value), end === undefined || end === null || end === '' ? null : String(end));
  }
  return formatScalar(value, filter === 'currency' ? 'currency' : format, fmt);
};

const resolveExpression = (
  expression: TemplateValueExpression | undefined,
  format: TemplateValueFormat | undefined,
  scope: Scope,
  fmt: BundleCellFormatters,
): string => {
  if (!expression) return '';
  switch (expression.type) {
    case 'literal':
      return formatScalar(expression.value, format, fmt);
    case 'path':
      return resolvePath(expression.path, format, scope, fmt);
    case 'template':
      return expression.template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, token: string) => resolvePath(token, undefined, scope, fmt));
    case 'i18n':
      return expression.defaultValue;
    default:
      // Named bindings are document-level values; component rows have none.
      return '';
  }
};

const resolveChange = (cell: TemplateChildRowCell, scope: Scope): number | null => {
  if (!cell.change || cell.change.value.type !== 'path') return null;
  const raw = getPath(scope, decodeTemplatePathExpression(cell.change.value.path).path);
  const numeric = typeof raw === 'number' ? raw : Number(raw ?? Number.NaN);
  return Number.isFinite(numeric) && numeric !== 0 ? numeric : null;
};

/**
 * One component row's cells, by role, exactly as the template's childRows
 * define them (same rules as the template renderer: stacked lines win over the
 * flat value when any resolves, a column with no cell renders empty). Lets a
 * surface with its own fixed columns follow the template rather than
 * hardcoding which component fields appear.
 */
export function resolveBundleRowCells(
  layout: InvoiceBundleRowsLayout,
  component: WasmInvoiceBundleComponent,
  parentItem: Record<string, unknown>,
  fmt: BundleCellFormatters,
): Record<BundleRowRole, ResolvedBundleCell | null> {
  const { childRows, columnIds } = layout;
  const scope: Scope = { item: parentItem, [childRows.itemBinding || 'component']: component };
  const result = {} as Record<BundleRowRole, ResolvedBundleCell | null>;
  for (const role of BUNDLE_ROW_ROLES) {
    const cell = childRows.cells[columnIds[role]];
    if (!cell) {
      result[role] = null;
      continue;
    }
    const stacked = (cell.lines ?? [])
      .map((line) => ({
        text: resolveExpression(line.value, line.format ?? cell.format, scope, fmt),
        supplemental: Boolean(line.supplemental),
      }))
      .filter((line) => line.text.trim().length > 0);
    const flat = resolveExpression(cell.value, cell.format, scope, fmt);
    const lines = stacked.length > 0
      ? stacked
      : flat.trim().length > 0 ? [{ text: flat, supplemental: false }] : [];
    result[role] = { lines, change: resolveChange(cell, scope) };
  }
  return result;
}

/** Whether the template blanks this role's cell on a bundle (parent) row that has component rows. */
export const isBundleParentRoleBlank = (layout: InvoiceBundleRowsLayout | null | undefined, role: BundleRowRole): boolean =>
  Boolean(layout?.childRows.parentBlankColumns?.includes(layout.columnIds[role]));
