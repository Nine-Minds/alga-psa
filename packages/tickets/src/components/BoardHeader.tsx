'use client';

import React from 'react';
import type { IBoard } from '@alga-psa/types';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import type { BoardIdentity, BoardListStats } from '../actions/board-actions/boardActions';

/**
 * The board surface: identity, ownership and health above the ticket list.
 *
 * This is what makes a board *look* like itself rather than merely be reachable.
 * The tab strip that shipped before this made a board a place you go; without a
 * header, every board was still the same generic list with a filter applied.
 *
 * Rendered only on a board tab — the All-tickets tab gets no header, because it
 * has no identity to state. There is deliberately no "show the header" toggle: a
 * per-board flag would add a settings control, a document key, a resolution path
 * and a test axis to save 90px on boards an admin could simply unpin, and
 * pinning already expresses which boards are worth the space.
 *
 * Every optional element degrades by *omission*, not by rendering an empty slot:
 * a board with no description, no manager and no SLA policy collapses to its
 * name, which is honest about how much has been configured. Counts are
 * decoration — they arrive out of band exactly as the tab pills do, and the
 * header renders complete without them.
 */

export interface BoardHeaderProps {
  id?: string;
  board: IBoard;
  stats?: BoardListStats | null;
  identity?: BoardIdentity | null;
  /** Avatar URL for the board manager, when one has been resolved. */
  managerAvatarUrl?: string | null;
  t: (key: string, fallback: string) => string;
  /** Reduced scale for the settings-screen preview. */
  compact?: boolean;
  className?: string;
}

interface HealthCount {
  key: string;
  value: number;
  label: string;
  tone: 'neutral' | 'warn' | 'alert';
}

const TONE_CLASS: Record<HealthCount['tone'], string> = {
  neutral: 'text-[rgb(var(--color-text-900))]',
  warn: 'text-amber-600 dark:text-amber-500',
  alert: 'text-red-600 dark:text-red-500',
};

export const BoardHeader: React.FC<BoardHeaderProps> = ({
  id = 'board-header',
  board,
  stats,
  identity,
  managerAvatarUrl,
  t,
  compact = false,
  className = '',
}) => {
  const boardName = board.board_name?.trim();
  const description = board.description?.trim();
  const managerName = identity?.managerName?.trim();
  const slaPolicyName = identity?.slaPolicyName?.trim();

  // Counts are absent (not zero) until stats arrive. Rendering "0 0 0 0" while
  // loading would state something false about the board.
  const counts: HealthCount[] | null = stats
    ? [
        {
          key: 'open',
          value: stats.openTicketCount,
          label: t('dashboard.boardHeader.open', 'Open'),
          tone: 'neutral',
        },
        {
          key: 'overdue',
          value: stats.overdueTicketCount,
          label: t('dashboard.boardHeader.overdue', 'Overdue'),
          tone: stats.overdueTicketCount > 0 ? 'warn' : 'neutral',
        },
        {
          key: 'breached',
          value: stats.slaBreachedTicketCount,
          label: t('dashboard.boardHeader.slaBreach', 'SLA breach'),
          tone: stats.slaBreachedTicketCount > 0 ? 'alert' : 'neutral',
        },
        {
          key: 'unassigned',
          value: stats.unassignedTicketCount,
          label: t('dashboard.boardHeader.unassigned', 'Unassigned'),
          tone: stats.unassignedTicketCount > 0 ? 'warn' : 'neutral',
        },
      ]
    : null;

  const hasOwnership = Boolean(managerName || slaPolicyName);

  return (
    <div
      id={id}
      data-automation-id={id}
      className={[
        'flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 dark:border-[rgb(var(--color-border-200))]',
        compact ? 'px-3 py-2' : 'px-4 py-3',
        className,
      ].join(' ')}
    >
      <div className="min-w-0 flex-1">
        <h2
          className={`${compact ? 'text-sm' : 'text-lg'} font-semibold leading-tight text-[rgb(var(--color-text-900))] truncate`}
        >
          {boardName || t('bulk.move.unnamedBoard', 'Unnamed board')}
        </h2>

        {description && (
          <p
            className={`${compact ? 'text-[11px]' : 'text-sm'} mt-0.5 text-[rgb(var(--color-text-500))] line-clamp-2`}
          >
            {description}
          </p>
        )}

        {hasOwnership && (
          <div
            className={`${compact ? 'text-[11px]' : 'text-xs'} mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[rgb(var(--color-text-500))]`}
          >
            {managerName && (
              <span className="inline-flex items-center gap-1.5">
                <UserAvatar
                  userId={identity?.managerUserId || ''}
                  userName={managerName}
                  avatarUrl={managerAvatarUrl ?? null}
                  size="xs"
                />
                <span className="truncate">
                  {t('dashboard.boardHeader.managedBy', 'Managed by')} {managerName}
                </span>
              </span>
            )}
            {managerName && slaPolicyName && <span aria-hidden="true">·</span>}
            {slaPolicyName && (
              <span className="truncate">
                {t('dashboard.boardHeader.sla', 'SLA')}: {slaPolicyName}
              </span>
            )}
          </div>
        )}
      </div>

      {counts && (
        <div className={`flex shrink-0 items-start ${compact ? 'gap-3' : 'gap-5'}`}>
          {counts.map((count) => (
            <div key={count.key} className="text-right">
              <div
                className={`${compact ? 'text-sm' : 'text-xl'} font-semibold leading-none tabular-nums ${TONE_CLASS[count.tone]}`}
                data-automation-id={`${id}-count-${count.key}`}
              >
                {count.value}
              </div>
              <div
                className={`${compact ? 'text-[9px]' : 'text-[10px]'} mt-1 uppercase tracking-wide text-[rgb(var(--color-text-400))]`}
              >
                {count.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BoardHeader;
