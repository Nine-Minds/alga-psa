import React, { memo } from 'react';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { useRouter } from 'next/navigation';
import { MoreVertical, Pencil, Trash2, ExternalLink, Shield, ShieldOff } from "lucide-react";
import { ReflectedDropdownMenu } from 'server/src/components/ui/ReflectedDropdownMenu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Button } from 'server/src/components/ui/Button';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import ClientAvatar from 'server/src/components/ui/ClientAvatar';
import { TagManager } from 'server/src/components/tags';
import { Tooltip } from 'server/src/components/ui/Tooltip';
 import { useRegisterUIComponent } from 'server/src/types/ui-reflection/useRegisterUIComponent';
 import { useRegisterChild } from 'server/src/types/ui-reflection/useRegisterChild';
 import { FormFieldComponent, ButtonComponent } from 'server/src/types/ui-reflection/types';
 import { CommonActions } from 'server/src/types/ui-reflection/actionBuilders';


interface ClientsListProps {
    selectedClients: string[];
    filteredClients: IClient[];
    setSelectedClients: (clients: string[]) => void;
    handleCheckboxChange: (clientId: string) => void;
    handleEditClient: (clientId: string) => void;
    handleDeleteClient: (client: IClient) => void;
    onQuickView?: (client: IClient) => void;
    currentPage?: number;
    pageSize?: number;
    totalCount?: number;
    onPageChange?: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
    clientTags?: Record<string, ITag[]>;
    allUniqueTags?: ITag[];
    onTagsChange?: (clientId: string, tags: ITag[]) => void;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
    onSortChange?: (sortBy: string, sortDirection: 'asc' | 'desc') => void;
}

// Component for client selection checkbox
interface ClientCheckboxProps {
  clientId: string;
  checked: boolean;
  onChange: () => void;
}

const ClientCheckbox: React.FC<ClientCheckboxProps> = ({ clientId, checked, onChange }) => {
  const checkboxId = `client-checkbox-${clientId}`;

  // Register as a child of the table for bulk actions to work properly
  useRegisterChild<FormFieldComponent>({
    id: checkboxId,
    type: 'formField',
    label: 'Select Client',
    value: checked ? 'true' : 'false',
    fieldType: 'checkbox'
  });

  return (
    <div className="[&>div]:mb-0">
      <Checkbox
        id={checkboxId}
        checked={checked}
        onChange={onChange}
        className="cursor-pointer"
        skipRegistration={true}  // We handle registration above with useRegisterChild
      />
    </div>
  );
};

// Component for client name link
interface ClientLinkProps {
  client: IClient;
  onClick: (e: React.MouseEvent) => void;
}

const ClientLink: React.FC<ClientLinkProps> = ({ client, onClick }) => {
  const linkId = `client-link-${client.client_id}`;
  const isDefault = (client as any).is_default;

   useRegisterChild<ButtonComponent>({
     id: linkId,
     type: 'button',
     label: client.client_name,
     actions: [CommonActions.click('Click this button')]
   });

  return (
    <div className="flex items-center gap-2">
      <a
        data-automation-id={linkId}
        href={`/msp/clients/${client.client_id}`}
        onClick={onClick}
        className="text-blue-600 hover:underline font-medium whitespace-normal break-words"
        title={client.client_name}
      >
        {client.client_name}
      </a>
      {isDefault && (
        <div className="inline-flex items-center px-2 py-0.5 rounded-full bg-purple-100" title="Default Client">
          <Shield className="h-3 w-3 text-purple-600 mr-1" />
          <span className="text-xs text-purple-700 font-medium">Default</span>
        </div>
      )}
      {client.is_tax_exempt && (
        <Tooltip content="This client is tax exempt - no taxes will be applied to their invoices">
          <div className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100">
            <ShieldOff className="h-3 w-3 text-amber-600 mr-1" />
            <span className="text-xs text-amber-700 font-medium">Tax Exempt</span>
          </div>
        </Tooltip>
      )}
    </div>
  );
};

