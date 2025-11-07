import React, { useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import PlanPickerDialog from './PlanPickerDialog';
import { IClientContractLine, IContractLine, IServiceCategory } from 'server/src/interfaces/billing.interfaces';
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

interface ContractLinesProps {
    clientContractLines: IClientContractLine[];
    contractLines: IContractLine[];
    serviceCategories: IServiceCategory[];
    clientId: string;
    onEdit: (billing: IClientContractLine) => void;
    onDelete: (clientContractLineId: string) => void;
    onAdd: (selectedPlan: Omit<IClientContractLine, "client_contract_line_id" | "tenant">) => Promise<void>;
    onClientPlanChange: (clientContractLineId: string, planId: string) => void;
    onServiceCategoryChange: (clientContractLineId: string, categoryId: string) => void;
    formatDateForDisplay: (dateString: string | null) => string;
}

const ContractLines: React.FC<ContractLinesProps> = ({
    clientContractLines,
    contractLines,
    serviceCategories,
    onEdit,
    onDelete,
    onAdd,
    onClientPlanChange,
    formatDateForDisplay,
    clientId
}) => {
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    // Handle page size change - reset to page 1
    const handlePageSizeChange = (newPageSize: number) => {
        setPageSize(newPageSize);
        setCurrentPage(1);
    };
    const columns: ColumnDefinition<IClientContractLine>[] = [
        {
            title: 'Plan',
            dataIndex: 'contract_line_id',
            render: (value) => {
                const plan = contractLines.find(p => p.contract_line_id === value);
                return plan ? plan.contract_line_name : 'Unknown Plan';
            }
        },
        {
            title: 'Category',
            dataIndex: 'service_category',
            render: (value) => {
                if (value === null || value === undefined) {
                    return 'All categories';
                }
                const category = serviceCategories.find(c => c.category_id === value);
                return category ? category.category_name : 'Unknown Category';
            }
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
            dataIndex: 'client_contract_line_id',
            render: (value, record) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            id={`client-contract-line-actions-menu-${record.client_contract_line_id}`}
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
                            id={`edit-client-contract-line-menu-item-${record.client_contract_line_id}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onEdit(record);
                            }}
                        >
                            Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            id={`delete-client-contract-line-menu-item-${value}`}
                            className="text-red-600 focus:text-red-600"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(value);
                            }}
                        >
                            Remove Plan
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
                    Contract Lines
                </h3>
                <Button
                    id="add-new-contract-line-btn"
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
                    id="client-contract-lines-table"
                    data={clientContractLines}
                    columns={columns}
                    pagination={true}
                    currentPage={currentPage}
                    onPageChange={setCurrentPage}
                    pageSize={pageSize}
                    onItemsPerPageChange={handlePageSizeChange}
                    onRowClick={onEdit} // Add row click handler
                />
            </div>
            <PlanPickerDialog
                isOpen={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                onSelect={(plan, serviceCategory, startDate) => {
                    const newContractLine: Omit<IClientContractLine, "client_contract_line_id" | "tenant"> = {
                        client_id: clientId,
                        contract_line_id: plan.contract_line_id!,
                        service_category: serviceCategory,
                        start_date: startDate,
                        end_date: null,
                        is_active: true
                    };
                    onAdd(newContractLine);
                }}
                availablePlans={contractLines}
                serviceCategories={serviceCategories}
            />
        </div>
    );
};

export default ContractLines;
