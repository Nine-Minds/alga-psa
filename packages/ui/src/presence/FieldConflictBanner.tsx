'use client';

import React, { useId } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Alert, AlertDescription } from '../components/Alert';
import { Button } from '../components/Button';
import { useTranslation } from '../lib/i18n/client';

export interface FieldConflictBannerProps {
  remoteValue: React.ReactNode;
  remoteAuthor: string;
  remoteAt: string | Date;
  onKeepYours: () => void;
  onTakeTheirs: () => void;
  className?: string;
}

function formatRelativeTimestamp(remoteAt: string | Date) {
  return formatDistanceToNow(new Date(remoteAt), { addSuffix: true });
}

function interpolate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{{${key}}}`, value),
    template
  );
}

export function FieldConflictBanner({
  remoteValue,
  remoteAuthor,
  remoteAt,
  onKeepYours,
  onTakeTheirs,
  className = '',
}: FieldConflictBannerProps) {
  const { t } = useTranslation('common');
  const reactId = useId();
  const buttonIdBase = reactId.replace(/:/g, '-');
  const relativeTimestamp = formatRelativeTimestamp(remoteAt);
  const changedFieldMessage = interpolate(
    t('presence.conflict.changedField', '{{author}} just changed this field {{time}}.'),
    { author: remoteAuthor, time: relativeTimestamp }
  );

  return (
    <Alert
      variant="warning"
      className={`mt-2 space-y-3 border border-[rgb(var(--color-warning-300))] ${className}`.trim()}
    >
      <AlertDescription className="space-y-3">
        <div className="space-y-1">
          <p className="font-medium text-[rgb(var(--color-text-900))]">
            {changedFieldMessage}
          </p>
          <p className="text-[rgb(var(--color-text-700))]">
            {t('presence.conflict.remoteValue', 'Remote value:')}{' '}
            <span className="font-medium text-[rgb(var(--color-text-900))]">{remoteValue}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            id={`${buttonIdBase}-keep-yours`}
            size="sm"
            autoFocus
            onClick={onKeepYours}
          >
            {t('presence.conflict.keepYours', 'Keep yours')}
          </Button>
          <Button
            id={`${buttonIdBase}-take-theirs`}
            size="sm"
            variant="outline"
            onClick={onTakeTheirs}
          >
            {t('presence.conflict.takeTheirs', 'Take theirs')}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export { formatRelativeTimestamp };
