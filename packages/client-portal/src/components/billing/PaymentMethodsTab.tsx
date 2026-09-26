'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getPortalBillingProfiles } from '../../actions/client-portal-actions/client-billing-segments';
import { disableClientPortalAutopay, enrollClientPortalAutopay, getClientPortalAutopayProfile, getPaymentMethods, removePaymentMethod, setDefaultPaymentMethod, startClientPortalCardSetup } from '../../actions';

type Profile = { billingProfileId: string; name: string; isDefault: boolean };
type Overview = { enabled: boolean; consentText: string; consentTextVersion: string; enrollment: null | { is_enabled: boolean; payment_method_id: string; authorized_at: string }; methods: Array<{ payment_method_id: string; brand: string | null; last4: string; exp_month: string; exp_year: string; status: string }>; chargeableMethods: Array<{ payment_method_id: string; brand: string | null; last4: string; exp_month: string; exp_year: string; status: string }> };
const actionError = (value: unknown) => isActionMessageError(value) || isActionPermissionError(value);

export default function PaymentMethodsTab() {
  const { t } = useTranslation('client-portal');
  const search = useSearchParams();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [overviews, setOverviews] = useState<Record<string, Overview>>({});
  const [methods, setMethods] = useState<any[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [consented, setConsented] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const [profileResult, methodResult] = await Promise.all([getPortalBillingProfiles(), getPaymentMethods()]);
    if (actionError(profileResult)) throw new Error(getErrorMessage(profileResult));
    if (actionError(methodResult)) throw new Error(getErrorMessage(methodResult));
    const list = profileResult as Profile[];
    setProfiles(list); setMethods(methodResult as any[]);
    const values = await Promise.all(list.map(async p => [p.billingProfileId, await getClientPortalAutopayProfile(p.billingProfileId)] as const));
    const mapped: Record<string, Overview> = {};
    for (const [id, value] of values) if (!actionError(value) && value) mapped[id] = value as Overview;
    setOverviews(mapped);
    setSelected(Object.fromEntries(Object.entries(mapped).map(([id, info]) => [id, info.enrollment?.payment_method_id ?? info.chargeableMethods[0]?.payment_method_id ?? ''])));
  }, []);
  useEffect(() => { void load().catch(e => setMessage(getErrorMessage(e))); }, [load]);
  useEffect(() => {
    const result = search.get('cardSetup');
    if (!result) return;
    setMessage(result === 'success' ? t('account.billing.cardSetup.success', { defaultValue: 'Card saved securely.' }) : t('account.billing.cardSetup.error', { defaultValue: 'We could not save the card. Please try again.' }));
    void load().catch(e => setMessage(getErrorMessage(e)));
  }, [search, load, t]);
  const addCard = async (profileId: string) => {
    setBusy(true); try { const result = await startClientPortalCardSetup(profileId); if (actionError(result)) throw new Error(getErrorMessage(result)); window.location.assign(result.url); } catch (e) { setMessage(getErrorMessage(e)); } finally { setBusy(false); }
  };
  const toggle = async (profileId: string, enabled: boolean) => {
    const info = overviews[profileId]; setBusy(true);
    try {
      const result = enabled ? await enrollClientPortalAutopay(profileId, selected[profileId] ?? '', info.consentTextVersion) : await disableClientPortalAutopay(profileId);
      if (actionError(result)) throw new Error(getErrorMessage(result)); await load();
    } catch (e) { setMessage(getErrorMessage(e)); } finally { setBusy(false); }
  };
  const text = (key: string, fallback: string) => t(`account.billing.${key}`, { defaultValue: fallback });
  return <div className="space-y-4">{message && <p role="status" className="text-sm text-[rgb(var(--color-text-700))]">{message}</p>}
    {profiles.map(profile => {
      const info = overviews[profile.billingProfileId];
      if (!info?.enabled) return null;
      const enrolled = info.enrollment?.is_enabled === true;
      return <Card key={profile.billingProfileId} className="p-5 space-y-3">
        <h3 className="font-medium">{text('autopay.title', 'Payment methods & auto-pay')} · {profile.name}</h3>
        {methods.filter(m => m.billingProfileId === profile.billingProfileId).map(method => <div key={method.id} className="flex items-center justify-between text-sm">
          <span>{method.type === 'credit_card' ? `${method.last4} (${method.expMonth}/${method.expYear})` : method.last4}{method.isDefault ? ` · ${text('labels.defaultTag', 'Default')}` : ''}</span>
          <div className="flex gap-2">{!method.isDefault && <Button id={`portal-default-card-${method.id}`} variant="outline" size="sm" onClick={async () => { await setDefaultPaymentMethod(method.id); await load(); }}>{text('actions.setDefault', 'Set default')}</Button>}<Button id={`portal-remove-card-${method.id}`} variant="ghost" size="sm" onClick={async () => { await removePaymentMethod(method.id); await load(); }}>{text('actions.remove', 'Remove')}</Button></div>
        </div>)}
        <Button id={`portal-add-card-${profile.billingProfileId}`} variant="outline" disabled={busy} onClick={() => void addCard(profile.billingProfileId)}>{text('actions.addPaymentMethod', 'Add card')}</Button>
        {enrolled ? <><p className="text-sm">{text('autopay.enrolled', 'Auto-pay is enabled.')}</p><Button id={`portal-disable-autopay-${profile.billingProfileId}`} variant="outline" disabled={busy} onClick={() => void toggle(profile.billingProfileId, false)}>{text('autopay.disable', 'Turn off auto-pay')}</Button></> : <>
          {info.chargeableMethods.length > 0 && <><CustomSelect id={`portal-autopay-card-${profile.billingProfileId}`} value={selected[profile.billingProfileId] ?? ''} onValueChange={v => setSelected(s => ({...s, [profile.billingProfileId]: v}))} options={info.chargeableMethods.map(m => ({ value: m.payment_method_id, label: `${m.brand ?? 'Card'} •••• ${m.last4} (${m.exp_month}/${m.exp_year})` }))} /><p className="text-sm">{info.consentText}</p><Checkbox id={`portal-autopay-consent-${profile.billingProfileId}`} checked={consented[profile.billingProfileId] ?? false} onChange={e => setConsented(s => ({...s, [profile.billingProfileId]: (e.target as HTMLInputElement).checked}))} label={text('autopay.consent', 'I authorize recurring charges to this card for finalized invoices.')} /><Button id={`portal-enable-autopay-${profile.billingProfileId}`} disabled={busy || !selected[profile.billingProfileId] || !consented[profile.billingProfileId]} onClick={() => void toggle(profile.billingProfileId, true)}>{text('autopay.enable', 'Enable auto-pay')}</Button></>}
          {info.chargeableMethods.length === 0 && <p className="text-sm">{text('autopay.noCards', 'Add a card to enable auto-pay.')}</p>}
        </>}
      </Card>;
    })}</div>;
}
