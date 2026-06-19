'use client'

import React, { useState } from 'react';
import type {
  IClient,
  IContact,
  ITaxRate,
  IClientTaxRate,
  IClientTaxRateAssociation,
} from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import {
  getClientTaxRates,
  addClientTaxRate,
  updateDefaultClientTaxRate,
} from '@alga-psa/clients/actions';
import {
  getTaxRatesAsync,
  setClientTemplateAsync,
} from '../../lib/billingHelpers';
import BillingConfigForm from './BillingConfigForm';
import ClientTaxRates from './ClientTaxRates';
import ClientZeroDollarInvoiceSettings from './ClientZeroDollarInvoiceSettings';
import ClientCreditExpirationSettings from './ClientCreditExpirationSettings';
import ClientContractAssignment from './ClientContractAssignment';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { ClientBillingSchedule } from './ClientBillingSchedule';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface BillingConfigurationProps {
    client: IClient;
    onSave: (updatedClient: Partial<IClient>) => void;
    contacts?: IContact[];
}

const BillingConfiguration: React.FC<BillingConfigurationProps> = ({ client, onSave, contacts = [] }) => {
    const { t } = useTranslation('msp/clients');
    const [activeTab, setActiveTab] = useState('general');
    const [billingConfig, setBillingConfig] = useState({
        payment_terms: client.payment_terms || 'net_30',
        credit_limit: client.credit_limit || 0,
        preferred_payment_method: client.preferred_payment_method || '',
        auto_invoice: client.auto_invoice || false,
        invoice_delivery_method: client.invoice_delivery_method || '',
        invoice_template_id: client.invoice_template_id || '',
        billing_contact_id: client.billing_contact_id || '',
        billing_email: client.billing_email || '',
        region_code: client.region_code || null,
        default_currency_code: client.default_currency_code || 'USD',
    });

    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isSavingBillingConfig, setIsSavingBillingConfig] = useState(false);
    const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
    const [clientTaxRates, setClientTaxRates] = useState<IClientTaxRate[]>([]);

    React.useEffect(() => {
        const fetchData = async () => {
            const fetchedTaxRates = await getTaxRatesAsync();
            setTaxRates(fetchedTaxRates);

            const fetchedClientTaxRates = await getClientTaxRates(client.client_id);
            setClientTaxRates(fetchedClientTaxRates);
        };
        fetchData();
    }, [client.client_id]);

    const handleSelectChange = (name: string) => async (value: string) => {
        setBillingConfig(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSavingBillingConfig) {
            return;
        }
        setIsSavingBillingConfig(true);
        try {
            const {
                payment_terms,
                preferred_payment_method,
                auto_invoice,
                invoice_delivery_method,
                billing_contact_id,
                billing_email,
                invoice_template_id,
                region_code,
                default_currency_code,
            } = billingConfig;

            await onSave({
                payment_terms,
                preferred_payment_method,
                auto_invoice,
                invoice_delivery_method,
                billing_contact_id,
                billing_email,
                region_code,
                default_currency_code
            });

            if (invoice_template_id !== client.invoice_template_id) {
                await setClientTemplateAsync(client.client_id, invoice_template_id?.trim() ? invoice_template_id : null);
            }

            toast.success(t('billingConfiguration.saveSuccess', { defaultValue: 'Billing configuration saved successfully' }));
        } catch (error) {
            const message = t('billingConfiguration.saveError', { defaultValue: 'Failed to save billing configuration' });
            setErrorMessage(message);
            handleError(error, message);
        } finally {
            setIsSavingBillingConfig(false);
        }
    };

    const handleAssignDefaultTaxRate = async (taxRateId: string) => {
        if (!taxRateId) return;
        try {
            const newClientTaxRateData: Pick<IClientTaxRateAssociation, 'client_id' | 'tax_rate_id'> = {
                client_id: client.client_id,
                tax_rate_id: taxRateId
            };
            await addClientTaxRate(newClientTaxRateData);
            const updatedClientTaxRates = await getClientTaxRates(client.client_id);
            setClientTaxRates(updatedClientTaxRates);
            setErrorMessage(null);
            toast.success(t('billingConfiguration.defaultTaxAssignedSuccess', { defaultValue: 'Default tax rate assigned successfully' }));
        } catch (error: any) {
            const message = error.message || t('billingConfiguration.defaultTaxAssignError', { defaultValue: 'Failed to assign default tax rate. Please try again.' });
            setErrorMessage(message);
            handleError(error, t('billingConfiguration.defaultTaxAssignError', { defaultValue: 'Failed to assign default tax rate' }));
            throw error;
        }
    };

    const handleChangeDefaultTaxRate = async (newTaxRateId: string) => {
        if (!newTaxRateId) return;
        try {
            await updateDefaultClientTaxRate(client.client_id, newTaxRateId);
            const updatedClientTaxRates = await getClientTaxRates(client.client_id);
            setClientTaxRates(updatedClientTaxRates);
            setErrorMessage(null);
            toast.success(t('billingConfiguration.defaultTaxChangedSuccess', { defaultValue: 'Default tax rate changed successfully' }));
        } catch (error: any) {
            const message = error.message || t('billingConfiguration.defaultTaxChangeError', { defaultValue: 'Failed to change default tax rate. Please try again.' });
            setErrorMessage(message);
            handleError(error, t('billingConfiguration.defaultTaxChangeError', { defaultValue: 'Failed to change default tax rate' }));
            throw error;
        }
    };

    const handleTaxRateCreated = async () => {
        try {
            const updatedTaxRates = await getTaxRatesAsync();
            setTaxRates(updatedTaxRates);
            toast.success(t('billingConfiguration.taxRateCreatedSuccess', { defaultValue: 'Tax rate created successfully' }));
        } catch (error) {
            const message = t('billingConfiguration.taxRatesRefreshError', { defaultValue: 'Failed to refresh tax rates list.' });
            setErrorMessage(message);
            handleError(error, message);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            {errorMessage && (
                <Dialog
                    id="billing-config-error"
                    title={t('billingConfiguration.errorDialogTitle', { defaultValue: 'Error' })}
                    isOpen={!!errorMessage}
                    onClose={() => setErrorMessage(null)}
                    draggable={false}
                    footer={
                        <div className="flex justify-end space-x-2">
                            <Button
                                id="close-error-dialog-btn"
                                onClick={() => setErrorMessage(null)}
                                variant="secondary"
                            >
                                {t('common.actions.close', { defaultValue: 'Close' })}
                            </Button>
                        </div>
                    }
                >
                    <div className="space-y-4">
                        <p className="text-sm text-red-600">{errorMessage}</p>
                    </div>
                </Dialog>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="mb-4">
                    <TabsTrigger value="general">{t('billingConfiguration.general', { defaultValue: 'General' })}</TabsTrigger>
                    <TabsTrigger value="contracts">{t('billingConfiguration.contracts', { defaultValue: 'Contracts' })}</TabsTrigger>
                    <TabsTrigger value="taxRates">{t('billingConfiguration.taxRates', { defaultValue: 'Tax Rates' })}</TabsTrigger>
                </TabsList>
                <TabsContent value="general">
                    <BillingConfigForm
                        billingConfig={billingConfig}
                        handleSelectChange={handleSelectChange}
                        contacts={contacts}
                        clientId={client.client_id}
                    />

                    <ClientBillingSchedule clientId={client.client_id} />

                    <ClientZeroDollarInvoiceSettings
                        clientId={client.client_id}
                    />

                    <ClientCreditExpirationSettings
                        clientId={client.client_id}
                    />

                    <div className="flex justify-end">
                        <Button
                            id="save-billing-config-btn"
                            type="submit"
                            variant="default"
                            disabled={isSavingBillingConfig}
                        >
                            {isSavingBillingConfig
                                ? t('common.actions.saving', { defaultValue: 'Saving...' })
                                : t('billingConfiguration.save', { defaultValue: 'Save Billing Configuration' })}
                        </Button>
                    </div>
                </TabsContent>

                <TabsContent value="contracts" className="space-y-6">
                    <ClientContractAssignment clientId={client.client_id} />
                </TabsContent>

                <TabsContent value="taxRates">
                    <ClientTaxRates
                        clientId={client.client_id}
                        clientTaxRate={clientTaxRates.find(ctr => ctr.is_default) || null}
                        taxRates={taxRates}
                        onAssignDefault={handleAssignDefaultTaxRate}
                        onChangeDefault={handleChangeDefaultTaxRate}
                        onTaxRateCreated={handleTaxRateCreated}
                    />
                </TabsContent>
            </Tabs>
        </form>
    );
};

export default BillingConfiguration;
