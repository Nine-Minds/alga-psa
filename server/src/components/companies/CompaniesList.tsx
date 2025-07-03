import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useDrawer } from 'server/src/context/DrawerContext';
import CompanyDetails from './CompanyDetails';
import { ReflectedDropdownMenu } from 'server/src/components/ui/ReflectedDropdownMenu';
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
    currentPage?: number;
    pageSize?: number;
    totalCount?: number;
    onPageChange?: (page: number) => void;
    companyTags?: Record<string, ITag[]>;
    allUniqueTags?: string[];
    onTagsChange?: (companyId: string, tags: ITag[]) => void;
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
      href="#"
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
  currentPage,
  pageSize,
  totalCount,
  onPageChange,
  companyTags = {},
  allUniqueTags = [],
  onTagsChange
}: CompaniesListProps) => {
  const { openDrawer } = useDrawer();

  const handleRowClick = (company: ICompany) => {
    openDrawer(
      <CompanyDetails
        company={company}
        documents={[]}
        contacts={[]}
        isInDrawer={true}
      />
    );
  };

    const columns: ColumnDefinition<ICompany>[] = [
        {
            title: '',
            dataIndex: 'checkbox',
            width: '4%',
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
            render: (text: string | null, record: ICompany) => record.phone_no || 'N/A',
        },
        {
            title: 'Address',
            dataIndex: 'address',
            width: '18%',
            render: (text: string | null, record: ICompany) => <span className="truncate" title={record.address ?? ''}>{record.address || 'N/A'}</span>,
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
                
                return (
                    <div onClick={(e) => e.stopPropagation()}>
                        <TagManager
                            entityId={record.company_id}
                            entityType="company"
                            initialTags={companyTags[record.company_id] || []}
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
                    <ReflectedDropdownMenu
                        id={`company-list-actions-${record.company_id}`}
                        triggerLabel="Company Actions"
                        trigger={
                            <Button
                                id={`company-actions-trigger-${record.company_id}`}
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                            >
                                <span className="sr-only">Open menu</span>
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        }
                        items={[
                            {
                                id: 'edit',
                                text: 'Edit',
                                icon: <Pencil size={14} />,
                                variant: 'default',
                                onSelect: () => handleEditCompany(record.company_id)
                            },
                            {
                                id: 'delete',
                                text: 'Delete',
                                icon: <Trash2 size={14} />,
                                variant: 'destructive',
                                onSelect: () => handleDeleteCompany(record)
                            }
                        ]}
                        contentProps={{
                            align: "end",
                            className: "bg-white z-50"
                        }}
                    />
                </div>
            ),
        },
    ];

    return (
        <div className="w-full">
            <DataTable
                id="companies-table"
                data={filteredCompanies.map((company): ICompany => ({
                    ...company,
                    company_id: company.company_id
                }))}
                columns={columns}
                onRowClick={handleRowClick} // Use the original onRowClick signature
                pagination={true}
                currentPage={currentPage}
                pageSize={pageSize}
                totalItems={totalCount}
                onPageChange={onPageChange}
            />
        </div>
    );
};

export default CompaniesList;
