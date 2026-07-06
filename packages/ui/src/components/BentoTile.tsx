'use client';

import React from 'react';
import { ReflectionContainer } from '../ui-reflection/ReflectionContainer';

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
  children: React.ReactNode;
}

/** Rounding, border, card background and padding shared by every bento surface (also used by ContentCard's `variant="bento"`). */
export const BENTO_TILE_BASE =
  'rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4';

/** Full tile shell: the shared bento surface plus the tile's vertical flex layout. */
export const BENTO_TILE_SHELL = `${BENTO_TILE_BASE} flex flex-col min-w-0`;

/**
 * Shared surface for every cell in the ticket "Grid" layout. Mirrors the
 * ContentCard look (card token background, border, rounded corners) so Grid
 * and Entry read as the same product.
 */
export function BentoTile({ id, title, icon, action, subtitle, error, className, children }: BentoTileProps) {
  return (
    <ReflectionContainer id={id} label={title ?? id}>
      <section
        id={id}
        className={`${BENTO_TILE_SHELL} ${className ?? ''}`}
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
