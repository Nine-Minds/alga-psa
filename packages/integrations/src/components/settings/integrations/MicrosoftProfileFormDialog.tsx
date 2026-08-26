'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
} from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  createMicrosoftProfile,
  updateMicrosoftProfile,
} from '../../../actions/integrations/microsoftActions';
import type { MicrosoftProfileSummary } from '../../../actions/integrations/microsoftActions';
import type { MicrosoftProfileConsumer } from '../../../actions/integrations/microsoftShared';
import {
  getVisibleMicrosoftConsumerTypes,
  isMicrosoftConsumerEnterpriseEdition,
} from '../../../lib/microsoftConsumerVisibility';

export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export interface MicrosoftConsumerDescriptor {
  consumerType: MicrosoftProfileConsumer;
  consumerLabel: string;
  description: string;
  reconnectMessage?: string;
}

export interface ProfileFormState {
  displayName: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  capabilities: MicrosoftProfileConsumer[];
  setAsDefault: boolean;
}

export const DEFAULT_FORM_STATE: ProfileFormState = {
  displayName: '',
  clientId: '',
  clientSecret: '',
  tenantId: 'common',
  capabilities: ['msp_sso', 'email', 'calendar', 'teams'],
  setAsDefault: false,
};

export function getConsumerDescriptors(showTeamsUi: boolean, t: TranslateFn): MicrosoftConsumerDescriptor[] {
  const visibleConsumers = getVisibleMicrosoftConsumerTypes(isMicrosoftConsumerEnterpriseEdition()).filter(
    (consumerType) => showTeamsUi || consumerType !== 'teams'
  );

  return visibleConsumers.map((consumerType) => {
    switch (consumerType) {
      case 'msp_sso':
        return {
          consumerType,
          consumerLabel: t('integrations.microsoft.settings.consumers.mspSso.label', { defaultValue: 'Staff sign-in' }),
          description: t('integrations.microsoft.settings.consumers.mspSso.description', { defaultValue: 'Choose the Microsoft app for staff sign-in and login-domain discovery.' }),
        };
      case 'email':
        return {
          consumerType,
          consumerLabel: t('integrations.microsoft.settings.consumers.email.label', { defaultValue: 'Outlook email' }),
          description: t('integrations.microsoft.settings.consumers.email.description', { defaultValue: 'Choose the Microsoft app for Outlook inbound and outbound email.' }),
          reconnectMessage: t('integrations.microsoft.settings.consumers.email.reconnect', { defaultValue: 'Existing Outlook email connections need re-authorization to grant Mail.Send before they can send outbound email.' }),
        };
      case 'calendar':
        return {
          consumerType,
          consumerLabel: t('integrations.microsoft.settings.consumers.calendar.label', { defaultValue: 'Outlook Calendar' }),
          description: t('integrations.microsoft.settings.consumers.calendar.description', { defaultValue: 'Choose the Microsoft app for Outlook calendar sync.' }),
          reconnectMessage: t('integrations.microsoft.settings.consumers.calendar.reconnect', { defaultValue: 'Existing Outlook calendar connections may need re-authorization after changing the Microsoft app.' }),
        };
      case 'teams':
        return {
          consumerType,
          consumerLabel: t('integrations.microsoft.settings.consumers.teams.label', { defaultValue: 'Teams' }),
          description: t('integrations.microsoft.settings.consumers.teams.description', { defaultValue: 'Choose the Microsoft app for Teams installation and auth flows.' }),
        };
      case 'entra':
        return {
          consumerType,
          consumerLabel: t('integrations.microsoft.settings.consumers.entra.label', { defaultValue: 'Entra Direct' }),
          description: t('integrations.microsoft.settings.consumers.entra.description', { defaultValue: 'Choose the Microsoft app for Entra GDAP and Lighthouse sync.' }),
          reconnectMessage: t('integrations.microsoft.settings.consumers.entra.reconnect', { defaultValue: 'Changing this app disconnects the current Entra connection and requires reconsent.' }),
        };
    }
  });
}

export function getCapabilityDescriptors(showTeamsUi: boolean, t: TranslateFn): MicrosoftConsumerDescriptor[] {
  return getConsumerDescriptors(true, t).filter(
    (descriptor) => showTeamsUi || descriptor.consumerType !== 'teams'
  );
}

export interface MicrosoftProfileFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  profile?: MicrosoftProfileSummary | null;
  /** Capabilities pre-ticked on create; the operator can still adjust. */
  initialCapabilities?: MicrosoftProfileConsumer[];
  /** Seeds the Microsoft tenant ID field on create. */
  initialTenantId?: string;
  /** Initial value for the set-as-default switch on create. */
  initialSetAsDefault?: boolean;
  /** Guidance rows (redirect URI, scopes) rendered inside the dialog. */
  guidance?: Array<{ label: string; value: string }>;
  /** Whether the Teams capability checkbox is offered. */
  showTeamsUi?: boolean;
  onOpenChange(open: boolean): void;
  onSaved(profile: MicrosoftProfileSummary | null): void;
}

