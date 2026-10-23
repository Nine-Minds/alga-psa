'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { getClientAutopaySettings, setClientAutopay, startClientAutopaySetup } from '../../actions/clientBillingProfileActions';

interface AutopayOverview {
  enabled: boolean;
  consentText: string;
  consentTextVersion: string;
  enrollment: null | { is_enabled: boolean; payment_method_id: string; authorized_at: string; authorization_source: string; authorized_by_user_id: string | null };
  methods: Array<{ payment_method_id: string; brand: string | null; last4: string; exp_month: string; exp_year: string; status: string }>;
  chargeableMethods: Array<{ payment_method_id: string; brand: string | null; last4: string; exp_month: string; exp_year: string; status: string }>;
  attempts: Array<{ attempt_id: string; attempt_number: number; status: string; scheduled_for: string; failure_code?: string | null; failure_message?: string | null }>;
}

const isActionError = (value: unknown) => isActionMessageError(value) || isActionPermissionError(value);
// LEVERAGE: pattern autopay-default-method — keep stale enrollment ids out of the chargeable card picker.
const defaultChargeableMethod = (enrollmentMethodId: string | undefined, chargeableMethods: AutopayOverview['chargeableMethods']) =>
  chargeableMethods.find((method) => method.payment_method_id === enrollmentMethodId)?.payment_method_id
    ?? chargeableMethods[0]?.payment_method_id
    ?? '';

