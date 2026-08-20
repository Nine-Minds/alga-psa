'use client';

import React, { useId, useState } from 'react';
import { useTranslation } from '../lib/i18n/client';

export interface FieldWarningsProps {
  warnings: string[];
  onDismiss?: () => void;
  className?: string;
}

/**
 * Field-level plausibility warnings. These are deliberately not styled as
 * errors because they never prevent the user from saving the form.
 */
export function FieldWarnings({
  warnings,
  onDismiss,
  className = '',
}: FieldWarningsProps) {
  const { t } = useTranslation('common');
  const generatedId = useId().replace(/[^a-z0-9]/gi, '').toLowerCase();
  const signature = warnings.join('|');
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);
  const isDismissed = dismissedSignature === signature;

  if (!warnings.length || isDismissed) {
    return null;
  }

  return (
    <div
      role="status"
      data-automation-type="field-warning"
      className={`mt-1 flex items-start gap-2 rounded-md border border-[rgb(var(--color-border-300))] bg-[rgba(var(--color-accent-50),0.35)] px-2 py-1.5 ${className}`.trim()}
    >
      <div className="flex-1 space-y-0.5">
        {warnings.map((warning) => (
          <p key={warning} className="text-xs text-[rgb(var(--color-text-600))]">
            {warning}
          </p>
        ))}
      </div>
      <button
        id={`field-warning-${generatedId}-dismiss`}
        type="button"
        onClick={() => {
          setDismissedSignature(signature);
          onDismiss?.();
        }}
        className="shrink-0 text-xs font-medium text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-text-700))]"
      >
        {t('clients.validation.dismissWarning', { defaultValue: 'Dismiss' })}
      </button>
    </div>
  );
}
