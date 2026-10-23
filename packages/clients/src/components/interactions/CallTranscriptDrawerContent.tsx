'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getInteractionTranscript } from '../../actions/interactionCallArtifactActions';

/** Read-only transcript for the side drawer: no navigation, no download. */
export function CallTranscriptDrawerContent({ documentId }: { documentId: string }) {
  const { t } = useTranslation('msp/clients');
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; name: string; text: string }>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getInteractionTranscript(documentId)
      .then((result) => {
        if (cancelled) return;
        setState(result ? { status: 'ready', name: result.documentName, text: result.text } : { status: 'error' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  return (
    <div className="flex h-full flex-col gap-4 p-6" id="call-transcript-drawer">
      <h2 className="text-lg font-semibold">
        {state.status === 'ready' && state.name
          ? state.name
          : t('interactions.callArtifacts.transcriptTitle', { defaultValue: 'Call transcript' })}
      </h2>
      {state.status === 'loading' && (
        <p className="text-sm text-muted-foreground" id="call-transcript-loading">
          {t('interactions.callArtifacts.loading', { defaultValue: 'Loading transcript…' })}
        </p>
      )}
      {state.status === 'error' && (
        <p className="text-sm text-[rgb(var(--color-accent-600))]" id="call-transcript-error">
          {t('interactions.callArtifacts.loadFailed', { defaultValue: 'The transcript could not be loaded.' })}
        </p>
      )}
      {state.status === 'ready' && (
        <pre id="call-transcript-text" className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
          {state.text}
        </pre>
      )}
    </div>
  );
}

export default CallTranscriptDrawerContent;