export function ClientAutopaySettings({ clientId, billingProfileId, profileName }: { clientId: string; billingProfileId: string; profileName: string }) {
  const { t } = useTranslation('msp/clients');
  const [overview, setOverview] = useState<AutopayOverview | null>(null);
  const [methodId, setMethodId] = useState('');
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [setupUrl, setSetupUrl] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const result = await getClientAutopaySettings(clientId, billingProfileId);
      if (isActionError(result)) throw new Error(getErrorMessage(result));
      const value = result as unknown as AutopayOverview | null;
      setOverview(value);
      setMethodId(defaultChargeableMethod(value?.enrollment?.payment_method_id, value?.chargeableMethods ?? []));
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }, [clientId, billingProfileId]);

  useEffect(() => { void reload(); }, [reload]);

  const changeEnrollment = async (enabled: boolean) => {
    setBusy(true);
    try {
      const result = await setClientAutopay({ clientId, billingProfileId, paymentMethodId: methodId, enabled, consentTextVersion: overview?.consentTextVersion ?? '1', clientAuthorized: enabled ? attested : undefined });
      if (isActionError(result)) throw new Error(getErrorMessage(result));
      toast.success(enabled ? t('clientAutopay.enabled', { defaultValue: 'Auto-pay enabled' }) : t('clientAutopay.disabled', { defaultValue: 'Auto-pay disabled' }));
      setAttested(false);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const copySetupLink = async () => {
    setBusy(true);
    try {
      const result = await startClientAutopaySetup(clientId, billingProfileId);
      if (isActionError(result) || !result?.url) throw new Error(getErrorMessage(result) || 'Unable to create setup link');
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(result.url);
        toast.success(t('clientAutopay.linkCopied', { defaultValue: 'Card setup link copied' }));
      } catch {
        setSetupUrl(result.url);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (!overview?.enabled) return null;
  const enrolled = overview.enrollment?.is_enabled === true;
  const selectedMethod = overview.chargeableMethods.find((method) => method.payment_method_id === methodId);
  const enrolledMethodId = enrolled ? overview.enrollment?.payment_method_id : undefined;
  // Re-enrolling on another card keeps auto-pay on; a pending retry charges the new card promptly.
  const canChangeCard = enrolled && overview.chargeableMethods.some((method) => method.payment_method_id !== enrolledMethodId);
  const cardAuthorization = <>
    <CustomSelect id={`msp-autopay-card-${billingProfileId}`} value={methodId} onValueChange={setMethodId} options={overview.chargeableMethods.map((method) => ({ value: method.payment_method_id, label: `${method.brand ?? 'Card'} •••• ${method.last4} (${method.exp_month}/${method.exp_year}) · ${method.status}` }))} />
    <p className="text-sm text-muted-foreground">{overview.consentText}</p>
    <Checkbox id={`msp-autopay-attestation-${billingProfileId}`} checked={attested} onChange={(event) => setAttested((event.target as HTMLInputElement).checked)} label={t('clientAutopay.attestation', { defaultValue: 'Client has authorized recurring charges' })} />
  </>;

  return <><Card className="mt-3 border-border">
    <CardHeader className="pb-2"><CardTitle className="text-base">{t('clientAutopay.title', { profile: profileName, defaultValue: 'Auto-pay · {{profile}}' })}</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      {enrolled ? <>
        <p className="text-sm">{t('clientAutopay.active', { defaultValue: 'Enabled' })}: {overview.methods.find((method) => method.payment_method_id === overview.enrollment?.payment_method_id)?.brand ?? 'Card'} •••• {overview.methods.find((method) => method.payment_method_id === overview.enrollment?.payment_method_id)?.last4}</p>
        <p className="text-xs text-muted-foreground">{t('clientAutopay.authorization', { source: overview.enrollment?.authorization_source, user: (overview.enrollment as typeof overview.enrollment & { authorized_by_display_name?: string } | null)?.authorized_by_display_name ?? t('clientAutopay.unknownUser', { defaultValue: 'Unknown user' }), date: new Date(overview.enrollment!.authorized_at).toLocaleString(), defaultValue: 'Authorized by {{user}} on {{date}} ({{source}})' })}</p>
        {canChangeCard && <>
          {cardAuthorization}
          <Button id={`msp-change-autopay-card-${billingProfileId}`} disabled={busy || !selectedMethod || methodId === enrolledMethodId || !attested} onClick={() => void changeEnrollment(true)}>{t('clientAutopay.changeCard', { defaultValue: 'Use this card for auto-pay' })}</Button>
        </>}
        <Button id={`msp-disable-autopay-${billingProfileId}`} variant="outline" disabled={busy} onClick={() => void changeEnrollment(false)}>{t('clientAutopay.disable', { defaultValue: 'Disable auto-pay' })}</Button>
      </> : <>
        <Button id={`msp-copy-card-setup-${billingProfileId}`} variant="outline" disabled={busy} onClick={() => void copySetupLink()}>{t('clientAutopay.copySetupLink', { defaultValue: 'Copy setup link' })}</Button>
        {overview.chargeableMethods.length > 0 && <>
          {cardAuthorization}
          <Button id={`msp-enable-autopay-${billingProfileId}`} disabled={busy || !selectedMethod || !attested} onClick={() => void changeEnrollment(true)}>{t('clientAutopay.enable', { defaultValue: 'Enable auto-pay' })}</Button>
        </>}
      </>}
      <div className="space-y-1">
        <p className="text-sm font-medium">{t('clientAutopay.recentAttempts', { defaultValue: 'Recent attempts' })}</p>
        {overview.attempts.length === 0 ? <p className="text-sm text-muted-foreground">{t('clientAutopay.noAttempts', { defaultValue: 'No attempts yet' })}</p> : overview.attempts.map((attempt) => <p key={attempt.attempt_id} className="text-xs text-muted-foreground">{new Date(attempt.scheduled_for).toLocaleDateString()} · {attempt.status}{attempt.failure_code ? ` · ${attempt.failure_code}` : ''}{attempt.failure_message ? `: ${attempt.failure_message}` : ''}</p>)}
      </div>
    </CardContent>
  </Card><Dialog isOpen={!!setupUrl} onClose={() => setSetupUrl(null)} title={t('clientAutopay.setupLinkTitle', { defaultValue: 'Card setup link' })} className="max-w-lg"><DialogContent><p className="mb-3 text-sm text-muted-foreground">{t('clientAutopay.setupLinkFallback', { defaultValue: 'Copy this link to share it with your client.' })}</p><Input id={`msp-card-setup-link-${billingProfileId}`} readOnly value={setupUrl ?? ''} onFocus={(event) => event.currentTarget.select()} /></DialogContent></Dialog></>;
}
