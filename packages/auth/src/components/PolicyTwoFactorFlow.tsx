"use client";

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, Input, Button, Alert, AlertDescription } from '@alga-psa/ui/components';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import TwoFactorInput from './TwoFA';
import type {
  ForcedEnrollmentCredentials,
  ForcedEnrollmentErrorCode,
} from '../actions/auth-actions/forcedTwoFactorEnrollmentActions';

// Loaded on demand so rendering the sign-in page does not pull the server-action
// graph into the initial client bundle (enrollment is a rare path).
const loadEnrollmentActions = () => import('../actions/auth-actions/forcedTwoFactorEnrollmentActions');

/**
 * Second-factor steps of a password sign-in driven by the server's error codes:
 *  - `code`   (TWO_FACTOR_REQUIRED): prompt for the authenticator code, then resubmit.
 *  - `enroll` (TWO_FACTOR_ENROLLMENT_REQUIRED): tenant policy requires 2FA and the user
 *    has none, so show a QR/secret, verify the first code, then resubmit with that code.
 * Shared by the MSP and client-portal login forms.
 */
export type PolicyTwoFactorStep = 'code' | 'enroll' | null;

interface PolicyTwoFactorFlowProps {
  step: PolicyTwoFactorStep;
  credentials: ForcedEnrollmentCredentials;
  /** Called with a 6-digit code once the user supplied one (or finished enrollment). */
  onCode: (code: string) => void;
  onCancel: () => void;
  idPrefix: string;
}

export default function PolicyTwoFactorFlow({
  step,
  credentials,
  onCode,
  onCancel,
  idPrefix,
}: PolicyTwoFactorFlowProps) {
  const { t } = useTranslation('common', { useSuspense: false });
  const [secret, setSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [errorCode, setErrorCode] = useState<ForcedEnrollmentErrorCode | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (step !== 'enroll') {
      setSecret(null);
      setQrDataUrl(null);
      setCode('');
      setErrorCode(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    loadEnrollmentActions()
      .then((actions) => actions.beginForcedTwoFactorEnrollment(credentials))
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.secret) {
          setSecret(result.secret);
          setQrDataUrl(result.qrDataUrl ?? null);
        } else {
          setErrorCode(result.error ?? 'unavailable');
        }
      })
      .catch(() => !cancelled && setErrorCode('unavailable'))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
    // Credentials are captured when the step opens; they do not change while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function verifyEnrollment() {
    if (!secret) return;
    setBusy(true);
    setErrorCode(null);
    try {
      const { completeForcedTwoFactorEnrollment } = await loadEnrollmentActions();
      const result = await completeForcedTwoFactorEnrollment({ ...credentials, secret, code });
      if (result.success) {
        onCode(code);
      } else {
        setErrorCode(result.error ?? 'unavailable');
      }
    } catch {
      setErrorCode('unavailable');
    } finally {
      setBusy(false);
    }
  }

  if (step === null) {
    return null;
  }

  if (step === 'code') {
    return <TwoFactorInput isOpen onClose={onCancel} onComplete={onCode} />;
  }

  return (
    <Dialog isOpen onClose={onCancel} className="max-w-md" id={`${idPrefix}-2fa-enroll-dialog`}>
      <DialogContent className="p-0">
        <div className="p-8 space-y-4">
          <h2 className="text-2xl font-bold text-center">{t('auth.twoFactor.enroll.title')}</h2>
          <p className="text-sm text-[rgb(var(--color-text-500))] text-center">
            {t('auth.twoFactor.enroll.instructions')}
          </p>
          {qrDataUrl && (
            <div className="flex justify-center">
              {/* data: URL QR code; next/image adds nothing here */}
              <img src={qrDataUrl} alt={t('auth.twoFactor.enroll.qrAlt')} className="h-44 w-44" />
            </div>
          )}
          {secret && (
            <p className="text-xs text-center text-[rgb(var(--color-text-500))]">
              {t('auth.twoFactor.enroll.manualKey')}{' '}
              <code className="font-mono break-all" id={`${idPrefix}-2fa-enroll-secret`}>{secret}</code>
            </p>
          )}
          <Input
            id={`${idPrefix}-2fa-enroll-code`}
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            placeholder={t('auth.twoFactor.codeLabel')}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={!secret || busy}
          />
          {errorCode && (
            <Alert variant="destructive" id={`${idPrefix}-2fa-enroll-error`}>
              <AlertDescription>{t(`auth.twoFactor.enroll.errors.${errorCode}`)}</AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2 justify-end">
            <Button id={`${idPrefix}-2fa-enroll-cancel`} type="button" variant="outline" onClick={onCancel}>
              {t('auth.twoFactor.enroll.cancel')}
            </Button>
            <Button
              id={`${idPrefix}-2fa-enroll-verify`}
              type="button"
              onClick={verifyEnrollment}
              disabled={!secret || busy || code.length !== 6}
            >
              {t('auth.twoFactor.verify')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
