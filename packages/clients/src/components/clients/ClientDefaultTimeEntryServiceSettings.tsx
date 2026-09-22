import React, { useEffect, useState } from 'react';
import { Text } from '@radix-ui/themes';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import toast from 'react-hot-toast';
import {
  handleError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getClientContractLineSettingsAsync,
  updateClientContractLineSettingsAsync,
  getServicesAsync,
} from '../../lib/billingHelpers';

interface ClientDefaultTimeEntryServiceSettingsProps {
  clientId: string;
}

/**
 * Per-client default service for new ticket time entries. Clearing the select
 * reverts the client to the tenant default.
 */
const ClientDefaultTimeEntryServiceSettings: React.FC<ClientDefaultTimeEntryServiceSettingsProps> = ({ clientId }) => {
  const { t } = useTranslation('msp/clients');
  const [serviceId, setServiceId] = useState<string>('');
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);
  // No control may be interactive before the async loads settle: a pre-load
  // render would otherwise show "no default" for EVERY client, and a click in
  // that window could write the empty value over the client's persisted one.
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const loadSettings = async () => {
      setLoadState('loading');
      try {
        const [clientSettings, servicesResult] = await Promise.all([
          getClientContractLineSettingsAsync(clientId),
          getServicesAsync(1, 999, { item_kind: 'service', is_active: true, billing_method: 'hourly' }),
        ]);
        if (cancelled) return;

        setServiceId(clientSettings?.defaultTimeEntryServiceId ?? '');
        if (Array.isArray(servicesResult?.services)) {
          setOptions(servicesResult.services.map((service) => ({
            value: service.service_id,
            label: service.service_name,
          })));
        }
        setLoadState('ready');
      } catch (error) {
        if (cancelled) return;
        setLoadState('error');
        handleError(error, t('clientDefaultTimeEntryServiceSettings.loadError', {
          defaultValue: 'Failed to load default time-entry service',
        }));
      }
    };

    loadSettings();
    return () => {
      cancelled = true;
    };
  }, [clientId, t]);

  const handleChange = async (value: string) => {
    if (loadState !== 'ready') return;
    try {
      // Empty string = clear the client override and inherit the tenant default.
      const result = await updateClientContractLineSettingsAsync(clientId, {
        defaultTimeEntryServiceId: value || null,
      });
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      if (result.success) {
        setServiceId(value);
        toast.success(t('clientDefaultTimeEntryServiceSettings.updatedSuccess', {
          defaultValue: 'Default time-entry service updated.',
        }));
      }
    } catch (error) {
      handleError(error, t('clientDefaultTimeEntryServiceSettings.saveError', {
        defaultValue: 'Failed to save default time-entry service',
      }));
    }
  };

  return (
    <div className="mt-6">
      <Text as="div" size="3" mb="4" weight="medium" className="text-gray-900">
        {t('clientDefaultTimeEntryServiceSettings.title', { defaultValue: 'Default time-entry service' })}
      </Text>
      {loadState === 'ready' ? (
        <div className="space-y-2">
          <CustomSelect
            id="client-default-time-entry-service"
            options={options}
            value={serviceId}
            onValueChange={handleChange}
            allowClear
            placeholder={t('clientDefaultTimeEntryServiceSettings.placeholder', {
              defaultValue: 'Use tenant default',
            })}
            label={t('clientDefaultTimeEntryServiceSettings.label', {
              defaultValue: 'Default time-entry service',
            })}
            className="!w-fit"
          />
          <p className="text-sm text-muted-foreground">
            {t('clientDefaultTimeEntryServiceSettings.help', {
              defaultValue:
                'Used for new ticket time entries for this client. Clear the selection to use the tenant default.',
            })}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {loadState === 'error'
            ? t('clientDefaultTimeEntryServiceSettings.loadError', { defaultValue: 'Failed to load default time-entry service' })
            : t('common.states.loading', { defaultValue: 'Loading...' })}
        </p>
      )}
    </div>
  );
};

export default ClientDefaultTimeEntryServiceSettings;
