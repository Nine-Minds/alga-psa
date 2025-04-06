'use client'

import React, { useState, useEffect } from 'react';
import { ICompany } from '../../interfaces/company.interfaces';
import { IContact } from '../../interfaces/contact.interfaces';
import { AlertDialog } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import ContactModel from 'server/src/lib/models/contact';
import { getCompanyBillingPlan, updateCompanyBillingPlan, addCompanyBillingPlan, removeCompanyBillingPlan, editCompanyBillingPlan } from '../../lib/actions/companyBillingPlanActions';
import { getBillingPlans } from '../../lib/actions/billingPlanAction';
import { getServiceCategories } from '../../lib/actions/serviceCategoryActions';
import { ICompanyBillingPlan, IBillingPlan, IServiceCategory, BillingCycleType } from '../../interfaces/billing.interfaces';
import { getServices, createService, updateService, deleteService } from '../../lib/actions/serviceActions';
import { IService } from '../../interfaces/billing.interfaces';
import { getTaxRates } from '../../lib/actions/taxRateActions';
import { getCompanyTaxRates, addCompanyTaxRate, removeCompanyTaxRate } from '../../lib/actions/companyTaxRateActions';
import { ITaxRate, ICompanyTaxRate } from '../../interfaces/billing.interfaces';
import { getBillingCycle, updateBillingCycle } from '../../lib/actions/billingCycleActions';
import { setCompanyTemplate } from '../../lib/actions/invoiceActions';
import BillingConfigForm from './BillingConfigForm';
import CompanyTaxRates from './CompanyTaxRates';
import BillingPlans from './BillingPlans';
import CompanyZeroDollarInvoiceSettings from './CompanyZeroDollarInvoiceSettings';
import CompanyCreditExpirationSettings from './CompanyCreditExpirationSettings';
import CompanyServiceOverlapMatrix from './CompanyServiceOverlapMatrix';
import CompanyPlanDisambiguationGuide from './CompanyPlanDisambiguationGuide';
import CompanyBundleAssignment from './CompanyBundleAssignment'; // Added import

interface BillingConfigurationProps {
    company: ICompany;
    onSave: (updatedCompany: Partial<ICompany>) => void;
    contacts?: IContact[];
}

type DateString = string;

interface CompanyBillingPlanWithStringDates extends Omit<ICompanyBillingPlan, 'start_date' | 'end_date'> {
    start_date: DateString;
    end_date: DateString | null;
}

