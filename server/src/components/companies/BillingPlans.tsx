import React, { useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import PlanPickerDialog from './PlanPickerDialog';
import { ICompanyBillingPlan, IBillingPlan, IServiceCategory } from 'server/src/interfaces/billing.interfaces';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Pencil, Trash2, Plus, MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';

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
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            id={`company-billing-plan-actions-menu-${record.company_billing_plan_id}`}
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={(e) => e.stopPropagation()} // Prevent row click when opening menu
                        >
                            <span className="sr-only">Open menu</span>
                            <MoreVertical className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            id={`edit-company-billing-plan-menu-item-${record.company_billing_plan_id}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onEdit(record);
                            }}
                        >
                            Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            id={`delete-company-billing-plan-menu-item-${value}`}
                            className="text-red-600 focus:text-red-600"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(value);
                            }}
                        >
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
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
                    onRowClick={onEdit} // Add row click handler
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
