'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';

/**
 * Inline error + retry for an independently-loaded section. A failed query
 * must render as a failure, never as an empty state (D6).
 */
export function SectionLoadError({ id, message, retryLabel, onRetry }: {
  id: string;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>{message}</span>
        <Button id={id} variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export default SectionLoadError;
