import React, { useState } from 'react';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { Button } from '@radix-ui/themes';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IService, IServiceCategory } from '../../interfaces/billing.interfaces';
import { Input } from 'server/src/components/ui/Input';
import { Pencil, Trash2, Check, X } from 'lucide-react';

interface ServiceCatalogProps {
    services: IService[];
    serviceCategories: IServiceCategory[];
    onEdit: (service: IService) => void;
    onDelete: (serviceId: string) => void;
    onAdd: () => void;
}

const ServiceCatalog: React.FC<ServiceCatalogProps> = ({
    services,
    serviceCategories,
    onEdit,
    onDelete,
    onAdd
}) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState<string>('');
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [serviceToDelete, setServiceToDelete] = useState<string | null>(null);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    // Handle page size change - reset to page 1
    const handlePageSizeChange = (newPageSize: number) => {
        setPageSize(newPageSize);
        setCurrentPage(1);
    };

    const handleStartEdit = (service: IService) => {
        setEditingId(service.service_id);
        setEditingName(service.service_name);
    };

    const handleSaveEdit = (service: IService) => {
        onEdit({
            ...service,
            service_name: editingName
        });
        setEditingId(null);
        setEditingName('');
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditingName('');
    };

    const columns: ColumnDefinition<IService>[] = [
        {
            title: 'Service Name',
            dataIndex: 'service_name',
            render: (value, record) => {
                if (editingId === record.service_id) {
                    return (
                        <div className="w-full max-w-md">
                            <Input
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                className="w-full"
                                autoFocus
                            />
                        </div>
                    );
                }
                return <span className="text-[rgb(var(--color-text-700))]">{value}</span>;
            },
        },
        {
            title: 'Default Rate',
            dataIndex: 'default_rate',
            render: (value) => (
                <span className="text-[rgb(var(--color-text-700))]">
                    ${typeof value === 'number' ? value.toFixed(2) : value}
                </span>
            ),
        },
        {
            title: 'Unit of Measure',
            dataIndex: 'unit_of_measure',
            render: (value) => (
                <span className="text-[rgb(var(--color-text-700))] capitalize">
                    {value}
                </span>
            ),
        },
        {
            title: 'Category',
            dataIndex: 'category_id',
            render: (value, record) => (
                <span className="text-[rgb(var(--color-text-700))]">
                    {serviceCategories.find(cat => cat.category_id === value)?.category_name}
                </span>
            ),
        },
        {
            title: 'Actions',
            dataIndex: 'service_id',
            width: '10%',
            render: (value, record) => (
                <div className="flex items-center space-x-2">
                    {editingId === record.service_id ? (
                        <>
                            <Button
                                id={`save-service-${record.service_id}`}
                                variant="ghost" 
                                size="1" 
                                onClick={() => handleSaveEdit(record)}
                                className="hover:bg-[rgb(var(--color-primary-50))]"
                            >
                                <Check className="h-4 w-4 text-[rgb(var(--color-primary-600))]" />
                            </Button>
                            <Button 
                                id={`cancel-edit-service-${record.service_id}`}
                                variant="ghost" 
                                size="1" 
                                onClick={handleCancelEdit}
                                className="hover:bg-[rgb(var(--color-accent-50))]"
                            >
                                <X className="h-4 w-4 text-[rgb(var(--color-accent-600))]" />
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button 
                                id={`edit-service-${record.service_id}`}
                                variant="ghost" 
                                size="1" 
                                onClick={() => handleStartEdit(record)}
                                className="hover:bg-[rgb(var(--color-border-100))]"
                            >
                                <Pencil className="h-4 w-4 text-[rgb(var(--color-text-600))]" />
                            </Button>
                            <Button 
                                id={`delete-service-${record.service_id}`}
                                variant="ghost" 
                                size="1" 
                                onClick={() => {
                                  setServiceToDelete(value!);
                                  setShowDeleteDialog(true);
                                }}
                                className="hover:bg-[rgb(var(--color-accent-50))]"
                            >
                                <Trash2 className="h-4 w-4 text-[rgb(var(--color-accent-600))]" />
                            </Button>
                        </>
                    )}
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">
                    Service Catalog
                </h3>
                <Button 
                    id="add-new-service-button"
                    onClick={onAdd} 
                    size="2"
                    className="bg-[rgb(var(--color-primary-500))] hover:bg-[rgb(var(--color-primary-600))]"
                >
                    Add New Service
                </Button>
            </div>
            <div className="rounded-lg border border-[rgb(var(--color-border-200))]">
                <DataTable
                    id="client-service-catalog-table"
                    data={services}
                    columns={columns}
                    pagination={true}
                    currentPage={currentPage}
                    onPageChange={setCurrentPage}
                    pageSize={pageSize}
                    onItemsPerPageChange={handlePageSizeChange}
                />
            </div>
            <ConfirmationDialog
              isOpen={showDeleteDialog}
              onClose={() => setShowDeleteDialog(false)}
              onConfirm={() => {
                if (serviceToDelete) {
                  onDelete(serviceToDelete);
                  setShowDeleteDialog(false);
                  setServiceToDelete(null);
                }
              }}
              title="Delete Service"
              message="Are you sure you want to delete this service? This action cannot be undone."
              confirmLabel="Delete"
            />
        </div>
    );
};

export default ServiceCatalog;
