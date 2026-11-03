'use client';

import { useRef } from 'react';
import { signIn, type SignInOptions } from 'next-auth/react';

type CredentialOptions = SignInOptions<false>;
const IDENTITY_FIELDS = ['email', 'password', 'userType', 'tenant', 'portalDomain'] as const;

/** Preserve the second factor only while a single-use CAPTCHA must be refreshed. */
export function useCredentialSignIn() {
  const captchaRetry = useRef<{ identity: unknown[]; code: string } | null>(null);

  return async (options: CredentialOptions, twoFactorCode?: string) => {
    const identity = IDENTITY_FIELDS.map((field) => options[field]);
    const pending = captchaRetry.current;
    const code = twoFactorCode || (pending?.identity.every((value, index) => value === identity[index])
      ? pending.code : undefined);
    captchaRetry.current = null;

    const result = await signIn('credentials', {
      ...options,
      ...(code ? { twoFactorCode: code } : {}),
    });
    if (code && result?.code === 'CAPTCHA_REQUIRED') {
      captchaRetry.current = { identity, code };
    }
    return result;
  };
}
