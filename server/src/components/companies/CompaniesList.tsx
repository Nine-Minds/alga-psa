import React, { memo } from 'react';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { useRouter } from 'next/navigation';
import { MoreVertical, Pencil, Trash2, ExternalLink } from "lucide-react";
import { ReflectedDropdownMenu } from 'server/src/components/ui/ReflectedDropdownMenu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Button } from 'server/src/components/ui/Button';
import CompanyAvatar from 'server/src/components/ui/CompanyAvatar';
import { TagManager } from 'server/src/components/tags';
 import { useRegisterUIComponent } from 'server/src/types/ui-reflection/useRegisterUIComponent';
 import { useRegisterChild } from 'server/src/types/ui-reflection/useRegisterChild';
 import { FormFieldComponent, ButtonComponent } from 'server/src/types/ui-reflection/types';
 import { CommonActions } from 'server/src/types/ui-reflection/actionBuilders';


interface CompaniesListProps {
    selectedCompanies: string[];
    filteredCompanies: ICompany[];
    setSelectedCompanies: (companies: string[]) => void;
    handleCheckboxChange: (companyId: string) => void;
    handleEditCompany: (companyId: string) => void;
    handleDeleteCompany: (company: ICompany) => void;
    onQuickView?: (company: ICompany) => void;
    currentPage?: number;
    pageSize?: number;
    totalCount?: number;
    onPageChange?: (page: number) => void;
    companyTags?: Record<string, ITag[]>;
    allUniqueTags?: ITag[];
    onTagsChange?: (companyId: string, tags: ITag[]) => void;
    editingId?: string | null;
}

// Component for company selection checkbox
interface CompanyCheckboxProps {
  companyId: string;
  checked: boolean;
  onChange: () => void;
}

const CompanyCheckbox: React.FC<CompanyCheckboxProps> = ({ companyId, checked, onChange }) => {
  const checkboxId = `company-checkbox-${companyId}`;
  
   useRegisterChild<FormFieldComponent>({
     id: checkboxId,
     type: 'formField',
     label: 'Select Company',
     value: checked ? 'true' : 'false',
     fieldType: 'checkbox'
   });

  return (
    <input
      type="checkbox"
      data-automation-id={checkboxId}
      className="form-checkbox h-4 w-4 cursor-pointer"
      checked={checked}
      onChange={onChange}
    />
  );
};

// Component for company name link
interface CompanyLinkProps {
  company: ICompany;
  onClick: (e: React.MouseEvent) => void;
}

const CompanyLink: React.FC<CompanyLinkProps> = ({ company, onClick }) => {
  const linkId = `company-link-${company.company_id}`;
  
   useRegisterChild<ButtonComponent>({
     id: linkId,
     type: 'button',
     label: company.company_name,
     actions: [CommonActions.click('Click this button')]
   });

  return (
    <a
      data-automation-id={linkId}
      href={`/msp/companies/${company.company_id}`}
      onClick={onClick}
      className="text-blue-600 hover:underline font-medium truncate"
      title={company.company_name}
    >
      {company.company_name}
    </a>
  );
};

