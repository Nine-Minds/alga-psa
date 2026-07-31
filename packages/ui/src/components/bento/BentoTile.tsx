'use client';

import React from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { Button } from '../Button';

interface BentoTileProps {
  id: string;
  /** Tile header text. Omit for headerless tiles (e.g. the hero band). */
  title?: string;
  icon?: React.ReactNode;
  /** Small node rendered at the right edge of the tile header (count chip, add button…). */
  action?: React.ReactNode;
  /** One-line subtitle under the header. */
  subtitle?: string;
  /** When set, the tile body is replaced by a visible error state (fail fast, no blank cards). */
  error?: string | null;
  className?: string;
  /**
   * Replaces the default border/background tokens (e.g. an amber alert tile).
   * A replacement, not an addition — appending would leave two competing
   * background/border classes with stylesheet-order-dependent results.
   */
  surfaceClassName?: string;
  children: React.ReactNode;
}

/**
 * Shared surface for every cell in the ticket "Grid" layout. Mirrors the
 * ContentCard look (card token background, border, rounded corners) so Grid
 * and Entry read as the same product.
 */
export function BentoTile({ id, title, icon, action, subtitle, error, className, surfaceClassName, children }: BentoTileProps) {
  return (
    // ReflectionContainer's div is the element the parent grid/flex actually
    // lays out, so `className` (col-span etc.) must land there, not on the
    // inner <section>.
    <ReflectionContainer id={id} label={title ?? id} className={`min-w-0 ${className ?? ''}`}>
      <section
        id={id}
        className={`rounded-lg border p-4 flex flex-col min-w-0 h-full ${surfaceClassName ?? 'border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]'}`}
      >
        {title ? (
          <div className="flex items-center gap-2 mb-2">
            {icon ? <span className="text-[rgb(var(--color-primary-500))] flex-shrink-0">{icon}</span> : null}
            <h3 className="text-sm font-semibold text-[rgb(var(--color-text-800))] truncate">{title}</h3>
            {action ? <div className="ml-auto flex items-center gap-2 flex-shrink-0">{action}</div> : null}
          </div>
        ) : null}
        {subtitle ? (
          <p className="text-xs text-[rgb(var(--color-text-500))] -mt-1 mb-2">{subtitle}</p>
        ) : null}
        {error ? (
          <div
            id={`${id}-error`}
            className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-800 dark:text-red-300"
          >
            {error}
          </div>
        ) : (
          children
        )}
      </section>
    </ReflectionContainer>
  );
}

/** Standard quiet empty state used inside tiles. */
export function BentoTileEmpty({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-sm text-[rgb(var(--color-text-400))] py-1">
      {children}
    </p>
  );
}

/**
 * The standard header add-affordance for a tile: a small ghost icon button.
 * Give every tile-level "create/attach something here" entry point this shape
 * so the grid reads as one system.
 */
export function BentoTileAddButton({
  id,
  label,
  onClick,
  href,
}: {
  id: string;
  /** Accessible name, e.g. "Create ticket". Rendered as aria-label + tooltip title. */
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const button = (
    <Button id={id} size="sm" variant="ghost" onClick={onClick} aria-label={label} title={label} asChild={Boolean(href)}>
      {href ? (
        <Link href={href}>
          <Plus className="h-4 w-4" />
        </Link>
      ) : (
        <Plus className="h-4 w-4" />
      )}
    </Button>
  );
  return button;
}

/**
 * Inline "+ Do the thing" action rendered under a tile's empty state, so an
 * empty tile is an invitation rather than a dead end.
 */
export function BentoTileEmptyAction({
  id,
  onClick,
  href,
  children,
}: {
  id: string;
  onClick?: () => void;
  href?: string;
  children: React.ReactNode;
}) {
  const className =
    'inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline mt-1';
  if (href) {
    return (
      <Link id={id} href={href} className={className}>
        <Plus className="h-3 w-3" /> {children}
      </Link>
    );
  }
  return (
    <button id={id} type="button" onClick={onClick} className={className}>
      <Plus className="h-3 w-3" /> {children}
    </button>
  );
}

/**
 * Default <Suspense> fallback for a streaming tile: the tile chrome with a
 * pulsing body, so the grid keeps its shape while the tile's server-started
 * data promise resolves.
 */
export function BentoTileSkeleton({
  id,
  title,
  icon,
  lines = 1,
  className,
}: {
  id: string;
  title?: string;
  icon?: React.ReactNode;
  /** Rough content height in pulse blocks (1 block ≈ h-16). */
  lines?: number;
  className?: string;
}) {
  return (
    <BentoTile id={id} title={title} icon={icon} className={className}>
      <div className="space-y-2">
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className="animate-pulse bg-[rgb(var(--color-border-100))] h-16 rounded-md"
          />
        ))}
      </div>
    </BentoTile>
  );
}

export default BentoTile;