const BillingConfiguration: React.FC<BillingConfigurationProps> = ({ company, onSave, contacts = [] }) => {
    const [activeTab, setActiveTab] = useState('general');
    const [billingConfig, setBillingConfig] = useState({
        payment_terms: company.payment_terms || 'net_30',
        billing_cycle: '',
        credit_limit: company.credit_limit || 0,
        preferred_payment_method: company.preferred_payment_method || '',
        auto_invoice: company.auto_invoice || false,
        invoice_delivery_method: company.invoice_delivery_method || '',
        invoice_template_id: company.invoice_template_id || '',
        billing_contact_id: company.billing_contact_id || '',
        billing_email: company.billing_email || '',
    });

    const [billingPlans, setBillingPlans] = useState<IBillingPlan[]>([]);
    const [serviceCategories, setServiceCategories] = useState<IServiceCategory[]>([]);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [companyBillingPlans, setCompanyBillingPlans] = useState<CompanyBillingPlanWithStringDates[]>([]);
    const [editingBillingPlan, setEditingBillingPlan] = useState<CompanyBillingPlanWithStringDates | null>(null);
    const [billingPlanToDelete, setBillingPlanToDelete] = useState<string | null>(null);
    const [services, setServices] = useState<IService[]>([]);
    const [serviceTypes, setServiceTypes] = useState<{ id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[]>([]);
    const [newService, setNewService] = useState<Partial<IService>>({
        unit_of_measure: 'hour',
        // Use standard_service_type_id for default Time service
        standard_service_type_id: '', // Will be set after fetching service types
        service_name: '',
        default_rate: 0,
        category_id: null,
        billing_method: 'fixed',
        description: '', // Add description field
    });
    const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
    const [companyTaxRates, setCompanyTaxRates] = useState<ICompanyTaxRate[]>([]);
    const [selectedTaxRate, setSelectedTaxRate] = useState<string>('');

    // Formats a Date object or string into 'YYYY-MM-DD' string, handling potential UTC interpretation
    const formatStartDate = (date: Date | string | null): string => {
        // Log the input received by the function on the client side
        console.log("BillingConfiguration formatStartDate received:", date, typeof date);
        if (!date) return ''; // Return empty string or a default if preferred
        
        let d: Date;
        if (typeof date === 'string') {
            // If it's already a string, assume YYYY-MM-DD or ISO and try parsing
            // Handle potential 'T' separator from ISO strings
            const dateString = date.includes('T') ? date.split('T')[0] : date;
            const parts = dateString.split('-');
            if (parts.length === 3) {
                 // Construct date using UTC values to avoid timezone shifts during parsing
                 // Construct date using UTC values to avoid timezone shifts during parsing
                d = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
            } else {
                d = new Date(date); // Fallback parsing
            }
        } else {
            // If it's a Date object, use it directly
            d = date;
        }

        if (isNaN(d.getTime())) {
            return ''; // Handle invalid date
        }

        // Extract year, month, day using UTC methods to match the UTC date parsed/received
        const year = d.getUTCFullYear();
        const month = (d.getUTCMonth() + 1).toString().padStart(2, '0'); // Month is 0-indexed
        const day = d.getUTCDate().toString().padStart(2, '0');
        
        return `${year}-${month}-${day}`;
    };

    useEffect(() => {
        const fetchData = async () => {
            const billingPlans = await getCompanyBillingPlan(company.company_id);
            const billingPlansWithStringDates: CompanyBillingPlanWithStringDates[] = billingPlans.map((plan: ICompanyBillingPlan): CompanyBillingPlanWithStringDates => ({
                ...plan,
                start_date: formatStartDate(plan.start_date),
                end_date: plan.end_date ? (typeof plan.end_date === 'string' ? plan.end_date.split('T')[0] : null) : null
            }));
            setCompanyBillingPlans(billingPlansWithStringDates);

            const plans = await getBillingPlans();
            setBillingPlans(plans);

            const categories = await getServiceCategories();
            setServiceCategories(categories);

            const billingCycle = await getBillingCycle(company.company_id);
            setBillingConfig(prev => ({ ...prev, billing_cycle: billingCycle }));

            const fetchedServices = await getServices();
            setServices(fetchedServices);

            // Fetch service types for the dropdown
            const { getServiceTypesForSelection } = await import('../../lib/actions/serviceActions');
            const types = await getServiceTypesForSelection();
            setServiceTypes(types);
            
            // Find a default "Time" service type if it exists
            const timeType = types.find(t => t.name === 'Time');
            if (timeType) {
                // Set the appropriate ID based on whether it's standard or custom
                if (timeType.is_standard) {
                    setNewService(prev => ({ ...prev, standard_service_type_id: timeType.id, billing_method: timeType.billing_method }));
                } else {
                    setNewService(prev => ({ ...prev, custom_service_type_id: timeType.id, billing_method: timeType.billing_method }));
                }
            }

            const fetchedTaxRates = await getTaxRates();
            setTaxRates(fetchedTaxRates);

            const fetchedCompanyTaxRates = await getCompanyTaxRates(company.company_id);
            setCompanyTaxRates(fetchedCompanyTaxRates);
        };
        fetchData();
    }, [company.company_id]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setBillingConfig(prev => ({ ...prev, [name]: value }));
    };

    const handleSelectChange = (name: string) => async (value: string) => {
        if (name === 'billing_cycle') {
            await updateBillingCycle(company.company_id, value as BillingCycleType);
        }
        setBillingConfig(prev => ({ ...prev, [name]: value }));
    };

    const handleSwitchChange = (checked: boolean) => {
        setBillingConfig(prev => ({ ...prev, auto_invoice: checked }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            // Extract all billing-related fields
            const {
                payment_terms,
                preferred_payment_method,
                auto_invoice,
                invoice_delivery_method,
                billing_contact_id,
                billing_email,
                billing_cycle,
                invoice_template_id,
                ...rest
            } = billingConfig;
            
            // Always include billing fields in update data to ensure they're properly nulled
            await onSave({
                payment_terms,
                preferred_payment_method,
                auto_invoice,
                invoice_delivery_method,
                billing_contact_id,  // Pass through as-is, updateCompany will handle empty strings
                billing_email
            });
            
            // Save template selection separately using the dedicated function
            if (invoice_template_id !== company.invoice_template_id) {
                await setCompanyTemplate(company.company_id, invoice_template_id || null);
            }
        } catch (error) {
            console.error('Error saving billing configuration:', error);
            setErrorMessage('Failed to save billing configuration');
        }
    };

    const handleCompanyPlanChange = async (companyBillingPlanId: string, planId: string) => {
        try {
            await updateCompanyBillingPlan(companyBillingPlanId, { plan_id: planId });
            const updatedBillingPlans = await getCompanyBillingPlan(company.company_id);
            const updatedBillingPlansWithStringDates: CompanyBillingPlanWithStringDates[] = updatedBillingPlans.map((plan: ICompanyBillingPlan): CompanyBillingPlanWithStringDates => ({
                ...plan,
                start_date: formatStartDate(plan.start_date),
                end_date: plan.end_date ? (typeof plan.end_date === 'string' ? plan.end_date.split('T')[0] : null) : null
            }));
            setCompanyBillingPlans(updatedBillingPlansWithStringDates);
        } catch (error) {
            setErrorMessage('Failed to update billing plan. Please try again.');
        }
    };

    const handleServiceCategoryChange = async (companyBillingPlanId: string, categoryId: string) => {
        try {
            await updateCompanyBillingPlan(companyBillingPlanId, { service_category: categoryId });
            const updatedBillingPlans = await getCompanyBillingPlan(company.company_id);
            const updatedBillingPlansWithStringDates: CompanyBillingPlanWithStringDates[] = updatedBillingPlans.map((plan: ICompanyBillingPlan): CompanyBillingPlanWithStringDates => ({
                ...plan,
                start_date: formatStartDate(plan.start_date),
                end_date: plan.end_date ? (typeof plan.end_date === 'string' ? plan.end_date.split('T')[0] : null) : null
            }));
            setCompanyBillingPlans(updatedBillingPlansWithStringDates);
        } catch (error) {
            setErrorMessage('Failed to update service category. Please try again.');
        }
    };

    const handleAddBillingPlan = async (newBillingPlan: Omit<ICompanyBillingPlan, "company_billing_plan_id" | "tenant">) => {
        try {
            await addCompanyBillingPlan(newBillingPlan);
            const updatedBillingPlans = await getCompanyBillingPlan(company.company_id);
            const updatedBillingPlansWithStringDates: CompanyBillingPlanWithStringDates[] = updatedBillingPlans.map((plan: ICompanyBillingPlan): CompanyBillingPlanWithStringDates => ({
                ...plan,
                start_date: formatStartDate(plan.start_date),
                end_date: plan.end_date ? (typeof plan.end_date === 'string' ? plan.end_date.split('T')[0] : null) : null
            }));
            setCompanyBillingPlans(updatedBillingPlansWithStringDates);
        } catch (error: any) {
            setErrorMessage(error.message || 'Failed to add billing plan. Please try again.');
        }
    };

    const handleRemoveBillingPlan = async (companyBillingPlanId: string) => {
        setBillingPlanToDelete(companyBillingPlanId);
    };

    const confirmRemoveBillingPlan = async () => {
        if (!billingPlanToDelete) return;
        
        try {
            await removeCompanyBillingPlan(billingPlanToDelete);
            const updatedBillingPlans = await getCompanyBillingPlan(company.company_id);
            const updatedBillingPlansWithStringDates: CompanyBillingPlanWithStringDates[] = updatedBillingPlans.map((plan: ICompanyBillingPlan): CompanyBillingPlanWithStringDates => ({
                ...plan,
                start_date: formatStartDate(plan.start_date),
                end_date: plan.end_date ? (typeof plan.end_date === 'string' ? plan.end_date.split('T')[0] : null) : null
            }));
            setCompanyBillingPlans(updatedBillingPlansWithStringDates);
        } catch (error) {
            setErrorMessage('Failed to remove billing plan. Please try again.');
        } finally {
            setBillingPlanToDelete(null);
        }
    };

    const handleEditBillingPlan = (billing: CompanyBillingPlanWithStringDates) => {
        setEditingBillingPlan({ ...billing });
    };

    const handleSaveEditBillingPlan = async () => {
        if (editingBillingPlan) {
            try {
                const updatedBilling: ICompanyBillingPlan = {
                    ...editingBillingPlan,
                    start_date: editingBillingPlan.start_date || '',
                    end_date: editingBillingPlan.end_date || null
                };
                await editCompanyBillingPlan(updatedBilling.company_billing_plan_id, updatedBilling);

                const updatedBillingPlans = await getCompanyBillingPlan(company.company_id);
                const updatedBillingPlansWithStringDates: CompanyBillingPlanWithStringDates[] = updatedBillingPlans.map((plan: ICompanyBillingPlan): CompanyBillingPlanWithStringDates => ({
                    ...plan,
                    start_date: formatStartDate(plan.start_date),
                    end_date: plan.end_date ? (typeof plan.end_date === 'string' ? plan.end_date.split('T')[0] : null) : null
                }));
                setCompanyBillingPlans(updatedBillingPlansWithStringDates);
                setEditingBillingPlan(null);
                setErrorMessage(null);
            } catch (error) {
                setErrorMessage('Failed to save changes. Please try again.');
            }
        }
    };

    const handleAddService = async () => {
        try {
            // Ensure we have either standard_service_type_id or custom_service_type_id
            if (!newService.standard_service_type_id && !newService.custom_service_type_id) {
                setErrorMessage('Please select a service type');
                return;
            }
            
            await createService(newService as any);
            
            // Reset the form
            setNewService({
                unit_of_measure: 'hour',
                standard_service_type_id: undefined,
                custom_service_type_id: undefined,
                service_name: '',
                default_rate: 0,
                category_id: null,
                billing_method: 'fixed',
                description: '', // Reset description field
            });
            
            // Find a default "Time" service type if it exists
            const timeType = serviceTypes.find(t => t.name === 'Time');
            if (timeType) {
                // Set the appropriate ID based on whether it's standard or custom
                if (timeType.is_standard) {
                    setNewService(prev => ({
                        ...prev,
                        standard_service_type_id: timeType.id,
                        billing_method: timeType.billing_method,
                        description: prev.description || '' // Preserve description
                    }));
                } else {
                    setNewService(prev => ({
                        ...prev,
                        custom_service_type_id: timeType.id,
                        billing_method: timeType.billing_method,
                        description: prev.description || '' // Preserve description
                    }));
                }
            }
            
            const updatedServices = await getServices();
            setServices(updatedServices);
            setErrorMessage(null);
        } catch (error) {
            console.error('Error creating service:', error);
            setErrorMessage('Failed to add service. Please try again.');
        }
    };

    const handleUpdateService = async (service: IService) => {
        try {
            await updateService(service.service_id, service);
            const updatedServices = await getServices();
            setServices(updatedServices);
        } catch (error) {
            setErrorMessage('Failed to update service. Please try again.');
        }
    };

    const handleDeleteService = async (serviceId: string) => {
        try {
            await deleteService(serviceId);
            const updatedServices = await getServices();
            setServices(updatedServices);
        } catch (error) {
            setErrorMessage('Failed to delete service. Please try again.');
        }
    };

    const handleAddCompanyTaxRate = async () => {
        if (!selectedTaxRate) return;
        try {
            const newCompanyTaxRate: Omit<ICompanyTaxRate, 'company_tax_rate_id' | 'tenant'> = {
                company_id: company.company_id,
                tax_rate_id: selectedTaxRate
            };
            await addCompanyTaxRate(newCompanyTaxRate);
            const updatedCompanyTaxRates = await getCompanyTaxRates(company.company_id);
            setCompanyTaxRates(updatedCompanyTaxRates);
            setSelectedTaxRate('');
        } catch (error) {
            setErrorMessage('Failed to add tax rate to company. Please try again.');
        }
    };

    const handleRemoveCompanyTaxRate = async (taxRateId: string) => {
        try {
            await removeCompanyTaxRate(company.company_id, taxRateId);
            const updatedCompanyTaxRates = await getCompanyTaxRates(company.company_id);
            setCompanyTaxRates(updatedCompanyTaxRates);
        } catch (error) {
            setErrorMessage('Failed to remove tax rate from company. Please try again.');
        }
    };

    // Displays a 'YYYY-MM-DD' string in a user-friendly format, treating it as UTC
    const formatDateForDisplay = (dateString: string | null): string => {
        if (!dateString) return 'N/A';

        // Parse YYYY-MM-DD string reliably, treating components as UTC date parts
        const parts = dateString.split('-');
        if (parts.length !== 3) return 'Invalid Date Format';

        try {
             // Construct date using UTC values to avoid timezone shifts during parsing
            const year = parseInt(parts[0]);
            const month = parseInt(parts[1]) - 1; // Month is 0-indexed
            const day = parseInt(parts[2]);
            const d = new Date(Date.UTC(year, month, day));

            if (isNaN(d.getTime())) {
                return 'Invalid Date';
            }

            // Format the date using toLocaleDateString, specifying UTC timezone
            // This ensures the displayed date matches the UTC date components
            return d.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                timeZone: 'UTC' // Specify UTC timezone for consistent display
            });
        } catch (error) {
            console.error("Error formatting date for display:", error);
            return 'Formatting Error';
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {errorMessage && (
                <AlertDialog.Root open={!!errorMessage}>
                    <AlertDialog.Content>
                        <AlertDialog.Title>Error</AlertDialog.Title>
                        <AlertDialog.Description>{errorMessage}</AlertDialog.Description>
                        <Button
                            id="close-error-dialog-btn"
                            onClick={() => setErrorMessage(null)}
                            variant="secondary"
                        >
                            Close
                        </Button>
                    </AlertDialog.Content>
                </AlertDialog.Root>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="mb-4">
                    <TabsTrigger value="general">General</TabsTrigger>
                    <TabsTrigger value="plans">Billing Plans</TabsTrigger>
                    <TabsTrigger value="taxRates">Tax Rates</TabsTrigger>
                    <TabsTrigger value="overlaps">Plan Overlaps</TabsTrigger>
                </TabsList>
    <TabsContent value="general">
        <BillingConfigForm
            billingConfig={billingConfig}
            handleSelectChange={handleSelectChange}
            contacts={contacts}
            companyId={company.company_id}
        />
        
        <CompanyZeroDollarInvoiceSettings
            companyId={company.company_id}
        />
        
        <CompanyCreditExpirationSettings
            companyId={company.company_id}
        />
    </TabsContent>
    
    <TabsContent value="plans" className="space-y-6"> {/* Added space-y for layout */}
        {/* Added CompanyBundleAssignment component */}
        <CompanyBundleAssignment companyId={company.company_id} />
        
        {/* Existing BillingPlans component */}
        <BillingPlans
            companyBillingPlans={companyBillingPlans}
            billingPlans={billingPlans}
            serviceCategories={serviceCategories}
            companyId={company.company_id}
            onEdit={handleEditBillingPlan}
            onDelete={handleRemoveBillingPlan}
            onAdd={handleAddBillingPlan}
            onCompanyPlanChange={handleCompanyPlanChange}
            onServiceCategoryChange={handleServiceCategoryChange}
            formatDateForDisplay={formatDateForDisplay}
        />
    </TabsContent>
    
    <TabsContent value="taxRates">
        <CompanyTaxRates
            companyTaxRates={companyTaxRates}
            taxRates={taxRates}
            selectedTaxRate={selectedTaxRate}
            onSelectTaxRate={setSelectedTaxRate}
            onAdd={handleAddCompanyTaxRate}
            onRemove={handleRemoveCompanyTaxRate}
        />
    </TabsContent>
    
    <TabsContent value="overlaps">
        <div className="space-y-6">
            <CompanyServiceOverlapMatrix
                companyId={company.company_id}
                companyBillingPlans={companyBillingPlans}
                services={services}
                onEdit={handleEditBillingPlan}
                className="mb-6"
            />
            
            <CompanyPlanDisambiguationGuide className="mb-6" />
        </div>
    </TabsContent>
</Tabs>

            {editingBillingPlan && (
                <AlertDialog.Root open={!!editingBillingPlan}>
                    <AlertDialog.Content>
                        <AlertDialog.Title>Edit Billing Plan</AlertDialog.Title>
                        <div className="space-y-4">
                            <div>
                                <label>Start Date</label>
                                <input
                                    type="date"
                                    value={editingBillingPlan.start_date}
                                    onChange={(e) => setEditingBillingPlan(prev => prev ? {
                                        ...prev,
                                        start_date: e.target.value
                                    } : null)}
                                    className="w-full p-2 border rounded"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="ongoing"
                                    checked={!editingBillingPlan.end_date}
                                    onChange={(e) => setEditingBillingPlan(prev => prev ? {
                                        ...prev,
                                        end_date: e.target.checked ? null : new Date().toISOString().split('T')[0]
                                    } : null)}
                                />
                                <label htmlFor="ongoing">Ongoing</label>
                            </div>
                            <div>
                                <label>End Date</label>
                                <input
                                    type="date"
                                    value={editingBillingPlan.end_date || ''}
                                    onChange={(e) => setEditingBillingPlan(prev => prev ? {
                                        ...prev,
                                        end_date: e.target.value || null
                                    } : null)}
                                    className="w-full p-2 border rounded"
                                    disabled={!editingBillingPlan.end_date}
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-4">
                            <Button
                                id="cancel-edit-billing-plan-btn"
                                variant="secondary"
                                onClick={() => setEditingBillingPlan(null)}
                            >
                                Cancel
                            </Button>
                            <Button
                                id="save-billing-plan-changes-btn"
                                onClick={handleSaveEditBillingPlan}
                            >
                                Save Changes
                            </Button>
                        </div>
                    </AlertDialog.Content>
                </AlertDialog.Root>
            )}

            <ConfirmationDialog
                isOpen={!!billingPlanToDelete}
                onClose={() => setBillingPlanToDelete(null)}
                onConfirm={confirmRemoveBillingPlan}
                title="Delete Billing Plan"
                message="Are you sure you want to delete this billing plan?"
            />

            <div className="flex justify-end">
                <Button 
                    id="save-billing-config-btn"
                    type="submit" 
                    variant="default"
                >
                    Save Billing Configuration
                </Button>
            </div>
        </form>
    );
};

export default BillingConfiguration;
