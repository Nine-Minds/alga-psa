import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import PlanPickerDialog from './PlanPickerDialog';
import { ICompanyBillingPlan, IBillingPlan, IServiceCategory } from '@/interfaces/billing.interfaces';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import CustomSelect from '@/components/ui/CustomSelect';
import { Pencil, Trash2, Plus } from 'lucide-react';

interface BillingPlansProps {
    companyBillingPlans: ICompanyBillingPlan[];
    billingPlans: IBillingPlan[];
    serviceCategories: IServiceCategory[];
    companyId: string;
    onEdit: (billing: ICompanyBillingPlan) => void;
    onDelete: (companyBillingPlanId: string) => void;
    onAdd: (selectedPlan: Omit<ICompanyBillingPlan, "company_billing_plan_id" | "tenant">) => Promise<void>;
    onCompanyPlanChange: (companyBillingPlanId: string, planId: string) => void;
    onServiceCategoryChange: (companyBillingPlanId: string, categoryId: string) => void;
    formatDateForDisplay: (date: string | Date | null) => string;
}

const BillingPlans: React.FC<BillingPlansProps> = ({
    companyBillingPlans,
    billingPlans,
    serviceCategories,
    onEdit,
    onDelete,
    onAdd,
    onCompanyPlanChange,
    formatDateForDisplay,
    companyId
}) => {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const columns: ColumnDefinition<ICompanyBillingPlan>[] = [
        {
            title: 'Plan',
            dataIndex: 'plan_id',
            render: (value, record) => (
                <CustomSelect
                    value={value}
                    onValueChange={(newValue) => onCompanyPlanChange(record.company_billing_plan_id, newValue)}
                    options={billingPlans.map((plan): { value: string; label: string } => ({
                        value: plan.plan_id || '',
                        label: plan.plan_name
                    }))}
                    placeholder="Select plan..."
                />
            )
        },
        {
            title: 'Category',
            dataIndex: 'service_category',
            render: (value, record) => (
                <CustomSelect
                    value={value || 'unassigned'}
                    onValueChange={(newValue) => onCompanyPlanChange(record.company_billing_plan_id, newValue)}
                    options={[
                        { value: 'unassigned', label: 'Select category' },
                        ...serviceCategories.map((category): { value: string; label: string } => ({
                            value: category.category_id || 'None',
                            label: category.category_name
                        }))
                    ]}
                    placeholder="Select category..."
                />
            )
        },
        {
            title: 'Start Date',
            dataIndex: 'start_date',
            render: (value) => formatDateForDisplay(value)
        },
        {
            title: 'End Date',
            dataIndex: 'end_date',
            render: (value) => value ? formatDateForDisplay(value) : 'Ongoing'
        },
        {
            title: 'Actions',
            dataIndex: 'company_billing_plan_id',
            render: (value, record) => (
                <div className="flex items-center space-x-2">
                    <Button
                        id={`edit-billing-plan-${record.company_billing_plan_id}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(record)}
                        className="hover:bg-[rgb(var(--color-border-100))]"
                    >
                        <Pencil className="h-4 w-4 text-[rgb(var(--color-text-600))]" />
                    </Button>
                    <Button
                        id={`delete-billing-plan-${value}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(value)}
                        className="hover:bg-[rgb(var(--color-accent-50))]"
                    >
                        <Trash2 className="h-4 w-4 text-[rgb(var(--color-accent-600))]" />
                    </Button>
                </div>
            )
        }
    ];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
                    Billing Plans
                </h3>
                <Button
                    id="add-new-billing-plan-btn"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDialogOpen(true);
                    }}
                    type="button"
                    size="default"
                    className="bg-[rgb(var(--color-primary-500))] hover:bg-[rgb(var(--color-primary-600))] flex items-center gap-2"
                >
                    <Plus className="h-4 w-4" />
                    Add New Plan
                </Button>
            </div>
            <div className="rounded-lg border border-[rgb(var(--color-border-200))]">
                <DataTable
                    data={companyBillingPlans}
                    columns={columns}
                />
            </div>
            <PlanPickerDialog
                isOpen={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                onSelect={(plan, serviceCategory, startDate) => {
                    const newBillingPlan: Omit<ICompanyBillingPlan, "company_billing_plan_id" | "tenant"> = {
                        company_id: companyId,
                        plan_id: plan.plan_id!,
                        service_category: serviceCategory,
                        start_date: startDate,
                        end_date: null,
                        is_active: true
                    };
                    onAdd(newBillingPlan);
                }}
                availablePlans={billingPlans}
                serviceCategories={serviceCategories}
            />
        </div>
    );
};

export default BillingPlans;
