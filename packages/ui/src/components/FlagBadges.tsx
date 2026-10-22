'use client'

import * as React from 'react';
import { useTranslation } from '../lib/i18n/client';
import { Badge, type BadgeSize } from './Badge';
import { cn } from '../lib/utils';

interface FlagBadgeProps {
  /** Badge renders only when this is exactly true; false/null/undefined render nothing. */
  isVip?: boolean | null;
  size?: BadgeSize;
  className?: string;
}

interface PocBadgeProps extends Omit<FlagBadgeProps, 'isVip'> {
  isPoc?: boolean | null;
}

/**
 * "VIP" label for a contact or client. Labelling only - carries no priority/SLA meaning.
 * Renders nothing unless the flag is true (no "Not VIP" noise).
 */
export const VipBadge = ({ isVip, size = 'sm', className }: FlagBadgeProps) => {
  const { t } = useTranslation('common');
  if (isVip !== true) return null;
  return (
    <Badge variant="warning" size={size} className={cn('shrink-0 uppercase tracking-wide', className)} data-testid="vip-badge">
      {t('flags.vip', { defaultValue: 'VIP' })}
    </Badge>
  );
};

/** Point-of-contact label for a contact. Renders nothing unless the flag is true. */
export const PocBadge = ({ isPoc, size = 'sm', className }: PocBadgeProps) => {
  const { t } = useTranslation('common');
  if (isPoc !== true) return null;
  return (
    <Badge variant="info" size={size} className={cn('shrink-0', className)} data-testid="poc-badge">
      {t('flags.poc', { defaultValue: 'POC' })}
    </Badge>
  );
};

interface ContactFlagBadgesProps {
  isVip?: boolean | null;
  isPoc?: boolean | null;
  size?: BadgeSize;
  className?: string;
  /**
   * Space-constrained mode (ticket list cells). Uses the short `flags.pocShort` abbreviation, and
   * merges both flags into ONE badge. Full names stay in aria-label/title. Without it, this
   * renders the regular VipBadge/PocBadge unchanged.
   */
  compact?: boolean;
}

export const ContactFlagBadges = ({ isVip, isPoc, size = 'sm', className, compact = false }: ContactFlagBadgesProps) => {
  const { t } = useTranslation('common');
  if (!compact) {
    return (
      <>
        <VipBadge isVip={isVip} size={size} className={className} />
        <PocBadge isPoc={isPoc} size={size} className={className} />
      </>
    );
  }
  const vip = isVip === true;
  const poc = isPoc === true;
  if (!vip && !poc) return null;

  const vipShort = t('flags.vip', { defaultValue: 'VIP' });
  const pocShort = t('flags.pocShort', { defaultValue: 'POC' });
  const pocFull = t('flags.pocFull', { defaultValue: 'Point of contact' });
  const label = vip && poc ? `${vipShort}, ${pocFull}` : vip ? vipShort : pocFull;
  const text = vip && poc ? `${vipShort}·${pocShort}` : vip ? vipShort : pocShort;
  return (
    <Badge
      variant={vip ? 'warning' : 'info'}
      size={size}
      className={cn('shrink-0 whitespace-nowrap uppercase tracking-wide', className)}
      data-testid={vip && poc ? 'vip-poc-badge' : vip ? 'vip-badge' : 'poc-badge'}
      aria-label={label}
      title={label}
    >
      {text}
    </Badge>
  );
};