const ClientsList = ({
  selectedClients,
  filteredClients,
  setSelectedClients,
  handleCheckboxChange,
  handleEditClient,
  handleDeleteClient,
  onQuickView,
  currentPage,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  clientTags = {},
  allUniqueTags = [],
  onTagsChange,
  sortBy,
  sortDirection,
  onSortChange
}: ClientsListProps) => {
  const router = useRouter(); // Get router instance


  const handleRowClick = (client: IClient) => {
    router.push(`/msp/clients/${client.client_id}`);
  };

    const columns: ColumnDefinition<IClient>[] = [
        {
            title: '',
            dataIndex: 'checkbox',
            width: '5%',
            render: (value: string, record: IClient) => (
                <div onClick={(e) => e.stopPropagation()} className="flex justify-center">
                  <ClientCheckbox
                    clientId={record.client_id}
                    checked={selectedClients.includes(record.client_id)}
                    onChange={() => handleCheckboxChange(record.client_id)}
                  />
                </div>
            ),
        },
        {
            title: 'Name',
            dataIndex: 'client_name',
            width: '22%',
            render: (text: string, record: IClient) => (
                <div className="flex items-center">
                    <ClientAvatar
                        clientId={record.client_id}
                        clientName={record.client_name}
                        logoUrl={record.logoUrl ?? null}
                        size="sm"
                        className="mr-2 flex-shrink-0"
                    />
                    <ClientLink
                      client={record}
                      onClick={(e) => e.stopPropagation()}
                    />
                </div>
            ),
        },
        {
            title: 'Created',
            dataIndex: 'created_at',
            width: '12%',
            render: (text: string | null, record: IClient) => {
                if (!record.created_at) return 'N/A';
                const date = new Date(record.created_at);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            },
        },
        {
            title: 'Type',
            dataIndex: 'client_type',
            width: '8%',
            render: (text: string | null, record: IClient) => record.client_type || 'N/A',
        },
        {
            title: 'Phone',
            dataIndex: 'phone_no',
            width: '10%',
            render: (text: string | null, record: IClient) => (record as any).location_phone || 'N/A',
        },
        {
            title: 'Address',
            dataIndex: 'address',
            width: '15%',
            render: (text: string | null, record: IClient) => {
                const client = record as any;
                const addressParts = [
                    client.address_line1,
                    client.address_line2,
                    client.city,
                    client.state_province
                ].filter(Boolean);
                const fullAddress = addressParts.length > 0 ? addressParts.join(', ') : 'N/A';
                return <span className="break-words" title={fullAddress}>{fullAddress}</span>;
            },
        },
        {
            title: 'Account Manager',
            dataIndex: 'account_manager_full_name',
            width: '8%',
            render: (text: string | undefined, record: IClient) =>
                <span className="break-words" title={record.account_manager_full_name ?? ''}>{record.account_manager_full_name || 'N/A'}</span>,
        },
        {
            title: 'URL',
            dataIndex: 'url',
            width: '8%',
            render: (text: string | null, record: IClient) => (
                record.url && record.url.trim() !== '' ? (
                    <a href={record.url.startsWith('http') ? record.url : `https://${record.url}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline whitespace-normal break-words block" title={record.url}>
                        {record.url}
                    </a>
                ) : 'N/A'
            ),
        },
        {
            title: 'Tags',
            dataIndex: 'tags',
            width: '17%',
            render: (value: string, record: IClient) => {
                if (!record.client_id || !onTagsChange) return null;
                
                const initialTags = clientTags[record.client_id] || [];
                
                return (
                    <div onClick={(e) => e.stopPropagation()}>
                        <TagManager
                            entityId={record.client_id}
                            entityType="client"
                            initialTags={initialTags}
                            onTagsChange={(tags) => onTagsChange(record.client_id, tags)}
                        />
                    </div>
                );
            },
        },
        {
            title: 'Actions',
            dataIndex: 'actions',
            width: '5%',
            render: (value: string, record: IClient) => (
                // Wrap DropdownMenu in a div and stop propagation on its click
                <div onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                            <Button
                                variant="ghost"
                                id="clients-actions-menu"
                                size="sm"
                                className="h-8 w-8 p-0"
                            >
                                <span className="sr-only">Open menu</span>
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content 
                            align="end" 
                            className="bg-white rounded-md shadow-lg p-1 border border-gray-200 min-w-[120px] z-50"
                        >
                            {onQuickView && (
                                <DropdownMenu.Item 
                                    className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center rounded"
                                    onSelect={() => onQuickView(record)}
                                >
                                    <ExternalLink size={14} className="mr-2" />
                                    Quick View
                                </DropdownMenu.Item>
                            )}
                            <DropdownMenu.Item 
                                className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center rounded"
                                onSelect={() => handleEditClient(record.client_id)}
                            >
                                <Pencil size={14} className="mr-2" />
                                Edit
                            </DropdownMenu.Item>
                            {!(record as any).is_default && (
                                <DropdownMenu.Item 
                                    className="px-2 py-1 text-sm cursor-pointer hover:bg-red-100 text-red-600 flex items-center rounded"
                                    onSelect={() => handleDeleteClient(record)}
                                >
                                    <Trash2 size={14} className="mr-2" />
                                    Delete
                                </DropdownMenu.Item>
                            )}
                        </DropdownMenu.Content>
                    </DropdownMenu.Root>
                </div>
            ),
        },
    ];

    return (
        <div className="w-full">
            <DataTable
                key={`${currentPage}-${pageSize}`}
                id="clients-table"
                data={filteredClients}
                columns={columns}
                onRowClick={handleRowClick}
                pagination={true}
                currentPage={currentPage}
                pageSize={pageSize}
                totalItems={totalCount}
                onPageChange={onPageChange}
                onItemsPerPageChange={onPageSizeChange}
                rowClassName={() => ''}
                manualSorting={true}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSortChange={onSortChange}
            />
        </div>
    );
};

export default ClientsList;
