import React from 'react';
import { Text } from '@radix-ui/themes';
import CustomSelect from '@/components/ui/CustomSelect';

interface BillingConfigFormProps {
    billingConfig: {
        payment_terms: string;
        billing_cycle: string;
        preferred_payment_method: string;
        invoice_delivery_method: string;
    };
    handleSelectChange: (name: string) => (value: string) => void;
}

const BillingConfigForm: React.FC<BillingConfigFormProps> = ({
    billingConfig,
    handleSelectChange
}) => {
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
