'use client';

import { useRef, useState } from 'react';

export type TwoFactorContinuation = (code: string) => Promise<void>;

/** Keep the password submission in memory only until the challenge is answered or cancelled. */
export function useTwoFactorChallenge() {
  const continuation = useRef<TwoFactorContinuation | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const cancel = () => {
    continuation.current = null;
    setIsOpen(false);
  };

  const request = (submit: TwoFactorContinuation) => {
    continuation.current = submit;
    setIsOpen(true);
  };

  const complete = async (code: string) => {
    const submit = continuation.current;
    // Consume once, before awaiting, so repeated input cannot submit twice.
    // The form owns errors/CAPTCHA and can request a fresh challenge on retry.
    cancel();
    await submit?.(code);
  };

  return { isOpen, request, cancel, complete };
}
