'use client';

import React from 'react';

/**
 * Semantic tone for a state readout. Distinct from `BentoChipTone`, which only
 * styles chips: these drive text and dot colours too, so a surface can express
 * "this is bad" consistently across a headline, a marker, and a chip.
 *
 * Every entry carries an explicit dark pair. The class of bug this exists to
 * prevent is a light-palette background (amber-50) meeting a token-remapped
 * foreground that inverts in dark mode, leaving light text on a light panel.
 */
export type BentoTone = 'good' | 'warn' | 'bad' | 'neutral' | 'info';

export const BENTO_TONE_TEXT: Record<BentoTone, string> = {
  good: 'text-green-700 dark:text-green-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-700 dark:text-red-400',
  info: 'text-[rgb(var(--color-primary-600))] dark:text-[rgb(var(--color-primary-300))]',
  neutral: 'text-[rgb(var(--color-text-600))]',
};

export const BENTO_TONE_DOT: Record<BentoTone, string> = {
  good: 'bg-green-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  info: 'bg-[rgb(var(--color-primary-500))]',
  neutral: 'bg-[rgb(var(--color-border-300))]',
};

/** Status marker. Decorative — the adjacent text must carry the same meaning. */
export function BentoToneDot({ tone, className }: { tone: BentoTone; className?: string }) {
  return (
    <span
      className={`w-2 h-2 rounded-full flex-shrink-0 ${BENTO_TONE_DOT[tone]} ${className ?? ''}`}
      aria-hidden="true"
    />
  );
}

/** Section label above a group of tiles or rows. */
export function BentoEyebrow({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]"
    >
      {children}
    </div>
  );
}

/**
 * Label/value row. `stacked` puts the label above the value — use inside wide
 * multi-column grids, where the default `justify-between` would strand label
 * and value at opposite ends of a wide cell.
 */
export function BentoLabelValue({
  id,
  label,
  value,
  mono,
  stacked,
}: {
  id?: string;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  stacked?: boolean;
}) {
  if (stacked) {
    return (
      <div id={id} className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))] truncate">
          {label}
        </div>
        <div className={`font-medium text-[rgb(var(--color-text-800))] truncate ${mono ? 'font-mono' : ''}`}>
          {value ?? '—'}
        </div>
      </div>
    );
  }
  return (
    <div id={id} className="flex justify-between gap-3 min-w-0">
      <span className="text-[rgb(var(--color-text-500))] flex-shrink-0">{label}</span>
      <span
        className={`font-medium text-[rgb(var(--color-text-800))] truncate text-right ${mono ? 'font-mono' : ''}`}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

/** Inline "View all N" / "+ Add something" action inside a tile. */
export function BentoInlineAction({
  id,
  onClick,
  icon,
  children,
}: {
  id: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline"
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * Utilisation bar for a percentage that may not be known.
 *
 * `percent` of null/undefined renders the unknown state rather than a 0% bar —
 * an unreachable agent must not read as an idle CPU, and an unreported disk
 * must not read as empty. Callers pass their own `unknownLabel` so the phrasing
 * fits the surface ("—", "no data", "not reported").
 */
export function BentoGauge({
  id,
  percent,
  label,
  caption,
  unknownLabel = '—',
}: {
  id?: string;
  percent: number | null | undefined;
  label: string;
  caption?: string;
  unknownLabel?: string;
}) {
  const numeric = typeof percent === 'number' && Number.isFinite(percent) ? percent : null;
  const known = numeric !== null;
  const clamped = numeric === null ? 0 : Math.max(0, Math.min(100, numeric));
  const tone: BentoTone = !known ? 'neutral' : clamped >= 90 ? 'bad' : clamped >= 75 ? 'warn' : 'good';
  return (
    <div id={id} className="min-w-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-xs text-[rgb(var(--color-text-500))] truncate">{label}</span>
        <span
          className={`ml-auto flex-shrink-0 font-mono text-sm ${known ? BENTO_TONE_TEXT[tone] : 'text-[rgb(var(--color-text-400))]'}`}
        >
          {known ? `${Math.round(clamped)}%` : unknownLabel}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-[rgb(var(--color-border-100))] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${known ? BENTO_TONE_DOT[tone] : ''}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {caption ? (
        <div className="mt-0.5 text-xs text-[rgb(var(--color-text-400))] truncate">{caption}</div>
      ) : null}
    </div>
  );
}