const CompaniesList = ({ 
  selectedCompanies, 
  filteredCompanies, 
  setSelectedCompanies, 
  handleCheckboxChange, 
  handleEditCompany, 
  handleDeleteCompany,
  onQuickView,
  currentPage,
  pageSize,
  totalCount,
  onPageChange,
  companyTags = {},
  allUniqueTags = [],
  onTagsChange,
  editingId
}: CompaniesListProps) => {
  const router = useRouter(); // Get router instance

  const handleRowClick = (company: ICompany) => {
    router.push(`/msp/companies/${company.company_id}`);
  };

    const columns: ColumnDefinition<ICompany>[] = [
        {
            title: '',
            dataIndex: 'checkbox',
            width: '5%',
            render: (value: string, record: ICompany) => (
                <div onClick={(e) => e.stopPropagation()} className="flex justify-center">
                  <CompanyCheckbox
                    companyId={record.company_id}
                    checked={selectedCompanies.includes(record.company_id)}
                    onChange={() => handleCheckboxChange(record.company_id)}
                  />
                </div>
            ),
        },
        {
            title: 'Name',
            dataIndex: 'company_name',
            width: '30%',
            render: (text: string, record: ICompany) => (
                <div className="flex items-center">
                    <CompanyAvatar
                        companyId={record.company_id}
                        companyName={record.company_name}
                        logoUrl={record.logoUrl ?? null}
                        size="sm"
                        className="mr-2 flex-shrink-0"
                    />
                    <CompanyLink
                      company={record}
                      onClick={(e) => e.stopPropagation()}
                    />
                </div>
            ),
        },
        {
            title: 'Type',
            dataIndex: 'client_type',
            width: '8%',
            render: (text: string | null, record: ICompany) => record.client_type || 'N/A',
        },
        {
            title: 'Phone',
            dataIndex: 'phone_no',
            width: '12%',
            render: (text: string | null, record: ICompany) => (record as any).location_phone || 'N/A',
        },
        {
            title: 'Address',
            dataIndex: 'address',
            width: '18%',
            render: (text: string | null, record: ICompany) => {
                const company = record as any;
                const addressParts = [
                    company.address_line1,
                    company.address_line2,
                    company.city,
                    company.state_province
                ].filter(Boolean);
                const fullAddress = addressParts.length > 0 ? addressParts.join(', ') : 'N/A';
                return <span className="truncate" title={fullAddress}>{fullAddress}</span>;
            },
        },
        {
            title: 'Account Manager',
            dataIndex: 'account_manager_full_name',
            width: '9%',
            render: (text: string | undefined, record: ICompany) =>
                <span className="truncate" title={record.account_manager_full_name ?? ''}>{record.account_manager_full_name || 'N/A'}</span>,
        },
        {
            title: 'URL',
            dataIndex: 'url',
            width: '10%',
            render: (text: string | null, record: ICompany) => (
                record.url && record.url.trim() !== '' ? (
                    <a href={record.url.startsWith('http') ? record.url : `https://${record.url}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block" title={record.url}>
                        {record.url}
                    </a>
                ) : 'N/A'
            ),
        },
        {
            title: 'Tags',
            dataIndex: 'tags',
            width: '20%',
            render: (value: string, record: ICompany) => {
                if (!record.company_id || !onTagsChange) return null;
                
                const initialTags = companyTags[record.company_id] || [];
                
                return (
                    <div onClick={(e) => e.stopPropagation()}>
                        <TagManager
                            entityId={record.company_id}
                            entityType="company"
                            initialTags={initialTags}
                            onTagsChange={(tags) => onTagsChange(record.company_id, tags)}
                        />
                    </div>
                );
            },
        },
        {
            title: 'Actions',
            dataIndex: 'actions',
            width: '5%',
            render: (value: string, record: ICompany) => (
                // Wrap DropdownMenu in a div and stop propagation on its click
                <div onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                            <Button
                                variant="ghost"
                                id="companies-actions-menu"
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
                                onSelect={() => handleEditCompany(record.company_id)}
                            >
                                <Pencil size={14} className="mr-2" />
                                Edit
                            </DropdownMenu.Item>
                            <DropdownMenu.Item 
                                className="px-2 py-1 text-sm cursor-pointer hover:bg-red-100 text-red-600 flex items-center rounded"
                                onSelect={() => handleDeleteCompany(record)}
                            >
                                <Trash2 size={14} className="mr-2" />
                                Delete
                            </DropdownMenu.Item>
                        </DropdownMenu.Content>
                    </DropdownMenu.Root>
                </div>
            ),
        },
    ];

    return (
        <div className="w-full">
            <DataTable
                id="companies-table"
                data={filteredCompanies}
                columns={columns}
                onRowClick={handleRowClick}
                pagination={true}
                currentPage={currentPage}
                pageSize={pageSize}
                totalItems={totalCount}
                onPageChange={onPageChange}
                rowClassName={(company: ICompany) => 
                    editingId === company.company_id ? 'bg-purple-50 border-l-4 border-l-purple-500' : ''
                }
            />
        </div>
    );
};

export default CompaniesList;
