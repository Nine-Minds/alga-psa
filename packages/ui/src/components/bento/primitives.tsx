'use client';

import React from 'react';

/** In-body loading block for a tile whose chrome is already painted. */
export function TileSkeleton({ id }: { id: string }) {
  return <div id={id} className="animate-pulse skeleton-fill h-16 rounded-md" />;
}

/**
 * Calendar-leaf date block used at the left edge of a scheduled-work row.
 * Month and day are pre-formatted by the caller so locale handling stays with
 * the data that knows its own timezone.
 */
export function BentoDateChip({ id, month, day, className }: { id?: string; month: string; day: string; className?: string }) {
  return (
    <div
      id={id}
      className={`w-10 flex-shrink-0 rounded-md bg-[rgb(var(--color-primary-50))] dark:bg-[rgb(var(--color-primary-400)/0.15)] text-center py-1 ${className ?? ''}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--color-primary-500))]">{month}</div>
      <div className="text-base font-semibold leading-none text-[rgb(var(--color-primary-600))] dark:text-[rgb(var(--color-primary-300))]">
        {day}
      </div>
    </div>
  );
}

/** Divided item list — the standard body for a tile that lists records. */
export function BentoRowList({ id, className, children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <ul id={id} className={`divide-y divide-[rgb(var(--color-border-100))] ${className ?? ''}`}>
      {children}
    </ul>
  );
}

const ROW_ALIGN = {
  baseline: 'items-baseline',
  center: 'items-center',
  start: 'items-start',
} as const;

/**
 * One row of a `BentoRowList`. The default single-line shape truncates its
 * subject and pins `meta` to the right edge; `stacked` drops the flex row for
 * rows that carry their own multi-line layout.
 */
export function BentoRow({
  id,
  meta,
  align = 'baseline',
  stacked = false,
  className,
  children,
}: {
  id?: string;
  /** Right-edge metadata (date, size, amount). Never shrinks. */
  meta?: React.ReactNode;
  align?: keyof typeof ROW_ALIGN;
  /** Render as a block so the row can stack its own lines. */
  stacked?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const layout = stacked ? '' : `flex ${ROW_ALIGN[align]} gap-2`;
  return (
    <li id={id} className={`py-1.5 first:pt-0 last:pb-0 text-sm ${layout} ${className ?? ''}`}>
      {children}
      {meta != null ? <BentoRowMeta>{meta}</BentoRowMeta> : null}
    </li>
  );
}

/** Right-edge metadata span, for rows that build their own inner flex line. */
export function BentoRowMeta({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`ml-auto flex-shrink-0 text-xs text-[rgb(var(--color-text-400))] whitespace-nowrap ${className ?? ''}`}>
      {children}
    </span>
  );
}

/** Headline number + caption, for the stat strip at the top of a tile. */
export function BentoStat({ id, value, label }: { id?: string; value: React.ReactNode; label: string }) {
  return (
    <div id={id}>
      <div className="text-2xl font-bold leading-tight text-[rgb(var(--color-text-900))]">{value}</div>
      <div className="text-xs text-[rgb(var(--color-text-500))]">{label}</div>
    </div>
  );
}

export type BentoChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const CHIP_TONE: Record<BentoChipTone, string> = {
  neutral: 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-500))]',
  info: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  success: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  warning: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300',
  danger: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
};

/** Chip / pill from the type scale: a one-word state or count marker. */
export function BentoChip({
  id,
  tone = 'neutral',
  title,
  style,
  className,
  children,
}: {
  id?: string;
  tone?: BentoChipTone;
  title?: string;
  /** Escape hatch for server-supplied colors (priority, board), not a theme override. */
  style?: React.CSSProperties;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      id={id}
      title={title}
      style={style}
      className={`inline-block flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${style ? '' : CHIP_TONE[tone]} ${className ?? ''}`}
    >
      {children}
    </span>
  );
}

/** Micro badge: a bordered 2–5 character marker such as a file extension. */
export function BentoMicroBadge({ id, className, children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <span
      id={id}
      className={`flex-shrink-0 rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] px-1 py-0.5 text-[9px] font-semibold tracking-wide text-[rgb(var(--color-text-500))] ${className ?? ''}`}
    >
      {children}
    </span>
  );
}

export interface BentoFooterLink {
  id: string;
  label: string;
  /** Optional leading glyph (`h-3 w-3`), e.g. a gear for a settings destination. */
  icon?: React.ReactNode;
  onClick: () => void;
}

/**
 * Contextual entry links pinned to a tile's bottom edge (`mt-auto`), so
 * footers align across a bento row of equal-height tiles. Only live links
 * render — a `null` entry means the destination doesn't exist for this tenant.
 */
export function BentoFooterLinks({
  idPrefix,
  links,
}: {
  idPrefix: string;
  links: Array<BentoFooterLink | null | undefined>;
}) {
  const live = links.filter((link): link is BentoFooterLink => link != null);
  if (live.length === 0) return null;
  return (
    <div className="mt-auto">
      <div className="mt-3 pt-2 border-t border-[rgb(var(--color-border-100))] text-xs">
        {live.map((link, index) => (
          <React.Fragment key={link.id}>
            {index > 0 && <span className="mx-1.5 text-[rgb(var(--color-text-300))]">·</span>}
            <button
              id={`${idPrefix}-link-${link.id}`}
              type="button"
              onClick={link.onClick}
              className="inline-flex items-center gap-1 font-semibold text-[rgb(var(--color-primary-600))] hover:text-[rgb(var(--color-primary-800))]"
            >
              {link.icon}
              {link.label}
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
