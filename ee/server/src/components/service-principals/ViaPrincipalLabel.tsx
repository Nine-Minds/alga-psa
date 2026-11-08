'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export interface ViaPrincipalLabelProps {
  /** Display name of the service principal the action came through. Renders nothing when absent. */
  principalName?: string | null;
  className?: string;
}

/**
 * The "via <principal>" suffix that follows a human's name when a service principal acted on
 * their behalf (PRD R5.8). CE renders the human's name and this slot; the CE stub renders nothing.
 */
export function ViaPrincipalLabel({ principalName, className }: ViaPrincipalLabelProps) {
  const { t } = useTranslation('msp/settings');
  if (!principalName) return null;
  return (
    <span
      data-testid="via-principal-label"
      className={className ?? 'text-[rgb(var(--color-text-500))] font-normal'}
    >
      {t('servicePrincipals.via.label', { defaultValue: 'via {{principal}}', principal: principalName })}
    </span>
  );
}

export default ViaPrincipalLabel;
