import React, { useEffect, useState } from 'react';
import { Text } from '@radix-ui/themes';
import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getClientContractLineSettingsAsync,
  updateClientContractLineSettingsAsync
} from "../../lib/billingHelpers";

interface ClientExternalCreditSettingsProps {
  clientId: string;
}

/**
 * Marks a client as holding a credit balance in the external accounting
 * system (e.g. a QuickBooks customer credit from prepaid checks). Alga has no
 * record of such credits, so without this flag the client looks delinquent in
 * the portal between invoice finalization and the bookkeeper applying the
 * credit. The flag and note render as a notice on the client portal billing
 * page.
 */
const ClientExternalCreditSettings: React.FC<ClientExternalCreditSettingsProps> = ({ clientId }) => {
  const { t } = useTranslation('msp/clients');
  const [hasExternalCredit, setHasExternalCredit] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const clientSettings = await getClientContractLineSettingsAsync(clientId);
        if (clientSettings) {
          setHasExternalCredit(Boolean(clientSettings.hasExternalCredit));
          setNote(clientSettings.externalCreditNote ?? '');
        }
      } catch (error) {
        handleError(error, t('clientExternalCreditSettings.loadError', { defaultValue: 'Failed to load settings' }));
      }
    };

    loadSettings();
  }, [clientId, t]);

  const handleFlagChange = async (checked: boolean) => {
    try {
      const result = await updateClientContractLineSettingsAsync(clientId, { hasExternalCredit: checked });
      if (result.success) {
        setHasExternalCredit(checked);
        toast.success(
          t('clientExternalCreditSettings.updatedSuccess', { defaultValue: 'External credit setting updated.' })
        );
      }
    } catch (error) {
      handleError(error, t('clientExternalCreditSettings.saveError', { defaultValue: 'Failed to save settings' }));
    }
  };

  const saveNote = async () => {
    try {
      const result = await updateClientContractLineSettingsAsync(clientId, {
        externalCreditNote: note.trim() ? note.trim() : null
      });
      if (result.success) {
        toast.success(
          t('clientExternalCreditSettings.noteUpdatedSuccess', { defaultValue: 'External credit note updated.' })
        );
      }
    } catch (error) {
      handleError(error, t('clientExternalCreditSettings.saveError', { defaultValue: 'Failed to save settings' }));
    }
  };

  return (
    <div className="mt-6">
      <div>
        <Text as="div" size="3" mb="4" weight="medium" className="text-gray-900">
          {t('clientExternalCreditSettings.title', { defaultValue: 'External Credit on File' })}
        </Text>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="client-has-external-credit"
              checked={hasExternalCredit}
              onCheckedChange={handleFlagChange}
            />
            <div className="space-y-1">
              <Label htmlFor="client-has-external-credit">
                {t('clientExternalCreditSettings.enable', { defaultValue: 'Customer holds credit in the accounting system' })}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('clientExternalCreditSettings.enableHelp', {
                  defaultValue:
                    'For customers whose credit balance lives in QuickBooks (e.g. paid ahead by check). Shows a notice on their portal billing page so open invoices are not mistaken for delinquency.'
                })}
              </p>
            </div>
          </div>

          {hasExternalCredit && (
            <div className="space-y-2">
              <Label htmlFor="external-credit-note">
                {t('clientExternalCreditSettings.note', { defaultValue: 'Note shown to the customer' })}
              </Label>
              <div className="flex space-x-2 items-start">
                <Input
                  id="external-credit-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t('clientExternalCreditSettings.notePlaceholder', {
                    defaultValue: 'e.g., Paid through December 2026'
                  })}
                  className="max-w-md"
                />
                <Button onClick={saveNote} id="save-external-credit-note">
                  {t('clientExternalCreditSettings.save', { defaultValue: 'Save' })}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientExternalCreditSettings;
