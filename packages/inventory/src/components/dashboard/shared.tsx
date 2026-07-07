'use client';

import React from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@alga-psa/ui/lib/utils';

/**
 * Shared primitives for the inventory dashboard bento tiles
 * (docs/ui/design_guidelines.md). Tokens only — no raw hex.
 */

export function money(cents: number, dp = 0): string {
  return `$${(Number(cents || 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;
}

export function count(value: number): string {
  return Number(value || 0).toLocaleString();
}

export function pct(value: number, dp = 0): string {
  return `${Number(value || 0).toFixed(dp)}%`;
}

export function clientHref(clientId: string | null | undefined): string {
  return clientId ? `/msp/clients/${clientId}` : '/msp/inventory/sales-orders';
}

/** Signed variant for variances: −$340 / +$40. */
export function moneySigned(cents: number): string {
  const abs = money(Math.abs(cents));
  if (cents < 0) return `−${abs}`;
  if (cents > 0) return `+${abs}`;
  return abs;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function weekdayDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Hero/rail tile surface. Matches BentoTile's surface exactly (rounded-lg,
 * border-200, card bg, p-4) but leaves the header to the caller — these tiles
 * lead with an eyebrow + hero numeral instead of the standard icon+title row.
 * `accent` tints the border/background for the "unbilled" red treatment.
 */
export function HeroTile({
  id,
  accent,
  className,
  children,
}: {
  id: string;
  accent?: 'red';
  className?: string;
  children: React.ReactNode;
}) {
  const surface =
    accent === 'red'
      ? 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-900/10'
      : 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]';
  return (
    <section id={id} className={cn('rounded-lg border p-4 flex flex-col min-w-0 h-full', surface, className)}>
      {children}
    </section>
  );
}

/** Eyebrow label above a hero numeral. */
export function Eyebrow({ tone = 'default', children }: { tone?: 'default' | 'red' | 'primary'; children: React.ReactNode }) {
  const color =
    tone === 'red'
      ? 'text-red-700 dark:text-red-400'
      : tone === 'primary'
        ? 'text-[rgb(var(--color-primary-600))]'
        : 'text-[rgb(var(--color-text-400))]';
  return <div className={`text-[10px] font-semibold uppercase tracking-wider ${color}`}>{children}</div>;
}

/** Small icon chip at a tile's top-right corner. */
export function IconChip({
  tone,
  children,
}: {
  tone: 'red' | 'amber' | 'purple' | 'green';
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    red: 'bg-red-50 text-red-500 dark:bg-red-500/15 dark:text-red-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
    purple: 'bg-primary-50 text-primary-600 dark:bg-[rgb(var(--color-primary-400)/0.15)] dark:text-primary-300',
    green: 'bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-400',
  };
  return (
    <span className={`inline-flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function SectionEmpty({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="py-3 text-sm text-[rgb(var(--color-text-400))]">
      {children}
    </p>
  );
}

export function Dot({ tone }: { tone: 'red' | 'amber' | 'info' | 'primary' }) {
  const tones = {
    red: 'bg-red-500 ring-4 ring-red-500/15',
    amber: 'bg-amber-500 ring-4 ring-amber-500/15',
    info: 'bg-cyan-500 ring-4 ring-cyan-500/15',
    primary: 'bg-[rgb(var(--color-primary-500))] ring-4 ring-[rgb(var(--color-primary-500)/0.15)]',
  };
  return <span className={`h-2 w-2 flex-shrink-0 rounded-full ${tones[tone]}`} />;
}

/** Footer "Do the thing →" link used across tiles. */
export function TileLink({ id, href, children }: { id: string; href: string; children: React.ReactNode }) {
  return (
    <a id={id} href={href} className="inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline">
      {children} <ArrowRight className="h-3 w-3" />
    </a>
  );
}

/** Aging chip, color-stepped: ≥45d red, ≥30d amber, else quiet. */
export function AgePill({ days, prefix = '' }: { days: number | null; prefix?: string }) {
  if (days == null) return null;
  const cls =
    days >= 45
      ? 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400 font-semibold'
      : days >= 30
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'
        : 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-500))]';
  return <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${cls}`}>{prefix}{days}d</span>;
}
