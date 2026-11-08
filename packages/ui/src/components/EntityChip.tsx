'use client';

import * as React from 'react';
import type { IDisplayTag } from '@alga-psa/types';
import ClientAvatar from './ClientAvatar';
import ContactAvatar from './ContactAvatar';
import { Tooltip } from './Tooltip';
import { generateEntityColor } from '../lib/colorUtils';
import { useTranslation } from '../lib/i18n/client';
import { interpolateFallback } from '../lib/i18n/interpolateFallback';
import { cn } from '../lib/utils';

export interface EntityChipProps {
  kind: 'client' | 'contact';
  /** Stable id for the avatar color; falls back to the name. */
  id?: string | null;
  name?: string | null;
  /** Uploaded logo (client) or avatar (contact); initials are the fallback. */
  imageUrl?: string | null;
  /**
   * Tags to show as badges, already filtered and ordered by the display rules. The chip never
   * decides which tags are visible.
   */
  tags?: readonly IDisplayTag[] | null;
  /** Badges shown inline; the rest collapse into a "+n" with the names in a tooltip. */
  maxBadges?: number;
  /** Makes the whole chip a button (stops propagation so a row click does not fire). */
  onClick?: () => void;
  /** DOM id for the click-through button (automation and tests). */
  buttonId?: string;
  /** Shown when there is no entity. */
  emptyLabel?: string;
  /** Extra content after the badges (e.g. a "Multiple clients" label). */
  extra?: React.ReactNode;
  className?: string;
}

const TagBadge = ({ tag }: { tag: IDisplayTag }) => {
  const colors = generateEntityColor({ tag_text: tag.tag_text, background_color: tag.background_color, text_color: tag.text_color } as never);
  return (
    <span
      data-testid="entity-chip-tag"
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none"
      style={{ backgroundColor: colors.background, color: colors.text }}
      title={tag.tag_text}
    >
      {tag.tag_text}
    </span>
  );
};

/**
 * The badge run on its own: the first `maxBadges` tags in the given order, then a "+n" whose tooltip
 * lists the rest. Pickers use this next to their own row layout; `EntityChip` uses it internally.
 */
export const EntityTagBadges = ({ tags, maxBadges = 2 }: { tags?: readonly IDisplayTag[] | null; maxBadges?: number }) => {
  const { t } = useTranslation('common');
  const shown = (tags ?? []).slice(0, Math.max(0, maxBadges));
  const hidden = (tags ?? []).slice(Math.max(0, maxBadges));
  return (
    <>
      {shown.map((tag) => (
        <TagBadge key={tag.tag_id} tag={tag} />
      ))}
      {hidden.length > 0 ? (
        <Tooltip
          content={
            <span className="flex flex-col gap-0.5" data-testid="entity-chip-overflow-list">
              {hidden.map((tag) => (
                <span key={tag.tag_id}>{tag.tag_text}</span>
              ))}
            </span>
          }
        >
          <span
            data-testid="entity-chip-overflow"
            className="inline-flex shrink-0 items-center rounded-full bg-[rgb(var(--color-border-100))] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[rgb(var(--color-text-600))]"
            aria-label={interpolateFallback(
              t('entityChip.moreTags', {
                defaultValue: '{{count}} more tags: {{names}}',
                count: hidden.length,
                names: hidden.map((tag) => tag.tag_text).join(', '),
              }),
              { count: hidden.length, names: hidden.map((tag) => tag.tag_text).join(', ') }
            )}
          >
            +{hidden.length}
          </span>
        </Tooltip>
      ) : null}
    </>
  );
};

/**
 * One way to show a client or a requester anywhere: avatar, name, and the tags the display rules
 * picked for this viewer. Used by the ticket list, ticket header, detail properties and the pickers
 * so a "VIP" badge looks and behaves the same everywhere.
 */
export const EntityChip = ({
  kind,
  id,
  name,
  imageUrl = null,
  tags,
  maxBadges = 2,
  onClick,
  buttonId,
  emptyLabel,
  extra,
  className,
}: EntityChipProps) => {
  const label = name?.trim();

  const avatar = !label ? (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#cbd5e1] text-[10px] font-bold text-white">
      —
    </span>
  ) : kind === 'client' ? (
    <ClientAvatar clientId={id || label} clientName={label} logoUrl={imageUrl ?? null} size="xs" />
  ) : (
    <ContactAvatar contactId={id || label} contactName={label} avatarUrl={imageUrl ?? null} size="xs" />
  );

  const body = (
    <span data-testid="entity-chip" className={cn('flex min-w-0 max-w-full items-center gap-2 overflow-hidden', className)}>
      {avatar}
      <span className="min-w-[6ch] truncate">
        {label || <span className="text-[rgb(var(--color-text-400))]">{emptyLabel ?? '—'}</span>}
      </span>
      <EntityTagBadges tags={tags} maxBadges={maxBadges} />
      {extra}
    </span>
  );

  if (!onClick || !label) {
    return <span className="flex text-[rgb(var(--color-text-700))]">{body}</span>;
  }
  return (
    <button
      id={buttonId}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="min-w-0 max-w-full border-none bg-transparent p-0 text-left text-[rgb(var(--color-text-700))] hover:[&_.truncate]:text-[rgb(var(--color-primary-700))]"
    >
      {body}
    </button>
  );
};

export default EntityChip;
