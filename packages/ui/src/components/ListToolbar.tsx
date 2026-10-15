'use client';

import * as React from 'react';
import { Filter, XCircle } from 'lucide-react';
import { Button, type ButtonProps } from './Button';
import { Input } from './Input';

/**
 * Presentational pieces of the list-page toolbar shared by the native ticket
 * dashboard and the Customer Tickets list: page heading, the sticky toolbar
 * surface, search field, Filters toggle, Reset, active-filter chips and the
 * collapsible filter panel. They own no data, requests or translations; every
 * label, id and handler comes from the page. The class strings are the ones the
 * native dashboard has always rendered.
 */

// These MUST be literal strings so Tailwind's scanner generates the arbitrary utilities; do not build
// them via interpolation. Applied to the first filter row and to a `display:contents` wrapper where a row
// holds non-filter controls.
const FILTER_CONTROL_SHARED = '[&_button]:!min-h-0 [&_button]:!py-0 [&_button]:!items-center';
const FILTER_CONTROL_30_12 = `[&_button]:!h-[30px] [&_input]:!h-[30px] [&_button]:!text-[12px] [&_input]:!text-[12px] ${FILTER_CONTROL_SHARED}`;
const FILTER_CONTROL_32_12 = `[&_button]:!h-[32px] [&_input]:!h-[32px] [&_button]:!text-[12px] [&_input]:!text-[12px] ${FILTER_CONTROL_SHARED}`;
const FILTER_CONTROL_34_13 = `[&_button]:!h-[34px] [&_input]:!h-[34px] [&_button]:!text-[13px] [&_input]:!text-[13px] ${FILTER_CONTROL_SHARED}`;
const FILTER_CONTROL_36_13 = `[&_button]:!h-[36px] [&_input]:!h-[36px] [&_button]:!text-[13px] [&_input]:!text-[13px] ${FILTER_CONTROL_SHARED}`;
const FILTER_CONTROL_38_14 = `[&_button]:!h-[38px] [&_input]:!h-[38px] [&_button]:!text-[14px] [&_input]:!text-[14px] ${FILTER_CONTROL_SHARED}`;

export interface ListFilterDensity {
  filterPadding: string;
  filterGap: string;
  filterControlClass: string;
}

/** Indexed by density level / 10. The toolbar's padding, gap and control size for each density step. */
export const LIST_FILTER_DENSITY_PRESETS: ReadonlyArray<ListFilterDensity> = [
  { filterPadding: 'p-3',   filterGap: 'gap-2',   filterControlClass: FILTER_CONTROL_30_12 },
  { filterPadding: 'p-3',   filterGap: 'gap-2',   filterControlClass: FILTER_CONTROL_30_12 },
  { filterPadding: 'p-3.5', filterGap: 'gap-2.5', filterControlClass: FILTER_CONTROL_32_12 },
  { filterPadding: 'p-3.5', filterGap: 'gap-2.5', filterControlClass: FILTER_CONTROL_32_12 },
  { filterPadding: 'p-4',   filterGap: 'gap-3',   filterControlClass: FILTER_CONTROL_34_13 },
  { filterPadding: 'p-5',   filterGap: 'gap-4',   filterControlClass: FILTER_CONTROL_34_13 },
  { filterPadding: 'p-5',   filterGap: 'gap-4',   filterControlClass: FILTER_CONTROL_36_13 },
  { filterPadding: 'p-6',   filterGap: 'gap-5',   filterControlClass: FILTER_CONTROL_36_13 },
  { filterPadding: 'p-6',   filterGap: 'gap-5',   filterControlClass: FILTER_CONTROL_38_14 },
  { filterPadding: 'p-7',   filterGap: 'gap-6',   filterControlClass: FILTER_CONTROL_38_14 },
  { filterPadding: 'p-8',   filterGap: 'gap-6',   filterControlClass: FILTER_CONTROL_38_14 },
];

/** The preset index for a 0-100 density level on a step-10 slider. */
export function listDensityIndex(level: number, step = 10): number {
  return Math.min(LIST_FILTER_DENSITY_PRESETS.length - 1, Math.max(0, Math.round(level / step)));
}

/** Debounces a fast-changing value; the native dashboard search uses 500 ms. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState<T>(value);
  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

/**
 * A search box value that applies itself as you type. `committed` is the applied
 * query; `onCommit` runs once the text has been still for `delay` (or immediately
 * from `flush`, e.g. on Enter). An external change to `committed` (Back, Reset)
 * replaces the text, but never one this field emitted itself, so characters typed
 * after a commit are not overwritten.
 */
