'use client';

import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ExternalLink, FileText, Monitor } from 'lucide-react';
import { CSVMappingManager } from '@alga-psa/integrations/components/csv/CSVMappingManager';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  getQuickBooksDesktopSettings,
  updateQuickBooksDesktopSettings,
} from '../../../actions/integrations/quickBooksDesktopActions';
import {
  DEFAULT_QUICKBOOKS_DESKTOP_SETTINGS,
  type QuickBooksDesktopSettings,
} from '../../../lib/quickBooksDesktopSettings';
import { useAccountingCapabilities } from './useAccountingCapabilities';

type SettingsField = keyof QuickBooksDesktopSettings;
type TextSettingsField = Exclude<SettingsField, 'newProductItemType'>;

/**
 * QuickBooks Desktop (IIF) Integration Settings
 *
 * Desktop exports reuse the QuickBooks CSV mappings for customer, item, term,
 * and tax names, and add the account and sales tax item names an IIF invoice
 * needs. QuickBooks Desktop creates any name it does not recognise on import,
 * so these must match the company file exactly.
 */
const QuickBooksDesktopIntegrationSettings: React.FC = () => {
  const { t } = useTranslation('msp/integrations');
  const caps = useAccountingCapabilities();
  const [settings, setSettings] = useState<QuickBooksDesktopSettings>(DEFAULT_QUICKBOOKS_DESKTOP_SETTINGS);
  const [draft, setDraft] = useState<QuickBooksDesktopSettings>(DEFAULT_QUICKBOOKS_DESKTOP_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, startSave] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getQuickBooksDesktopSettings();
        if (cancelled) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setError(getErrorMessage(result));
          return;
        }
        setSettings(result);
        setDraft(result);
      } catch {
        if (!cancelled) {
          setError(t('integrations.qbd.settings.errors.load', { defaultValue: 'Failed to load QuickBooks Desktop settings' }));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleSave = () => {
    startSave(async () => {
      try {
        const result = await updateQuickBooksDesktopSettings(draft);
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setError(getErrorMessage(result));
          setSuccessMessage(null);
          return;
        }
        setSettings(result);
        setDraft(result);
        setError(null);
        setSuccessMessage(t('integrations.qbd.settings.savedMessage', { defaultValue: 'Settings saved successfully' }));
        setTimeout(() => setSuccessMessage(null), 3000);
      } catch {
        setError(t('integrations.qbd.settings.errors.save', { defaultValue: 'Failed to save QuickBooks Desktop settings' }));
        setSuccessMessage(null);
      }
    });
  };

  if (caps.loaded && !caps.hasAny) {
    return (
      <div className="space-y-6" id="qbd-integration-no-permission">
        <Card>
          <CardHeader>
            <CardTitle>{t('integrations.qbd.settings.title', { defaultValue: 'QuickBooks Desktop (IIF) Integration' })}</CardTitle>
            <CardDescription>
              {t('integrations.csv.settings.noPermissionDescription', { defaultValue: 'You do not have permission to view or configure accounting integrations.' })}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <LoadingIndicator spinnerProps={{ size: 'sm' }} text={t('integrations.qbd.settings.loading', { defaultValue: 'Loading QuickBooks Desktop settings...' })} />
        </CardContent>
      </Card>
    );
  }

  const canManageConnections = caps.connectionsManage;
  const isDirty = (Object.keys(draft) as SettingsField[]).some((key) => draft[key] !== settings[key]);

  const fields: Array<{ key: TextSettingsField; label: string; help: string; required?: boolean }> = [
    {
      key: 'arAccount',
      label: t('integrations.qbd.settings.fields.arAccount', { defaultValue: 'Accounts Receivable account' }),
      help: t('integrations.qbd.settings.fields.arAccountHelp', { defaultValue: 'The A/R account each invoice posts to.' })
    },
    {
      key: 'defaultIncomeAccount',
      label: t('integrations.qbd.settings.fields.defaultIncomeAccount', { defaultValue: 'Default income account' }),
      help: t('integrations.qbd.settings.fields.defaultIncomeAccountHelp', { defaultValue: 'Used for invoice lines whose mapping has no "qbdIncomeAccount" metadata. Required unless every mapping sets one.' }),
      required: true
    },
    {
      key: 'salesTaxPayableAccount',
      label: t('integrations.qbd.settings.fields.salesTaxPayableAccount', { defaultValue: 'Sales tax liability account' }),
      help: t('integrations.qbd.settings.fields.salesTaxPayableAccountHelp', { defaultValue: 'The account the sales tax line posts to.' })
    },
    {
      key: 'defaultSalesTaxItem',
      label: t('integrations.qbd.settings.fields.defaultSalesTaxItem', { defaultValue: 'Default sales tax item' }),
      help: t('integrations.qbd.settings.fields.defaultSalesTaxItemHelp', { defaultValue: 'Sales tax item or group for taxed invoices whose tax code mapping has no "qbdSalesTaxItem" metadata.' })
    }
  ];

  const inventoryFields: Array<{ key: TextSettingsField; label: string }> = [
    {
      key: 'inventoryAssetAccount',
      label: t('integrations.qbd.settings.fields.inventoryAssetAccount', { defaultValue: 'Inventory asset account' })
    },
    {
      key: 'cogsAccount',
      label: t('integrations.qbd.settings.fields.cogsAccount', { defaultValue: 'Cost of goods sold account' })
    }
  ];

  return (
    <div className="space-y-6">
      {successMessage && (
        <Alert variant="success">
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card id="qbd-integration-overview-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            {t('integrations.qbd.settings.title', { defaultValue: 'QuickBooks Desktop (IIF) Integration' })}
          </CardTitle>
          <CardDescription>
            {t('integrations.qbd.settings.description', { defaultValue: 'Export invoices as an IIF file for File → Utilities → Import → IIF Files in QuickBooks Desktop.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="warning" id="qbd-backup-warning">
            <AlertTitle>{t('integrations.qbd.settings.warning.title', { defaultValue: 'Back up your company file first' })}</AlertTitle>
            <AlertDescription>
              {t('integrations.qbd.settings.warning.description', { defaultValue: 'QuickBooks Desktop adds any customer, item, account, or term name it does not recognise when importing an IIF file, and IIF imports cannot be undone. Make sure every name below and in the mappings matches your company file exactly, and try your first import on a backup copy.' })}
            </AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground">
            {t('integrations.qbd.settings.sharedMappingsNote', { defaultValue: 'Customer, item, tax code, payment term, and discount mappings are shared with the QuickBooks CSV integration.' })}
          </p>
        </CardContent>
      </Card>

      <Card id="qbd-settings-card">
        <CardHeader>
          <CardTitle>{t('integrations.qbd.settings.exportSettings.title', { defaultValue: 'IIF Export Settings' })}</CardTitle>
          <CardDescription>
            {t('integrations.qbd.settings.exportSettings.description', { defaultValue: 'Enter the QuickBooks Desktop account and item names exactly as they appear in your Chart of Accounts and Item List.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManageConnections ? (
            <Alert variant="info" id="qbd-connections-permission-notice">
              <AlertDescription>
                {t('integrations.qbd.settings.connectionsPermissionNotice', { defaultValue: 'You can view QuickBooks Desktop settings, but changing them requires the manage-connections capability. Ask an administrator to grant it.' })}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.key}>
                <Input
                  id={`qbd-setting-${field.key}`}
                  label={field.label}
                  required={field.required}
                  value={draft[field.key]}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  disabled={isSaving || !canManageConnections}
                  maxLength={159}
                />
                <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>
              </div>
            ))}
          </div>
          <div className="space-y-3 rounded border border-border/60 p-4" id="qbd-new-items-settings">
            <div>
              <p className="text-sm font-medium text-foreground">
                {t('integrations.qbd.settings.newItems.title', { defaultValue: 'Items created by exports' })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('integrations.qbd.settings.newItems.description', { defaultValue: 'When an export creates a new QuickBooks item for an Alga product, it uses this item type. Services are always created as Service items.' })}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-foreground" htmlFor="qbd-setting-newProductItemType">
                  {t('integrations.qbd.settings.fields.newProductItemType', { defaultValue: 'New product item type' })}
                </label>
                <CustomSelect
                  id="qbd-setting-newProductItemType"
                  options={[
                    { value: 'NONINVENTORY', label: t('integrations.qbd.settings.itemTypes.nonInventory', { defaultValue: 'Non-inventory Part' }) },
                    { value: 'INVENTORY', label: t('integrations.qbd.settings.itemTypes.inventory', { defaultValue: 'Inventory Part' }) }
                  ]}
                  value={draft.newProductItemType}
                  onValueChange={(value) =>
                    setDraft((prev) => ({ ...prev, newProductItemType: value === 'INVENTORY' ? 'INVENTORY' : 'NONINVENTORY' }))
                  }
                  disabled={isSaving || !canManageConnections}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {draft.newProductItemType === 'INVENTORY'
                    ? t('integrations.qbd.settings.fields.inventoryWarning', { defaultValue: 'Alga stock receipts are not exported, so QuickBooks on-hand quantities will go negative unless you also enter stock in QuickBooks.' })
                    : t('integrations.qbd.settings.fields.nonInventoryHelp', { defaultValue: 'Recommended: Alga stays the inventory system of record and QuickBooks only records the sale.' })}
                </p>
              </div>
            </div>
            {draft.newProductItemType === 'INVENTORY' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {inventoryFields.map((field) => (
                  <div key={field.key}>
                    <Input
                      id={`qbd-setting-${field.key}`}
                      label={field.label}
                      required
                      value={draft[field.key]}
                      onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                      disabled={isSaving || !canManageConnections}
                      maxLength={159}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('integrations.qbd.settings.metadataHelp', { defaultValue: 'Per-item overrides: add {"qbdIncomeAccount": "Account name"} to an Items / Services or Discounts mapping, or {"qbdSalesTaxItem": "Item name"} to a Tax Codes mapping, using the mapping metadata editor.' })}
          </p>
        </CardContent>
        {canManageConnections ? (
          <CardFooter className="justify-end">
            <Button id="qbd-settings-save-button" onClick={handleSave} disabled={isSaving || !isDirty}>
              {t('integrations.qbd.settings.save', { defaultValue: 'Save settings' })}
            </Button>
          </CardFooter>
        ) : null}
      </Card>

      <Card id="qbd-mapping-settings-card">
        <CardHeader>
          <CardTitle>{t('integrations.qbd.settings.mappings.title', { defaultValue: 'QuickBooks Mappings' })}</CardTitle>
          <CardDescription>
            {t('integrations.qbd.settings.mappings.description', { defaultValue: 'Map Alga clients, services, tax codes, payment terms, and discounts to the names in your QuickBooks Desktop company file. Unmapped clients export under their Alga name; unmapped payment terms are left blank.' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {caps.mappingsManage ? (
            <CSVMappingManager />
          ) : (
            <Alert variant="info" id="qbd-mapping-permission-notice">
              <AlertDescription>
                {t('integrations.csv.settings.qbo.mappings.permissionNotice', { defaultValue: 'Editing CSV mappings requires the manage-mappings capability. Ask an administrator to grant it.' })}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card id="qbd-export-navigation-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t('integrations.csv.settings.exports.title', { defaultValue: 'Accounting Exports' })}
          </CardTitle>
          <CardDescription>
            {t('integrations.qbd.settings.exports.description', { defaultValue: 'Create a QuickBooks Desktop export batch, execute it, and the IIF file downloads automatically.' })}
          </CardDescription>
        </CardHeader>
        {caps.exportsExecute && (
          <CardFooter className="justify-end">
            <Button id="qbd-open-accounting-exports" asChild size="lg">
              <Link href="/msp/billing?tab=accounting-exports" className="inline-flex items-center gap-2">
                {t('integrations.csv.settings.exports.openButton', { defaultValue: 'Open Accounting Exports' })}
                <ExternalLink className="h-4 w-4 opacity-90" />
              </Link>
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
};

export default QuickBooksDesktopIntegrationSettings;
