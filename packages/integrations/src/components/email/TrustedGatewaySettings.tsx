import React, { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import toast from 'react-hot-toast';
import type { InboundAuthTrustMode, InboundAuthTrustPolicy } from '@alga-psa/shared/lib/email/authResultsChain';
import type { PublicEmailProvider } from './types';

interface TrustedGatewaySettingsProps {
  provider: Pick<PublicEmailProvider, 'id' | 'inboundAuthTrust'>;
  onSave: (
    input: InboundAuthTrustPolicy
  ) => Promise<{ success: boolean; error?: string; policy?: InboundAuthTrustPolicy }>;
}

const splitIds = (value: string): string[] =>
  value.split(/[\s,]+/).map((id) => id.trim().toLowerCase()).filter(Boolean);

/**
 * Per-mailbox "Trusted inbound gateway" policy. It only affects whether a known
 * *contact* may be attributed from the From address; it can never confer an
 * internal-user identity.
 */
export function TrustedGatewaySettings({ provider, onSave: save }: TrustedGatewaySettingsProps) {
  const { t } = useTranslation('msp/email-providers');
  const saved = provider.inboundAuthTrust;
  const [mode, setMode] = useState<InboundAuthTrustMode>(saved?.mode ?? 'off');
  const [idsText, setIdsText] = useState((saved?.trustedAuthservIds ?? []).join(', '));
  const [saving, setSaving] = useState(false);

  const modeOptions = [
    { value: 'off', label: t('providerCard.trustedGateway.modes.off', { defaultValue: 'Off (receiving mail server only)' }) },
    { value: 'arc-sealed', label: t('providerCard.trustedGateway.modes.arcSealed', { defaultValue: 'Verify the gateway\'s ARC seal' }) },
    { value: 'mta-arc-pass', label: t('providerCard.trustedGateway.modes.mtaArcPass', { defaultValue: 'Rely on the mail server\'s ARC result' }) },
  ];

  const onSave = async () => {
    setSaving(true);
    try {
      const result = await save({ mode, trustedAuthservIds: splitIds(idsText) });
      if (!result.success) {
        toast.error(result.error ?? t('providerCard.trustedGateway.saveFailed', { defaultValue: 'Failed to save trusted gateway settings' }));
        return;
      }
      setIdsText((result.policy?.trustedAuthservIds ?? []).join(', '));
      toast.success(t('providerCard.trustedGateway.saved', { defaultValue: 'Trusted gateway settings saved' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 pt-3 border-t" id={`provider-trusted-gateway-${provider.id}`}>
      <h4 className="text-sm font-medium">
        {t('providerCard.trustedGateway.title', { defaultValue: 'Trusted inbound gateway' })}
      </h4>
      <p className="mt-1 text-xs text-muted-foreground">
        {t('providerCard.trustedGateway.description', {
          defaultValue: 'If a mail-security gateway rewrites messages before this mailbox receives them, the receiving server may fail the sender\'s authentication even though the gateway verified it. Choose how to trust the gateway\'s verdict. This only affects matching the sender to a client contact — it never applies to internal users.',
        })}
      </p>
      <div className="mt-3 space-y-3">
        <CustomSelect
          id={`provider-trusted-gateway-mode-${provider.id}`}
          label={t('providerCard.trustedGateway.modeLabel', { defaultValue: 'Gateway trust mode' })}
          value={mode}
          onValueChange={(v) => setMode((v || 'off') as InboundAuthTrustMode)}
          options={modeOptions}
          disabled={saving}
        />
        <div>
          <Label htmlFor={`provider-trusted-gateway-ids-${provider.id}`}>
            {t('providerCard.trustedGateway.idsLabel', { defaultValue: 'Trusted authserv-ids' })}
          </Label>
          <Input
            id={`provider-trusted-gateway-ids-${provider.id}`}
            value={idsText}
            onChange={(e) => setIdsText(e.target.value)}
            placeholder={t('providerCard.trustedGateway.idsPlaceholder', { defaultValue: 'mx.example.net' })}
            disabled={saving || mode === 'off'}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {t('providerCard.trustedGateway.idsHelp', {
              defaultValue: 'Comma-separated. Use the name the gateway puts at the start of its Authentication-Results header (for example mx.avanan.net). Only gateways you list here are trusted.',
            })}
          </p>
        </div>
        {mode !== 'off' && (
          <Alert id={`provider-trusted-gateway-note-${provider.id}`}>
            <AlertDescription>
              {t('providerCard.trustedGateway.contactOnly', {
                defaultValue: 'Contact attribution only. Messages from addresses that belong to internal users are still verified by the receiving server alone.',
              })}
              {' '}
              {mode === 'arc-sealed'
                ? t('providerCard.trustedGateway.verifies.arcSealed', { defaultValue: "Alga checks the message's ARC seals itself. A listed gateway is trusted only when the seal verifies, the seal's signing domain is the gateway's authserv-id or a parent domain of it, and the gateway reports an aligned SPF or DKIM pass." })
                : t('providerCard.trustedGateway.verifies.mtaArcPass', { defaultValue: "Alga does not check the ARC seal itself. It relies on your receiving mail server reporting arc=pass. A listed gateway is trusted only when the seal's signing domain is its authserv-id or a parent domain of it, and it reports an aligned SPF or DKIM pass." })}
            </AlertDescription>
          </Alert>
        )}
        <Button id={`provider-trusted-gateway-save-${provider.id}`} size="sm" onClick={onSave} disabled={saving}>
          {t('providerCard.trustedGateway.save', { defaultValue: 'Save' })}
        </Button>
      </div>
    </div>
  );
}
