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
import { revealCredential } from '../../lib/actions/credentials/credentialActions';
import { TotpCode } from './TotpCode';

export interface TotpCountdownProps {
  credentialId: string;
  /** Initial code + remaining seconds from the reveal response. */
  initial: { code: string; secondsRemaining: number };
  /** Rendered after the seed is copied (transient). */
  onCopyCode?: (code: string) => void;
}

export function TotpCountdown({ credentialId, initial, onCopyCode }: TotpCountdownProps) {
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

  return <TotpCode code={code} secondsRemaining={secondsRemaining} isRefreshing={isRefreshing} onCopy={() => onCopyCode?.(code)} />;
}

export default TotpCountdown;
