'use client';

import React, { useId } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Alert, AlertDescription } from '../components/Alert';
import { Button } from '../components/Button';

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

export function FieldConflictBanner({
  remoteValue,
  remoteAuthor,
  remoteAt,
  onKeepYours,
  onTakeTheirs,
  className = '',
}: FieldConflictBannerProps) {
  const reactId = useId();
  const buttonIdBase = reactId.replace(/:/g, '-');
  const relativeTimestamp = formatRelativeTimestamp(remoteAt);

  return (
    <Alert
      variant="warning"
      className={`mt-2 space-y-3 border border-[rgb(var(--color-warning-300))] ${className}`.trim()}
    >
      <AlertDescription className="space-y-3">
        <div className="space-y-1">
          <p className="font-medium text-[rgb(var(--color-text-900))]">
            {remoteAuthor} just changed this field {relativeTimestamp}.
          </p>
          <p className="text-[rgb(var(--color-text-700))]">
            Remote value: <span className="font-medium text-[rgb(var(--color-text-900))]">{remoteValue}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            id={`${buttonIdBase}-keep-yours`}
            size="sm"
            autoFocus
            onClick={onKeepYours}
          >
            Keep yours
          </Button>
          <Button
            id={`${buttonIdBase}-take-theirs`}
            size="sm"
            variant="outline"
            onClick={onTakeTheirs}
          >
            Take theirs
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export { formatRelativeTimestamp };