/**
 * The one Microsoft app-registration form. Both the Microsoft settings page and
 * the Entra setup wizard render this dialog; a second form would drift from it.
 */
export function MicrosoftProfileFormDialog({
  open,
  mode,
  profile = null,
  initialCapabilities,
  initialTenantId,
  initialSetAsDefault = false,
  guidance,
  showTeamsUi = false,
  onOpenChange,
  onSaved,
}: MicrosoftProfileFormDialogProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const { toast } = useToast();
  const [saving, setSaving] = React.useState(false);
  const [formState, setFormState] = React.useState<ProfileFormState>(DEFAULT_FORM_STATE);
  const [formError, setFormError] = React.useState<string | null>(null);
  const seededRef = React.useRef(false);

  const capabilityDescriptors = React.useMemo(
    () => getCapabilityDescriptors(showTeamsUi, t),
    [showTeamsUi, t]
  );

  React.useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) {
      return;
    }
    seededRef.current = true;
    setFormError(null);
    if (mode === 'edit' && profile) {
      setFormState({
        displayName: profile.displayName,
        clientId: profile.clientId || '',
        clientSecret: '',
        tenantId: profile.tenantId || 'common',
        capabilities: profile.capabilities ?? DEFAULT_FORM_STATE.capabilities,
        setAsDefault: profile.isDefault,
      });
      return;
    }
    setFormState({
      ...DEFAULT_FORM_STATE,
      tenantId: initialTenantId || 'common',
      capabilities: initialCapabilities ?? DEFAULT_FORM_STATE.capabilities,
      setAsDefault: initialSetAsDefault,
    });
  }, [open, mode, profile, initialCapabilities, initialTenantId, initialSetAsDefault]);

  const setFormValue = React.useCallback(
    <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) => {
      setFormState((current) => ({ ...current, [key]: value }));
    },
    []
  );

  const toggleCapability = React.useCallback((consumerType: MicrosoftProfileConsumer, checked: boolean) => {
    setFormState((current) => {
      const nextCapabilities = new Set(current.capabilities);
      if (checked) {
        nextCapabilities.add(consumerType);
      } else {
        nextCapabilities.delete(consumerType);
      }

      return {
        ...current,
        capabilities: [...nextCapabilities],
      };
    });
  }, []);

  const validateForm = React.useCallback(() => {
    if (!formState.displayName.trim()) return t('integrations.microsoft.settings.validation.displayNameRequired', { defaultValue: 'Microsoft app display name is required' });
    if (!formState.clientId.trim()) return t('integrations.microsoft.settings.validation.clientIdRequired', { defaultValue: 'Microsoft OAuth Client ID is required' });
    if (!formState.tenantId.trim()) return t('integrations.microsoft.settings.validation.tenantIdRequired', { defaultValue: 'Microsoft tenant ID is required' });
    if (mode === 'create' && !formState.clientSecret.trim()) {
      return t('integrations.microsoft.settings.validation.clientSecretRequired', { defaultValue: 'Microsoft OAuth Client Secret is required' });
    }

    return null;
  }, [formState.clientId, formState.clientSecret, formState.displayName, formState.tenantId, mode, t]);

  const handleSave = React.useCallback(async () => {
    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    try {
      setSaving(true);
      setFormError(null);

      const payload = {
        displayName: formState.displayName,
        clientId: formState.clientId,
        clientSecret: formState.clientSecret,
        tenantId: formState.tenantId,
        capabilities: formState.capabilities,
      };

      const result =
        mode === 'create'
          ? await createMicrosoftProfile({
              ...payload,
              setAsDefault: formState.setAsDefault,
            })
          : await updateMicrosoftProfile({
              profileId: profile?.profileId || '',
              ...payload,
            });

      if (!result.success) {
        const message = result.error || t('integrations.microsoft.settings.errors.saveProfile', { defaultValue: 'Failed to save Microsoft app' });
        setFormError(message);
        toast({
          title: t('integrations.microsoft.settings.toasts.saveFailedTitle', { defaultValue: 'Unable to save Microsoft app' }),
          description: message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: mode === 'create'
          ? t('integrations.microsoft.settings.toasts.profileCreated', { defaultValue: 'Microsoft app created' })
          : t('integrations.microsoft.settings.toasts.profileUpdated', { defaultValue: 'Microsoft app updated' }),
        description:
          mode === 'create'
            ? t('integrations.microsoft.settings.toasts.profileCreatedDescription', { defaultValue: 'Choose which services can use this Microsoft app.' })
            : t('integrations.microsoft.settings.toasts.profileUpdatedDescription', { defaultValue: 'Microsoft app changes saved.' }),
      });
      onOpenChange(false);
      onSaved(result.profile ?? null);
    } finally {
      setSaving(false);
    }
  }, [formState, mode, onOpenChange, onSaved, profile?.profileId, t, toast, validateForm]);

  const dialogTitle = mode === 'create'
    ? t('integrations.microsoft.settings.dialog.createTitle', { defaultValue: 'Create Microsoft app registration' })
    : t('integrations.microsoft.settings.dialog.editTitle', { defaultValue: 'Edit Microsoft app registration' });
  const currentSecretMasked = profile?.clientSecretMasked;

  return (
    <Dialog
      id="microsoft-profile-dialog"
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={dialogTitle}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            id="microsoft-profile-cancel"
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t('integrations.microsoft.settings.dialog.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button id="microsoft-profile-save" type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving
              ? t('integrations.microsoft.settings.dialog.saving', { defaultValue: 'Saving…' })
              : mode === 'create'
                ? t('integrations.microsoft.settings.dialog.createProfile', { defaultValue: 'Create app registration' })
                : t('integrations.microsoft.settings.dialog.saveChanges', { defaultValue: 'Save Changes' })}
          </Button>
        </div>
      }
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogDescription>
            {mode === 'create'
              ? t('integrations.microsoft.settings.dialog.descriptionCreate', { defaultValue: 'Create a Microsoft app registration, then choose which services can use it.' })
              : t('integrations.microsoft.settings.dialog.descriptionEdit', { defaultValue: 'Update this Microsoft app registration. Leave the secret blank to keep the existing value.' })}
          </DialogDescription>
        </DialogHeader>

        {guidance && guidance.length > 0 && (
          <div id="microsoft-profile-dialog-guidance" className="space-y-2 rounded-lg border bg-muted/10 p-3">
            {guidance.map((item) => (
              <div key={item.label}>
                <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
                <div className="mt-1 break-all font-mono text-xs">{item.value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-4 py-2 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="microsoft-profile-display-name">{t('integrations.microsoft.settings.dialog.displayName', { defaultValue: 'Display name' })}</Label>
            <Input
              id="microsoft-profile-display-name"
              value={formState.displayName}
              onChange={(event) => setFormValue('displayName', event.target.value)}
              placeholder={t('integrations.microsoft.settings.dialog.displayNamePlaceholder', { defaultValue: 'Acme production app' })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="microsoft-profile-client-id">{t('integrations.microsoft.settings.dialog.clientId', { defaultValue: 'Client ID' })}</Label>
            <Input
              id="microsoft-profile-client-id"
              value={formState.clientId}
              onChange={(event) => setFormValue('clientId', event.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="microsoft-profile-tenant-id">{t('integrations.microsoft.settings.dialog.tenantId', { defaultValue: 'Microsoft tenant ID' })}</Label>
            <Input
              id="microsoft-profile-tenant-id"
              value={formState.tenantId}
              onChange={(event) => setFormValue('tenantId', event.target.value)}
              placeholder="common"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="microsoft-profile-client-secret">{t('integrations.microsoft.settings.dialog.clientSecret', { defaultValue: 'Client secret' })}</Label>
            <Input
              id="microsoft-profile-client-secret"
              type="password"
              value={formState.clientSecret}
              onChange={(event) => setFormValue('clientSecret', event.target.value)}
              placeholder={
                mode === 'edit'
                  ? t('integrations.microsoft.settings.dialog.clientSecretPlaceholderEdit', { defaultValue: 'Leave blank to keep the current secret' })
                  : t('integrations.microsoft.settings.dialog.clientSecretPlaceholder', { defaultValue: 'Enter client secret' })
              }
            />
            {mode === 'edit' && currentSecretMasked && (
              <p className="text-xs text-muted-foreground">
                {t('integrations.microsoft.settings.dialog.storedSecretHint', { defaultValue: 'Stored secret: {{secret}}. Leave this field empty to keep it unchanged.', secret: currentSecretMasked })}
              </p>
            )}
          </div>

          {mode === 'create' && (
            <div className="rounded-lg border bg-muted/10 p-3 md:col-span-2">
              <Switch
                id="microsoft-profile-set-default"
                checked={formState.setAsDefault}
                onCheckedChange={(checked) => setFormValue('setAsDefault', checked)}
                label={t('integrations.microsoft.settings.dialog.setDefault', { defaultValue: 'Set this as the default Microsoft app' })}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {t('integrations.microsoft.settings.dialog.setDefaultHelp', { defaultValue: 'Some setup flows still need a default app. Service choices above decide which app each service uses.' })}
              </p>
            </div>
          )}

          <div className="space-y-3 md:col-span-2">
            <div>
              <Label>{t('integrations.microsoft.settings.dialog.capabilities', { defaultValue: 'Services this app can handle' })}</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('integrations.microsoft.settings.dialog.capabilitiesHelp', { defaultValue: 'Only checked services can use this Microsoft app.' })}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {capabilityDescriptors.map((capability) => (
                <div key={capability.consumerType} className="rounded-lg border bg-muted/10 p-3">
                  <Checkbox
                    id={`microsoft-profile-capability-${capability.consumerType}`}
                    checked={formState.capabilities.includes(capability.consumerType)}
                    onChange={(event) => toggleCapability(capability.consumerType, event.currentTarget.checked)}
                    label={capability.consumerLabel}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">{capability.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {formError && (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

      </DialogContent>
    </Dialog>
  );
}