export function useDebouncedSearchField(committed: string, onCommit: (value: string) => void, delay = 500) {
  const [draft, setDraft] = React.useState(committed);
  const lastEmitted = React.useRef(committed);
  const onCommitRef = React.useRef(onCommit);
  onCommitRef.current = onCommit;

  React.useEffect(() => {
    if (committed !== lastEmitted.current) {
      lastEmitted.current = committed;
      setDraft(committed);
    }
  }, [committed]);

  const debounced = useDebouncedValue(draft, delay);
  React.useEffect(() => {
    if (debounced === lastEmitted.current) return;
    lastEmitted.current = debounced;
    onCommitRef.current(debounced);
  }, [debounced]);

  const flush = React.useCallback(() => {
    if (draft === lastEmitted.current) return;
    lastEmitted.current = draft;
    onCommitRef.current(draft);
  }, [draft]);

  return { draft, setDraft, flush };
}

/**
 * Page heading row: the title on the left, page actions (Share, Add) on the right.
 * An optional subtitle sits under the title.
 */
export function ListPageHeading({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  const heading = <h1 className="text-2xl font-bold text-gray-900">{title}</h1>;
  return (
    <div className="flex justify-between items-center mb-6">
      {subtitle ? (
        <div>
          {heading}
          <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">{subtitle}</p>
        </div>
      ) : heading}
      <div className="flex items-center gap-3">{actions}</div>
    </div>
  );
}

/** The raised card that holds a list's toolbar and results. */
export function ListCard({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className="bg-[rgb(var(--color-card))] shadow rounded-lg" {...rest}>{children}</div>;
}

/** The sticky toolbar band at the top of a ListCard. */
export function ListToolbarSurface({ density, children, ...rest }: { density: Pick<ListFilterDensity, 'filterPadding'> } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`sticky top-0 z-40 bg-[rgb(var(--color-card))] rounded-t-lg border-b border-[rgb(var(--color-border-200))] ${density.filterPadding}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/** First toolbar row: search, Filters, Reset on the left and view controls pushed right by ListToolbarEnd. */
export function ListToolbarRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 flex-wrap">{children}</div>;
}

export function ListToolbarEnd({ children }: { children: React.ReactNode }) {
  return <div className="ml-auto flex items-center gap-2 shrink-0">{children}</div>;
}

export function ListToolbarSearchInput(props: React.ComponentProps<typeof Input>) {
  return <Input className="h-[38px] w-full text-sm" containerClassName="flex-1 min-w-[260px] max-w-[460px]" {...props} />;
}

export function ListToolbarFiltersToggle({ id, open, activeCount, label, onToggle, ...rest }: {
  id: string;
  open: boolean;
  activeCount: number;
  label: React.ReactNode;
  onToggle: () => void;
} & Omit<ButtonProps, 'id' | 'onClick' | 'variant' | 'children'>) {
  return (
    <Button
      id={id}
      variant={open ? 'soft' : 'outline'}
      onClick={onToggle}
      className="shrink-0 flex items-center gap-1.5 h-[38px]"
      {...rest}
    >
      <Filter className="h-4 w-4" />
      {label}
      {activeCount > 0 && (
        <span className="chip-primary ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold">
          {activeCount}
        </span>
      )}
    </Button>
  );
}

/** Reset keeps its place (invisible) while nothing is filtered, so the toolbar does not shift. */
export function ListToolbarResetButton({ id, active, label, onClick }: {
  id: string;
  active: boolean;
  label: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={`shrink-0 flex items-center gap-1 ${active ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
      id={id}
      disabled={!active}
    >
      <XCircle className="h-4 w-4" />
      {label}
    </Button>
  );
}

export interface ListFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
  /** Automation id for the chip's remove button. */
  removeId?: string;
  /** Translated accessible name for the remove button. The toolbar owns no strings. */
  removeLabel: string;
}

export function ListFilterChips({ chips, clearLabel, onClear }: {
  chips: ListFilterChip[];
  clearLabel?: React.ReactNode;
  onClear?: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex items-center flex-wrap gap-2">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="chip-primary inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--color-primary-100))] py-1 pl-2.5 pr-1.5 text-xs font-medium"
        >
          <span className="max-w-[220px] truncate">{chip.label}</span>
          <button
            type="button"
            id={chip.removeId}
            onClick={chip.onRemove}
            aria-label={chip.removeLabel}
            className="chip-primary inline-flex h-4 w-4 items-center justify-center rounded-full hover: hover:"
          >
            <XCircle className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="ml-1 text-xs font-medium text-[rgb(var(--color-text-500))] underline-offset-2 hover:text-[rgb(var(--color-text-700))] hover:underline"
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}

/** The collapsible filter panel under the toolbar row; hold one or more ListFilterRow. */
export function ListFilterPanel({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 pt-1 border-t border-gray-100 dark:border-[rgb(var(--color-border-200))]">{children}</div>;
}

export function ListFilterRow({ density, children }: { density: Pick<ListFilterDensity, 'filterGap' | 'filterControlClass'>; children: React.ReactNode }) {
  return <div className={`flex items-center flex-wrap ${density.filterGap} ${density.filterControlClass}`}>{children}</div>;
}
