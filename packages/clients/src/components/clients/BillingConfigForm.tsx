import { Text } from '@radix-ui/themes';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { getInvoiceTemplatesAsync, getDefaultTemplateAsync, getActiveTaxRegionsAsync } from '../../lib/billingHelpers';
import { IInvoiceTemplate } from '@alga-psa/types';
import { IContact } from '@alga-psa/types';
import { ITaxRegion } from '@alga-psa/types'; // Added
import { FileText, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { CURRENCY_OPTIONS } from '@alga-psa/core';
import QuickAddContact from '../contacts/QuickAddContact';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface BillingConfigFormProps {
    billingConfig: {
        payment_terms: string;
        preferred_payment_method: string;
        invoice_delivery_method: string;
        invoice_template_id?: string;
        billing_contact_id?: string;
        billing_email?: string;
        region_code?: string | null; // Added for tax region
        default_currency_code?: string | null; // Added
    };
    handleSelectChange: (name: string) => (value: string) => void;
    clientId: string;
    contacts: IContact[];
}

const BillingConfigForm: React.FC<BillingConfigFormProps> = ({
    billingConfig,
    handleSelectChange,
    clientId,
    contacts
}) => {
    const { t } = useTranslation('msp/clients');
    const [templates, setTemplates] = useState<IInvoiceTemplate[]>([]);
    const [defaultTemplate, setDefaultTemplate] = useState<IInvoiceTemplate | null>(null);
    const [contactFilterState, setContactFilterState] = useState<'all' | 'active' | 'inactive'>('active');
    const [isLoadingTemplates, setIsLoadingTemplates] = useState(true); // Renamed
    const [taxRegions, setTaxRegions] = useState<Pick<ITaxRegion, 'region_code' | 'region_name'>[]>([]); // Added
    const [isLoadingTaxRegions, setIsLoadingTaxRegions] = useState(true); // Added
    const [errorTaxRegions, setErrorTaxRegions] = useState<string | null>(null); // Added
    const [isQuickAddContactOpen, setIsQuickAddContactOpen] = useState(false);
    const [billingContacts, setBillingContacts] = useState<IContact[]>(contacts);

    useEffect(() => {
        setBillingContacts(contacts);
    }, [contacts]);

    useEffect(() => {
        const loadTemplateData = async () => { // Renamed function
            try {
                const [loadedTemplates, loadedDefault] = await Promise.all([
                    getInvoiceTemplatesAsync(),
                    getDefaultTemplateAsync()
                ]);
                
                setTemplates(loadedTemplates);
                setDefaultTemplate(loadedDefault);
            } catch (error) {
                console.error('Error loading data:', error);
            } finally {
                setIsLoadingTemplates(false); // Use renamed state setter
            }
        };

        const loadTaxRegions = async () => { // Added function
           try {
               setIsLoadingTaxRegions(true);
               const regions = await getActiveTaxRegionsAsync();
               setTaxRegions(regions);
               setErrorTaxRegions(null);
           } catch (error) {
               console.error('Error loading tax regions:', error);
               setErrorTaxRegions(t('billingConfigForm.taxRegionsLoadError', { defaultValue: 'Failed to load tax regions.' }));
               setTaxRegions([]); // Clear regions on error
           } finally {
               setIsLoadingTaxRegions(false);
           }
        };

        loadTemplateData(); // Call renamed function
        loadTaxRegions(); // Call new function
    }, [t]);

    const templateOptions = templates.map(template => ({
        value: template.template_id,
        label: (
            <div className="flex items-center gap-2">
                {template.isStandard ? (
                    <div className="flex items-center gap-1">
                        <FileText className="w-4 h-4" /> 
                        {template.name} 
                        <span className="text-gray-500">{t('billingConfigForm.standardTemplateLabel', { defaultValue: '(Standard)' })}</span>
                        {template.isTenantDefault && <span className="text-blue-500">{t('billingConfigForm.defaultTemplateLabel', { defaultValue: '(Default)' })}</span>}
                    </div>
                ) : (
                    <div className="flex items-center gap-1">
                        <Settings className="w-4 h-4" /> 
                        {template.name}
                        {template.isTenantDefault && <span className="text-blue-500">{t('billingConfigForm.defaultTemplateLabel', { defaultValue: '(Default)' })}</span>}
                    </div>
                )}
            </div>
        )
    }));

    const paymentTermsOptions = [
        { value: 'net_30', label: t('billingConfigForm.paymentTerms.net30', { defaultValue: 'Net 30' }) },
        { value: 'net_15', label: t('billingConfigForm.paymentTerms.net15', { defaultValue: 'Net 15' }) },
        { value: 'due_on_receipt', label: t('billingConfigForm.paymentTerms.dueOnReceipt', { defaultValue: 'Due on Receipt' }) }
    ];

    const paymentMethodOptions = [
        { value: 'credit_card', label: t('billingConfigForm.paymentMethods.creditCard', { defaultValue: 'Credit Card' }) },
        { value: 'bank_transfer', label: t('billingConfigForm.paymentMethods.bankTransfer', { defaultValue: 'Bank Transfer' }) },
        { value: 'check', label: t('billingConfigForm.paymentMethods.check', { defaultValue: 'Check' }) }
    ];

    const deliveryMethodOptions = [
        { value: 'email', label: t('billingConfigForm.deliveryMethods.email', { defaultValue: 'Email' }) },
        { value: 'mail', label: t('billingConfigForm.deliveryMethods.mail', { defaultValue: 'Mail' }) },
        { value: 'both', label: t('billingConfigForm.deliveryMethods.both', { defaultValue: 'Both' }) }
    ];

    const taxRegionOptions = taxRegions.map(region => ({
       value: region.region_code,
       label: region.region_name
    }));

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="col-span-2">
                <Text as="div" size="3" mb="4" weight="medium" className="text-gray-900">
                    {t('billingConfigForm.billingContactInformation', { defaultValue: 'Billing Contact Information' })}
                </Text>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium mb-1 text-gray-700">
                            {t('billingConfigForm.billingContact', { defaultValue: 'Billing Contact' })}
                        </label>
                        <ContactPicker
                            id="client-billing-contact-select"
                            contacts={billingContacts}
                            onValueChange={(contactId: string) => { // Use onValueChange and add type
                                handleSelectChange('billing_contact_id')(contactId);
                                // Clear billing email if contact is selected, keep it if contact is cleared
                                if (contactId) {
                                    handleSelectChange('billing_email')('');
                                }
                            }}
                            value={billingConfig.billing_contact_id || ''}
                            clientId={clientId}
                            // Removed filterState, onFilterStateChange, and fitContent pp ps
                            onAddNew={() => setIsQuickAddContactOpen(true)}
                        />
                        <QuickAddContact
                            isOpen={isQuickAddContactOpen}
                            onClose={() => setIsQuickAddContactOpen(false)}
                            onContactAdded={(newContact) => {
                                setBillingContacts((prevContacts) => {
                                    const existingIndex = prevContacts.findIndex((contact) => contact.contact_name_id === newContact.contact_name_id);
                                    if (existingIndex >= 0) {
                                        const nextContacts = [...prevContacts];
                                        nextContacts[existingIndex] = newContact;
                                        return nextContacts;
                                    }
                                    return [...prevContacts, newContact];
                                });
                                handleSelectChange('billing_contact_id')(newContact.contact_name_id);
                                handleSelectChange('billing_email')('');
                                setIsQuickAddContactOpen(false);
                            }}
                            clients={[]}
                            selectedClientId={clientId}
                        />
                    </div>
                    <div className="space-y-2">
                        <Input
                            id="client-billing-email-input"
                            label={t('billingConfigForm.alternativeBillingEmail', { defaultValue: 'Alternative Billing Email' })}
                            type="email"
                            value={billingConfig.billing_email || ''}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                const newValue = e.target.value;
                                handleSelectChange('billing_email')(newValue);
                                // Clear billing contact if email is entered, keep it if email is cleared
                                if (newValue) {
                                    handleSelectChange('billing_contact_id')('');
                                }
                            }}
                            placeholder={t('billingConfigForm.alternativeBillingEmailHelp', { defaultValue: 'Or enter a specific billing email' })}
                        />
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <CustomSelect
                    id="client-invoice-template-select"
                    label={t('billingConfigForm.invoiceTemplate', { defaultValue: 'Invoice Template' })}
                    value={billingConfig.invoice_template_id || (defaultTemplate?.template_id || '')}
                    placeholder={!billingConfig.invoice_template_id && defaultTemplate 
                        ? t('billingConfigForm.usingDefaultTemplate', { defaultValue: 'Using default template: {{name}}', name: defaultTemplate.name })
                        : t('billingConfigForm.invoiceTemplateHelp', { defaultValue: 'Select a template or use default' })}
                    onValueChange={handleSelectChange('invoice_template_id')}
                    options={templateOptions}
                    disabled={isLoadingTemplates} // Use renamed state
                />
            </div>

            <div className="space-y-2">
                <CustomSelect
                    label={t('billingConfigForm.defaultCurrency', { defaultValue: 'Default Currency' })}
                    value={billingConfig.default_currency_code || 'USD'}
                    onValueChange={handleSelectChange('default_currency_code')}
                    options={CURRENCY_OPTIONS}
                />
            </div>

            <div className="space-y-2">
                <CustomSelect
                    label={t('billingConfigForm.paymentTermsLabel', { defaultValue: 'Payment Terms' })}
                    value={billingConfig.payment_terms}
                    onValueChange={handleSelectChange('payment_terms')}
                    options={paymentTermsOptions}
                />
            </div>

            <div className="space-y-2">
                <CustomSelect
                    label={t('billingConfigForm.preferredPaymentMethod', { defaultValue: 'Preferred Payment Method' })}
                    value={billingConfig.preferred_payment_method}
                    onValueChange={handleSelectChange('preferred_payment_method')}
                    options={paymentMethodOptions}
                />
            </div>

            <div className="space-y-2">
                <CustomSelect
                    label={t('billingConfigForm.invoiceDeliveryMethod', { defaultValue: 'Invoice Delivery Method' })}
                    value={billingConfig.invoice_delivery_method}
                    onValueChange={handleSelectChange('invoice_delivery_method')}
                    options={deliveryMethodOptions}
                />
            </div>

           {/* Added Tax Region Dropdown */}
           <div className="space-y-2">
               <CustomSelect
                   id="client-tax-region-select"
                   label={t('billingConfigForm.defaultTaxRegion', { defaultValue: 'Default Tax Region' })}
                   value={billingConfig.region_code || ''}
                   placeholder={isLoadingTaxRegions ? t('billingConfigForm.loadingRegions', { defaultValue: 'Loading regions...' }) : t('billingConfigForm.selectTaxRegion', { defaultValue: 'Select Tax Region (Optional)' })}
                   onValueChange={handleSelectChange('region_code')}
                   options={taxRegionOptions}
                   disabled={isLoadingTaxRegions}
                   allowClear={true} // Allow clearing the selection
               />
               {errorTaxRegions && <p className="text-red-500 text-sm mt-1">{errorTaxRegions}</p>}
           </div>
        </div>
    );
};

export default BillingConfigForm;
