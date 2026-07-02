'use client';

import React from 'react';
import { cn } from '@alga-psa/ui/lib/utils';
import { AccountingBrandMark, type AccountingBrand } from './accountingBrandLogos';

/**
 * Shared layout primitives for the accounting integration panels.
 *
 * The panels follow a "focal banner + quiet groups" hierarchy: one elevated
 * StatusBanner owns the top (the summary and primary actions), and everything
 * else recedes into SettingsGroups — labelled hairline sections that read as
 * supporting detail rather than competing surfaces.
 */

export function StatusBanner({
  id,
  className,
  children
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      id={id}
      className={cn(
        'rounded-2xl border bg-gradient-to-b from-[#faf8ff] to-white px-[22px] py-5 shadow-[0_2px_8px_rgba(15,23,42,0.06)]',
        className
      )}
    >
      {children}
    </div>
  );
}

type HeroTone = 'green' | 'amber' | 'sky' | 'grey';

const HERO_CHIP: Record<HeroTone, string> = {
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  sky: 'bg-sky-50 text-sky-700',
  grey: 'bg-muted text-muted-foreground'
};
const HERO_DOT: Record<HeroTone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  sky: 'bg-sky-500',
  grey: 'bg-muted-foreground/60'
};

/**
 * The focal hero for an integration panel: brand mark + product name on an
 * elevated surface, with an optional status chip, a one-line subtitle, and the
 * panel's primary actions. This is the single strong element each panel leads
 * with — everything below it recedes into SettingsGroups.
 */
export function PanelHero({
  id,
  brand,
  title,
  status,
  subtitle,
  actions,
  extra
}: {
  id?: string;
  brand: AccountingBrand;
  title: React.ReactNode;
  status?: { tone: HeroTone; label: React.ReactNode };
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Rendered inside the banner, beneath the hero row (e.g. an attention strip). */
  extra?: React.ReactNode;
}) {
  return (
    <StatusBanner id={id}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <AccountingBrandMark brand={brand} size="lg" />
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold leading-tight text-foreground">
              {title}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
              {status ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
                    HERO_CHIP[status.tone]
                  )}
                >
                  <span
                    className={cn('h-1.5 w-1.5 rounded-full', HERO_DOT[status.tone])}
                    aria-hidden="true"
                  />
                  {status.label}
                </span>
              ) : null}
              {subtitle ? <span className="min-w-0">{subtitle}</span> : null}
            </div>
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {extra}
    </StatusBanner>
  );
}

export function SettingsGroup({
  id,
  title,
  action,
  className,
  children
}: {
  id?: string;
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between gap-3 border-b pb-[9px]">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
          {title}
        </h3>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
