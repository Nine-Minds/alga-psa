'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  getClientBillingProfileSettings,
  updateClientBillingProfileSettings,
  type ClientBillingProfileSettingsInput,
} from '../../actions/clientBillingProfileActions';

/**
 * A billing profile's own bill-to identity, tax, PO, and delivery settings
 * (F088).
 *
 * Every field is optional and blank means **inherit from the client**. The
 * placeholder on each input shows what would be inherited, so an admin can see
 * the value in force without filling anything in — the difference between "this
 * profile bills as ACME Corp because I typed it" and "…because the client is
 * called that" is exactly the thing that is otherwise invisible.
 *
 * Tax *region* is deliberately absent. Region follows where the work was
 * delivered, not who is billed for it, so a profile does not participate in the
 * region chain (decision D9). Exemption, certificate, and tax ID do, because
 * those are properties of a legal entity and one client can hold several.
 */

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

interface ClientBillingProfileSettingsProps {
  clientId: string;
  billingProfileId: string;
}

type Draft = Record<string, string | boolean | null>;

export function ClientBillingProfileSettings({
  clientId,
  billingProfileId,
}: ClientBillingProfileSettingsProps) {
  const { t } = useTranslation('msp/clients');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [effective, setEffective] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getClientBillingProfileSettings({ clientId, billingProfileId });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      setDraft(result.stored as Draft);
      setEffective(result.effective as unknown as Record<string, unknown>);
    } finally {
      setIsLoading(false);
    }
  }, [clientId, billingProfileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (field: string, value: string | boolean | null) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  const save = async () => {
    setIsSaving(true);
    try {
      // Blank strings are sent as null, not as "": clearing a field must mean
      // "go back to inheriting", not "override with empty".
      const settings: ClientBillingProfileSettingsInput = Object.fromEntries(
        Object.entries(draft).map(([key, value]) => [
          key,
          typeof value === 'string' && value.trim() === '' ? null : value,
        ]),
      ) as ClientBillingProfileSettingsInput;

      const result = await updateClientBillingProfileSettings({
        clientId,
        billingProfileId,
        settings,
      });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(
        t('clientBillingProfileSettings.saved', { defaultValue: 'Billing profile settings saved' }),
      );
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  const textField = (
    field: string,
    label: string,
    inheritedFrom: string | null | undefined,
  ) => (
    <div key={field}>
      <Label htmlFor={`profile-setting-${field}`}>{label}</Label>
      <Input
        id={`profile-setting-${field}`}
        value={(draft[field] as string | null) ?? ''}
        placeholder={
          inheritedFrom
            ? t('clientBillingProfileSettings.inherited', {
                value: inheritedFrom,
                defaultValue: 'Inherited: {{value}}',
              })
            : t('clientBillingProfileSettings.notSet', { defaultValue: 'Not set' })
        }
        onChange={(event) => set(field, event.target.value)}
      />
    </div>
  );

  return (
    <div className="space-y-4 rounded-md border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="profile-bills-separately">
            {t('clientBillingProfileSettings.billsSeparately', {
              defaultValue: 'Bills separately',
            })}
          </Label>
          <p className="text-sm text-gray-500">
            {t('clientBillingProfileSettings.billsSeparatelyHint', {
              defaultValue:
                'Produce a separate invoice for this profile, with its own bill-to, payment method, and balance.',
            })}
          </p>
        </div>
        <Switch
          id="profile-bills-separately"
          checked={Boolean(draft.bills_separately)}
          onCheckedChange={(checked) => set('bills_separately', checked)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {textField(
          'bill_to_name',
          t('clientBillingProfileSettings.billToName', { defaultValue: 'Bill-to name' }),
          effective.billToName as string,
        )}
        {textField(
          'billing_email',
          t('clientBillingProfileSettings.billingEmail', { defaultValue: 'Billing email' }),
          effective.billingEmail as string,
        )}
        {textField(
          'po_number',
          t('clientBillingProfileSettings.poNumber', { defaultValue: 'PO number' }),
          null,
        )}
        {textField(
          'tax_id_number',
          t('clientBillingProfileSettings.taxIdNumber', { defaultValue: 'Tax ID' }),
          effective.taxIdNumber as string,
        )}
        {textField(
          'tax_exemption_certificate',
          t('clientBillingProfileSettings.taxExemptionCertificate', {
            defaultValue: 'Tax exemption certificate',
          }),
          effective.taxExemptionCertificate as string,
        )}
        {textField(
          'invoice_delivery_method',
          t('clientBillingProfileSettings.invoiceDeliveryMethod', {
            defaultValue: 'Invoice delivery method',
          }),
          effective.invoiceDeliveryMethod as string,
        )}
        {textField(
          'billing_cycle',
          t('clientBillingProfileSettings.billingCycle', { defaultValue: 'Billing cycle' }),
          effective.billingCycle as string,
        )}
        {textField(
          'payment_terms',
          t('clientBillingProfileSettings.paymentTerms', { defaultValue: 'Payment terms' }),
          effective.paymentTerms as string,
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id="profile-tax-exempt"
            checked={draft.is_tax_exempt === true}
            onCheckedChange={(checked) => set('is_tax_exempt', checked ? true : null)}
          />
          <Label htmlFor="profile-tax-exempt">
            {t('clientBillingProfileSettings.taxExempt', {
              defaultValue: 'Tax exempt',
            })}
          </Label>
          <span className="text-xs text-gray-500">
            {draft.is_tax_exempt === null || draft.is_tax_exempt === undefined
              ? t('clientBillingProfileSettings.taxExemptInherited', {
                  value: effective.isTaxExempt
                    ? t('common.yes', { defaultValue: 'Yes' })
                    : t('common.no', { defaultValue: 'No' }),
                  defaultValue: 'Inheriting from the client ({{value}})',
                })
              : ''}
          </span>
        </div>
        <Button
          id="save-billing-profile-settings"
          variant="default"
          disabled={isSaving}
          onClick={() => void save()}
        >
          {t('common.actions.save', { defaultValue: 'Save' })}
        </Button>
      </div>

      <p className="text-xs text-gray-500">
        {t('clientBillingProfileSettings.regionNote', {
          defaultValue:
            'Tax region is not set here. It follows where the work was delivered — the service, then the contract line’s location, then the client default.',
        })}
      </p>
    </div>
  );
}

export default ClientBillingProfileSettings;
