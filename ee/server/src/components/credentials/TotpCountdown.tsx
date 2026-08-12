'use client';

/**
 * TOTP countdown ring/label for a revealed credential row.
 *
 * Displays the current rolling code with seconds remaining, re-requesting the
 * code from the server when the 30s window expires while the row stays
 * revealed (the value itself is never cached client-side — only the server
 * returns a fresh code). The seed is never rendered here.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Copy, Timer } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { revealCredential } from '../../lib/actions/credentials/credentialActions';

export interface TotpCountdownProps {
  credentialId: string;
  /** Initial code + remaining seconds from the reveal response. */
  initial: { code: string; secondsRemaining: number };
  /** Rendered after the seed is copied (transient). */
  onCopyCode?: (code: string) => void;
}

export function TotpCountdown({ credentialId, initial, onCopyCode }: TotpCountdownProps) {
  const { t } = useTranslation('msp/credentials');
  const [code, setCode] = useState(initial.code);
  const [secondsRemaining, setSecondsRemaining] = useState(initial.secondsRemaining);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCode(initial.code);
    setSecondsRemaining(initial.secondsRemaining);
  }, [initial.code, initial.secondsRemaining]);

  useEffect(() => {
    if (secondsRemaining <= 0) {
      setIsRefreshing(true);
      revealCredential(credentialId)
        .then((result) => {
          if (result.state === 'ok' && result.otpCode) {
            setCode(result.otpCode.code);
            setSecondsRemaining(result.otpCode.secondsRemaining);
          }
        })
        .catch(() => undefined)
        .finally(() => setIsRefreshing(false));
    }
  }, [secondsRemaining, credentialId]);

  useEffect(() => {
    refreshTimer.current = setTimeout(() => {
      setSecondsRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [secondsRemaining]);

  return (
    <span
      id="credentials-totp-countdown"
      data-code={code}
      data-seconds-remaining={secondsRemaining}
      className="flex items-center gap-2 rounded bg-gray-100 px-2 py-1 text-sm"
    >
      <Timer className="h-3.5 w-3.5" />
      <code id="credentials-totp-code" className="font-mono">
        {code}
      </code>
      <span className="text-xs text-gray-500">
        {t('credentials.reveal.otpExpires', { seconds: secondsRemaining })}
      </span>
      <Button
        id="credentials-totp-copy"
        variant="ghost"
        size="sm"
        onClick={() => onCopyCode?.(code)}
        disabled={isRefreshing}
      >
        <Copy className="h-3.5 w-3.5" />
        {t('credentials.reveal.copyOtp')}
      </Button>
    </span>
  );
}

export default TotpCountdown;
