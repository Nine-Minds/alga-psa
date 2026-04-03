import React, { memo } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import type { IClient } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { useRouter } from 'next/navigation';
import { MoreVertical, Pencil, Trash2, ExternalLink, Shield, ShieldOff } from "lucide-react";
import { ReflectedDropdownMenu } from '@alga-psa/ui/components/ReflectedDropdownMenu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import ClientAvatar from '@alga-psa/ui/components/ClientAvatar';
import { TagManager } from '@alga-psa/tags/components';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
 import { useRegisterUIComponent } from '@alga-psa/ui/ui-reflection/useRegisterUIComponent';
 import { useRegisterChild } from '@alga-psa/ui/ui-reflection/useRegisterChild';
 import { FormFieldComponent, ButtonComponent } from '@alga-psa/ui/ui-reflection/types';
 import { CommonActions } from '@alga-psa/ui/ui-reflection/actionBuilders';
 import { useTranslation } from '@alga-psa/ui/lib/i18n/client';


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
  const { t } = useTranslation('msp/clients');

  // Register as a child of the table for bulk actions to work properly
  useRegisterChild<FormFieldComponent>({
    id: checkboxId,
    type: 'formField',
    label: t('clientsList.selectClient', { defaultValue: 'Select Client' }),
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
  const { t } = useTranslation('msp/clients');
  const isDefault = (client as any).is_default;

   useRegisterChild<ButtonComponent>({
     id: linkId,
     type: 'button',
     label: client.client_name,
     actions: [CommonActions.click(t('clientsList.clickThisButton', { defaultValue: 'Click this button' }))]
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
        <div className="inline-flex items-center px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40" title={t('clientsList.defaultClient', { defaultValue: 'Default Client' })}>
          <Shield className="h-3 w-3 text-purple-600 dark:text-purple-400 mr-1" />
          <span className="text-xs text-purple-700 dark:text-purple-300 font-medium">{t('clientsList.default', { defaultValue: 'Default' })}</span>
        </div>
      )}
      {client.is_tax_exempt && (
        <Tooltip content={t('clientsList.taxExemptTooltip', { defaultValue: 'This client is tax exempt - no taxes will be applied to their invoices' })}>
          <div className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40">
            <ShieldOff className="h-3 w-3 text-amber-600 dark:text-amber-400 mr-1" />
            <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">{t('clientsList.taxExempt', { defaultValue: 'Tax Exempt' })}</span>
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
  const { t } = useTranslation('msp/clients');


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
            title: t('clientsList.name', { defaultValue: 'Name' }),
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
            title: t('clientsList.created', { defaultValue: 'Created' }),
            dataIndex: 'created_at',
            width: '12%',
            render: (text: string | null, record: IClient) => {
                if (!record.created_at) return t('common.states.na', { defaultValue: 'N/A' });
                const date = new Date(record.created_at);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            },
        },
        {
            title: t('clientsList.type', { defaultValue: 'Type' }),
            dataIndex: 'client_type',
            width: '8%',
            render: (text: string | null, record: IClient) => record.client_type || t('common.states.na', { defaultValue: 'N/A' }),
        },
        {
            title: t('clientsList.phone', { defaultValue: 'Phone' }),
            dataIndex: 'phone_no',
            width: '10%',
            render: (text: string | null, record: IClient) => (record as any).location_phone || t('common.states.na', { defaultValue: 'N/A' }),
        },
        {
            title: t('clientsList.address', { defaultValue: 'Address' }),
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
                const fullAddress = addressParts.length > 0 ? addressParts.join(', ') : t('common.states.na', { defaultValue: 'N/A' });
                return <span className="break-words" title={fullAddress}>{fullAddress}</span>;
            },
        },
        {
            title: t('clientsList.accountManager', { defaultValue: 'Account Manager' }),
            dataIndex: 'account_manager_full_name',
            width: '8%',
            render: (text: string | undefined, record: IClient) =>
                <span className="break-words" title={record.account_manager_full_name ?? ''}>{record.account_manager_full_name || t('common.states.na', { defaultValue: 'N/A' })}</span>,
        },
        {
            title: t('clientsList.url', { defaultValue: 'URL' }),
            dataIndex: 'url',
            width: '8%',
            render: (text: string | null, record: IClient) => (
                record.url && record.url.trim() !== '' ? (
                    <a href={record.url.startsWith('http') ? record.url : `https://${record.url}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline whitespace-normal break-words block" title={record.url}>
                        {record.url}
                    </a>
                ) : t('common.states.na', { defaultValue: 'N/A' })
            ),
        },
        {
            title: t('clientsList.tags', { defaultValue: 'Tags' }),
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
            title: t('clientsList.actions', { defaultValue: 'Actions' }),
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
                                <span className="sr-only">{t('clientsList.openMenu', { defaultValue: 'Open menu' })}</span>
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
                                    {t('clientsList.quickView', { defaultValue: 'Quick View' })}
                                </DropdownMenu.Item>
                            )}
                            <DropdownMenu.Item 
                                className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center rounded"
                                onSelect={() => handleEditClient(record.client_id)}
                            >
                                <Pencil size={14} className="mr-2" />
                                {t('common.actions.edit', { defaultValue: 'Edit' })}
                            </DropdownMenu.Item>
                            {!(record as any).is_default && (
                                <DropdownMenu.Item 
                                    className="px-2 py-1 text-sm cursor-pointer hover:bg-red-100 dark:hover:bg-red-950/50 text-red-600 dark:text-red-400 flex items-center rounded"
                                    onSelect={() => handleDeleteClient(record)}
                                >
                                    <Trash2 size={14} className="mr-2" />
                                    {t('common.actions.delete', { defaultValue: 'Delete' })}
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
                rowClassName={(record: IClient) =>
                  record.client_id && selectedClients.includes(record.client_id) ? 'bg-table-selected' : ''
                }
                manualSorting={true}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSortChange={onSortChange}
            />
        </div>
    );
};

export default ClientsList;
