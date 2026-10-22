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
}

/**
 * Compact flag display for space-constrained cells (e.g. ticket list). With both flags set it
 * renders ONE combined "VIP·POC" badge (narrower than two badges plus a gap) whose aria-label and
 * tooltip name each flag in full; a single flag renders the regular badge; no flags renders nothing.
 */
export const ContactFlagBadges = ({ isVip, isPoc, size = 'sm', className }: ContactFlagBadgesProps) => {
  const { t } = useTranslation('common');
  if (isVip === true && isPoc === true) {
    const vip = t('flags.vip', { defaultValue: 'VIP' });
    const poc = t('flags.poc', { defaultValue: 'POC' });
    const full = `${vip}, ${t('flags.pocFull', { defaultValue: 'Point of contact' })}`;
    return (
      <Badge
        variant="warning"
        size={size}
        className={cn('shrink-0 whitespace-nowrap uppercase tracking-wide', className)}
        data-testid="vip-poc-badge"
        aria-label={full}
        title={full}
      >
        {vip}·{poc}
      </Badge>
    );
  }
  return (
    <>
      <VipBadge isVip={isVip} size={size} className={className} />
      <PocBadge isPoc={isPoc} size={size} className={className} />
    </>
  );
};
