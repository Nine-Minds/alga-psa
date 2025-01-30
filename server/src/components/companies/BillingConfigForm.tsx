import React, { useEffect, useState } from 'react';
import { Text } from '@radix-ui/themes';
import CustomSelect from '@/components/ui/CustomSelect';
import { getInvoiceTemplates, getDefaultTemplate } from '@/lib/actions/invoiceActions';
import { IInvoiceTemplate } from '@/interfaces/invoice.interfaces';
import { FileTextIcon } from 'lucide-react';
import { GearIcon } from '@radix-ui/react-icons';

interface BillingConfigFormProps {
    billingConfig: {
        payment_terms: string;
        billing_cycle: string;
        preferred_payment_method: string;
        invoice_delivery_method: string;
        invoice_template_id?: string;
    };
    handleSelectChange: (name: string) => (value: string) => void;
}

const BillingConfigForm: React.FC<BillingConfigFormProps> = ({
    billingConfig,
    handleSelectChange
}) => {
    const [templates, setTemplates] = useState<IInvoiceTemplate[]>([]);
    const [defaultTemplate, setDefaultTemplate] = useState<IInvoiceTemplate | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadTemplates = async () => {
            try {
                const [loadedTemplates, loadedDefault] = await Promise.all([
                    getInvoiceTemplates(),
                    getDefaultTemplate()
                ]);
                setTemplates(loadedTemplates);
                setDefaultTemplate(loadedDefault);
            } catch (error) {
                console.error('Error loading templates:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadTemplates();
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
