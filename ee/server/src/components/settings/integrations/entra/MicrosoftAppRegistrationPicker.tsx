'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getMicrosoftIntegrationStatus,
  listMicrosoftConsumerBindings,
  listMicrosoftProfiles,
  setMicrosoftConsumerBinding,
} from '@alga-psa/integrations/actions';
import { MicrosoftProfileFormDialog } from '@alga-psa/integrations/components/settings/integrations/MicrosoftProfileFormDialog';
import type { MicrosoftProfileSummary } from '@alga-psa/integrations/actions/integrations/microsoftActions';

interface PickerProfile {
  profileId: string;
  displayName: string;
  clientId: string;
}

interface MicrosoftAppRegistrationPickerProps {
  onBound(profile: { id: string; name: string } | null): void;
}

/**
 * Required selector for the tenant-owned Microsoft app registration that the
 * Entra direct connection runs on. When no Entra-capable app exists (the normal
 * first-run state) it offers inline creation via the shared profile form so the
 * operator never leaves the wizard.
 */
export function MicrosoftAppRegistrationPicker({ onBound }: MicrosoftAppRegistrationPickerProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [loading, setLoading] = React.useState(true);
  const [profiles, setProfiles] = React.useState<PickerProfile[]>([]);
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [entraRedirectUri, setEntraRedirectUri] = React.useState<string | null>(null);
  const [entraScopes, setEntraScopes] = React.useState<string[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [profilesResult, bindingsResult, statusResult] = await Promise.all([
        listMicrosoftProfiles(),
        listMicrosoftConsumerBindings(),
        getMicrosoftIntegrationStatus(),
      ]);
      if (cancelled) {
        return;
      }

      const capable = (profilesResult.profiles || []).filter(
        (profile) => !profile.isArchived && profile.capabilities.includes('entra')
      );
      setProfiles(
        capable.map((profile) => ({
          profileId: profile.profileId,
          displayName: profile.displayName,
          clientId: profile.clientId || '',
        }))
      );

      const bound = bindingsResult.bindings?.find((binding) => binding.consumerType === 'entra');
      const boundProfile = capable.find((profile) => profile.profileId === bound?.profileId);
      if (boundProfile) {
        setValue(boundProfile.profileId);
        onBound({ id: boundProfile.profileId, name: boundProfile.displayName });
      } else {
        onBound(null);
      }

      if (statusResult.success) {
        setEntraRedirectUri(statusResult.redirectUris?.entra || null);
        setEntraScopes(statusResult.scopes?.entra || []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [onBound]);

  const bindProfile = React.useCallback(
    async (profile: PickerProfile) => {
      setError(null);
      setValue(profile.profileId);
      const result = await setMicrosoftConsumerBinding({ consumerType: 'entra', profileId: profile.profileId });
      if (!result.success) {
        setError(result.error || t('integrations.entra.setup.appRegistration.bindFailed', { defaultValue: 'Could not save the Microsoft app choice for Entra.' }));
        onBound(null);
        return;
      }
      onBound({ id: profile.profileId, name: profile.displayName });
    },
    [onBound, t]
  );

  const handleSelect = React.useCallback(
    (profileId: string) => {
      const profile = profiles.find((item) => item.profileId === profileId);
      if (profile) {
        void bindProfile(profile);
      }
    },
    [bindProfile, profiles]
  );

  const handleCreated = React.useCallback(
    (profile: MicrosoftProfileSummary | null) => {
      if (!profile) {
        return;
      }
      const created: PickerProfile = {
        profileId: profile.profileId,
        displayName: profile.displayName,
        clientId: profile.clientId || '',
      };
      setProfiles((current) => [...current, created]);
      void bindProfile(created);
    },
    [bindProfile]
  );

  const guidance = React.useMemo(
    () => [
      {
        label: t('integrations.entra.setup.appRegistration.redirectUriLabel', { defaultValue: 'Redirect URI to add in Entra' }),
        value: entraRedirectUri || t('integrations.microsoft.settings.guidance.unavailable', { defaultValue: 'Unavailable' }),
      },
      {
        label: t('integrations.entra.setup.appRegistration.scopesLabel', { defaultValue: 'Delegated scopes (admin consent required)' }),
        value: entraScopes.join(', ') || t('integrations.microsoft.settings.guidance.unavailable', { defaultValue: 'Unavailable' }),
      },
    ],
    [entraRedirectUri, entraScopes, t]
  );

  if (loading) {
    return <div id="entra-app-registration-picker-loading" className="h-9" />;
  }

  if (!profiles.length) {
    return (
      <div className="space-y-3">
        <Alert variant="warning" id="entra-app-registration-empty">
          <AlertDescription>
            {t('integrations.entra.setup.appRegistration.emptyBody', {
              defaultValue:
                'Direct connect runs on your own Microsoft app registration. Register a multi-tenant app in your partner tenant, add the Entra redirect URI, and grant admin consent for ManagedTenants.Read.All and Directory.Read.All.',
            })}
          </AlertDescription>
        </Alert>
        <Button id="entra-app-registration-add" type="button" onClick={() => setCreateOpen(true)}>
          {t('integrations.entra.setup.appRegistration.addButton', { defaultValue: 'Add app registration' })}
        </Button>
        {error ? (
          <p className="text-sm text-destructive" id="entra-app-registration-error">{error}</p>
        ) : null}
        <MicrosoftProfileFormDialog
          open={createOpen}
          mode="create"
          initialCapabilities={['entra']}
          guidance={guidance}
          onOpenChange={setCreateOpen}
          onSaved={handleCreated}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2" id="entra-app-registration-picker">
      <label htmlFor="entra-app-registration-select" className="text-sm font-medium">
        {t('integrations.entra.setup.appRegistration.label', { defaultValue: 'Microsoft app registration' })}
      </label>
      <CustomSelect
        id="entra-app-registration-select"
        value={value}
        onValueChange={handleSelect}
        options={profiles.map((profile) => ({
          value: profile.profileId,
          label: `${profile.displayName} (${profile.clientId})`,
        }))}
        placeholder={t('integrations.entra.setup.appRegistration.placeholder', { defaultValue: 'Select an app registration' })}
      />
      {error ? (
        <p className="text-sm text-destructive" id="entra-app-registration-error">{error}</p>
      ) : null}
    </div>
  );
}
