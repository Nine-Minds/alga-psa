import { Text } from '@radix-ui/themes';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import { getInvoiceTemplates, getDefaultTemplate } from 'server/src/lib/actions/invoiceActions';
import { IInvoiceTemplate } from 'server/src/interfaces/invoice.interfaces';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { FileTextIcon } from 'lucide-react';
import { GearIcon } from '@radix-ui/react-icons';
import { useEffect, useState } from 'react';
import { ContactPicker } from '../contacts/ContactPicker';

interface BillingConfigFormProps {
    billingConfig: {
        payment_terms: string;
        billing_cycle: string;
        preferred_payment_method: string;
        invoice_delivery_method: string;
        invoice_template_id?: string;
        billing_contact_id?: string;
        billing_email?: string;
    };
    handleSelectChange: (name: string) => (value: string) => void;
    companyId: string;
    contacts: IContact[];
}

const BillingConfigForm: React.FC<BillingConfigFormProps> = ({
    billingConfig,
    handleSelectChange,
    companyId,
    contacts
}) => {
    const [templates, setTemplates] = useState<IInvoiceTemplate[]>([]);
    const [defaultTemplate, setDefaultTemplate] = useState<IInvoiceTemplate | null>(null);
    const [contactFilterState, setContactFilterState] = useState<'all' | 'active' | 'inactive'>('active');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            try {
                const [loadedTemplates, loadedDefault] = await Promise.all([
                    getInvoiceTemplates(),
                    getDefaultTemplate()
                ]);
                
                setTemplates(loadedTemplates);
                setDefaultTemplate(loadedDefault);
            } catch (error) {
                console.error('Error loading data:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, []);

    const templateOptions = templates.map(template => ({
        value: template.template_id,
        label: (
            <div className="flex items-center gap-2">
                {template.isStandard ? (
                    <div className="flex items-center gap-1">
                        <FileTextIcon className="w-4 h-4" /> 
                        {template.name} 
                        <span className="text-gray-500">(Standard)</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-1">
                        <GearIcon className="w-4 h-4" /> 
                        {template.name}
                        {template.is_default && <span className="text-blue-500">(Default)</span>}
                    </div>
                )}
            </div>
        )
    }));

    const paymentTermsOptions = [
        { value: 'net_30', label: 'Net 30' },
        { value: 'net_15', label: 'Net 15' },
        { value: 'due_on_receipt', label: 'Due on Receipt' }
    ];

    const billingCycleOptions = [
        { value: 'monthly', label: 'Monthly' },
        { value: 'quarterly', label: 'Quarterly' },
        { value: 'annually', label: 'Annually' }
    ];

    const paymentMethodOptions = [
        { value: 'credit_card', label: 'Credit Card' },
        { value: 'bank_transfer', label: 'Bank Transfer' },
        { value: 'check', label: 'Check' }
    ];

    const deliveryMethodOptions = [
        { value: 'email', label: 'Email' },
        { value: 'mail', label: 'Mail' },
        { value: 'both', label: 'Both' }
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 col-span-2">
                <Text as="div" size="2" mb="1" weight="bold">
                    Billing Contact Information
                </Text>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <ContactPicker
                            id="company-billing-contact-select"
                            contacts={contacts}
                            onSelect={(contactId) => {
                                handleSelectChange('billing_contact_id')(contactId);
                                // Clear billing email if contact is selected, keep it if contact is cleared
                                if (contactId) {
                                    handleSelectChange('billing_email')('');
                                }
                            }}
                            selectedContactId={billingConfig.billing_contact_id || null}
                            companyId={companyId}
                            filterState={contactFilterState}
                            onFilterStateChange={setContactFilterState}
                            fitContent={false}
                        />
                    </div>
                    <div className="space-y-2">
                        <Input
                            id="company-billing-email-input"
                            label="Alternative Billing Email"
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
                            placeholder="Or enter a specific billing email"
                        />
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <CustomSelect
                    id="company-invoice-template-select"
                    label="Invoice Template"
                    value={billingConfig.invoice_template_id || (defaultTemplate?.template_id || '')}
                    placeholder={!billingConfig.invoice_template_id && defaultTemplate 
                        ? `Using default template: ${defaultTemplate.name}`
                        : 'Select a template or use default'}
                    onValueChange={handleSelectChange('invoice_template_id')}
                    options={templateOptions}
                    disabled={isLoading}
                />
            </div>

            <div className="space-y-2">
                <CustomSelect
                    label="Payment Terms"
                    value={billingConfig.payment_terms}
                    onValueChange={handleSelectChange('payment_terms')}
                    options={paymentTermsOptions}
                />
            </div>

            <div className="space-y-2">
                <CustomSelect
                    label="Billing Cycle"
                    value={billingConfig.billing_cycle}
                    onValueChange={handleSelectChange('billing_cycle')}
                    options={billingCycleOptions}
                />
            </div>

            <div className="space-y-2">
                <CustomSelect
                    label="Preferred Payment Method"
                    value={billingConfig.preferred_payment_method}
                    onValueChange={handleSelectChange('preferred_payment_method')}
                    options={paymentMethodOptions}
                />
            </div>

            <div className="space-y-2">
                <CustomSelect
                    label="Invoice Delivery Method"
                    value={billingConfig.invoice_delivery_method}
                    onValueChange={handleSelectChange('invoice_delivery_method')}
                    options={deliveryMethodOptions}
                />
            </div>
        </div>
    );
};

export default BillingConfigForm;
