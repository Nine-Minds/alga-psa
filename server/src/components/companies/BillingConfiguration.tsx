'use client'

import React, { useState, useEffect } from 'react';
import { ICompany } from '../../interfaces/company.interfaces';
import { AlertDialog } from '@radix-ui/themes';
import { Button } from '@/components/ui/Button';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { getCompanyBillingPlan, updateCompanyBillingPlan, addCompanyBillingPlan, removeCompanyBillingPlan, editCompanyBillingPlan } from '../../lib/actions/companyBillingPlanActions';
import { getBillingPlans } from '../../lib/actions/billingPlanAction';
import { getServiceCategories } from '../../lib/actions/serviceCategoryActions';
import { ICompanyBillingPlan, IBillingPlan, IServiceCategory, ServiceType, BillingCycleType } from '../../interfaces/billing.interfaces';
import { getServices, createService, updateService, deleteService } from '../../lib/actions/serviceActions';
import { IService } from '../../interfaces/billing.interfaces';
import { getTaxRates } from '../../lib/actions/taxRateActions';
import { getCompanyTaxRates, addCompanyTaxRate, removeCompanyTaxRate } from '../../lib/actions/companyTaxRateActions';
import { ITaxRate, ICompanyTaxRate } from '../../interfaces/billing.interfaces';
import { getBillingCycle, updateBillingCycle } from '../../lib/actions/billingCycleActions';
import BillingConfigForm from './BillingConfigForm';
import CompanyTaxRates from './CompanyTaxRates';
import BillingPlans from './BillingPlans';

interface BillingConfigurationProps {
    company: ICompany;
    onSave: (updatedCompany: Partial<ICompany>) => void;
}

type DateString = string;

interface CompanyBillingPlanWithStringDates extends Omit<ICompanyBillingPlan, 'start_date' | 'end_date'> {
    start_date: DateString;
    end_date: DateString | null;
}

const BillingConfiguration: React.FC<BillingConfigurationProps> = ({ company, onSave }) => {
    const [billingConfig, setBillingConfig] = useState({
        payment_terms: company.payment_terms || 'net_30',
        billing_cycle: '',
        credit_limit: company.credit_limit || 0,
        preferred_payment_method: company.preferred_payment_method || '',
        auto_invoice: company.auto_invoice || false,
        invoice_delivery_method: company.invoice_delivery_method || '',
    });

    const [billingPlans, setBillingPlans] = useState<IBillingPlan[]>([]);
    const [serviceCategories, setServiceCategories] = useState<IServiceCategory[]>([]);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [companyBillingPlans, setCompanyBillingPlans] = useState<CompanyBillingPlanWithStringDates[]>([]);
    const [editingBillingPlan, setEditingBillingPlan] = useState<CompanyBillingPlanWithStringDates | null>(null);
    const [billingPlanToDelete, setBillingPlanToDelete] = useState<string | null>(null);

    const [services, setServices] = useState<IService[]>([]);
    const [newService, setNewService] = useState<Partial<IService>>({
        unit_of_measure: 'hour',
        service_type: 'Time' as ServiceType,
        service_name: '',
        default_rate: 0,
        category_id: '',
    });
    const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
    const [companyTaxRates, setCompanyTaxRates] = useState<ICompanyTaxRate[]>([]);
    const [selectedTaxRate, setSelectedTaxRate] = useState<string>('');

    const formatStartDate = (date: any): string => {
        if (!date) return new Date().toISOString().split('T')[0];
        if (typeof date === 'string') return date.includes('T') ? date.split('T')[0] : date;
        return new Date().toISOString().split('T')[0];
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

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const { billing_cycle, ...restConfig } = billingConfig;
        onSave(restConfig);
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
            await createService(newService as IService);
            setNewService({
                unit_of_measure: 'hour',
                service_type: 'Time' as ServiceType,
                service_name: '',
                default_rate: 0,
                category_id: '',
            });
            const updatedServices = await getServices();
            setServices(updatedServices);
        } catch (error) {
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

    const formatDateForDisplay = (date: string | Date | null): string => {
        if (!date) return 'N/A';
        const d = typeof date === 'string' ? new Date(date) : date;
        return d.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {errorMessage && (
                <AlertDialog.Root open={!!errorMessage}>
                    <AlertDialog.Content>
                        <AlertDialog.Title>Error</AlertDialog.Title>
                        <AlertDialog.Description>{errorMessage}</AlertDialog.Description>
                        <Button 
                            onClick={() => setErrorMessage(null)} 
                            variant="secondary"
                        >
                            Close
                        </Button>
                    </AlertDialog.Content>
                </AlertDialog.Root>
            )}

            <BillingConfigForm
                billingConfig={billingConfig}
                handleInputChange={handleInputChange}
                handleSelectChange={handleSelectChange}
                handleSwitchChange={handleSwitchChange}
            />

            <CompanyTaxRates
                companyTaxRates={companyTaxRates}
                taxRates={taxRates}
                selectedTaxRate={selectedTaxRate}
                onSelectTaxRate={setSelectedTaxRate}
                onAdd={handleAddCompanyTaxRate}
                onRemove={handleRemoveCompanyTaxRate}
            />

            <BillingPlans
                companyBillingPlans={companyBillingPlans}
                billingPlans={billingPlans}
                serviceCategories={serviceCategories}
                companyId={company.company_id}
                onEdit={handleEditBillingPlan}
                onDelete={handleRemoveBillingPlan}
                onAdd={handleAddBillingPlan}
                onCompanyPlanChange={handleCompanyPlanChange}
                formatDateForDisplay={formatDateForDisplay}
            />

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
                                variant="secondary"
                                onClick={() => setEditingBillingPlan(null)}
                            >
                                Cancel
                            </Button>
                            <Button
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
