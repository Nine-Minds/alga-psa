'use client';

import React, { useCallback, useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import type { IComment } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  formatCommentMetadataJson,
  summarizeCommentMetadataForDebug,
} from './commentMetadataDebug';

export interface CommentMetadataDebugModalProps {
  commentId: string;
  metadata: IComment['metadata'] | null | undefined;
  isOpen: boolean;
  onClose: () => void;
}

export function CommentMetadataDebugModal({
  commentId,
  metadata,
  isOpen,
  onClose,
}: CommentMetadataDebugModalProps): React.ReactElement {
  const { t } = useTranslation('features/tickets');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const summaryRows = summarizeCommentMetadataForDebug(metadata);
  const jsonText = formatCommentMetadataJson(metadata);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 2000);
    }
  }, [jsonText]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('debug.commentMetadata', 'Comment metadata')}
      className="max-w-2xl"
      id={`${commentId}-metadata-debug-dialog`}
      draggable={false}
    >
      <DialogContent>
        <div className="space-y-4">
          <section aria-label={t('debug.summary', 'Summary')}>
            <h3 className="text-sm font-medium text-[rgb(var(--color-text-700))] mb-2">
              {t('debug.summary', 'Summary')}
            </h3>
            {summaryRows.length === 0 ? (
              <p className="text-sm text-[rgb(var(--color-text-500))]">
                {t('debug.noPrioritizedFields', 'No prioritized fields present.')}
              </p>
            ) : (
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                {summaryRows.map((row) => (
                  <React.Fragment key={row.label}>
                    <dt className="text-[rgb(var(--color-text-500))] break-words">{row.label}</dt>
                    <dd className="font-mono text-xs text-[rgb(var(--color-text-900))] break-words">
                      {row.value}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
          </section>
          <section aria-label={t('debug.rawMetadata', 'Raw metadata')}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-medium text-[rgb(var(--color-text-700))]">
                {t('debug.rawJson', 'Raw JSON')}
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                id={`${commentId}-metadata-copy`}
                onClick={() => void handleCopy()}
              >
                {copyState === 'copied'
                  ? t('debug.copied', 'Copied')
                  : copyState === 'error'
                    ? t('debug.copyFailed', 'Copy failed')
                    : t('debug.copy', 'Copy')}
              </Button>
            </div>
            <pre
              className="max-h-64 overflow-auto rounded-md border border-[rgb(var(--color-border-200))] bg-gray-50 p-3 text-xs font-mono whitespace-pre-wrap break-words dark:bg-[rgb(var(--color-border-100))]"
              tabIndex={0}
            >
              {jsonText}
            </pre>
          </section>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button type="button" id={`${commentId}-metadata-debug-close`} onClick={onClose}>
          {t('debug.close', 'Close')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
