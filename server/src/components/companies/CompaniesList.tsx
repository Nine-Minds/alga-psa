import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { useRouter } from 'next/navigation';
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Button } from "@radix-ui/themes";
import CompanyAvatar from 'server/src/components/ui/CompanyAvatar';
interface CompaniesListProps {
    selectedCompanies: string[];
    filteredCompanies: ICompany[];
    setSelectedCompanies: (companies: string[]) => void;
    handleCheckboxChange: (companyId: string) => void;
    handleEditCompany: (companyId: string) => void;
    handleDeleteCompany: (company: ICompany) => void;
}

const CompaniesList = ({ selectedCompanies, filteredCompanies, setSelectedCompanies, handleCheckboxChange, handleEditCompany, handleDeleteCompany }: CompaniesListProps) => {
  const router = useRouter(); // Get router instance

  const handleRowClick = (company: ICompany) => {
    router.push(`/msp/companies/${company.company_id}`);
  };

    const columns: ColumnDefinition<ICompany>[] = [
        {
            title: '',
            dataIndex: 'checkbox',
            width: '4%',
            render: (value: string, record: ICompany) => (
                <div onClick={(e) => e.stopPropagation()} className="flex justify-center">
                  <input
                      type="checkbox"
                      className="form-checkbox h-4 w-4 cursor-pointer"
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
                    <a
                      href={`/msp/companies/${record.company_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-600 hover:underline font-medium truncate"
                      title={record.company_name}
                    >
                        {record.company_name}
                    </a>
                </div>
            ),
        },
        {
            title: 'Type',
            dataIndex: 'client_type',
            width: '10%',
            render: (text: string | null, record: ICompany) => record.client_type || 'N/A',
        },
        {
            title: 'Phone',
            dataIndex: 'phone_no',
            width: '15%',
            render: (text: string | null, record: ICompany) => record.phone_no || 'N/A',
        },
        {
            title: 'Address',
            dataIndex: 'address',
            width: '20%',
            render: (text: string | null, record: ICompany) => <span className="truncate" title={record.address ?? ''}>{record.address || 'N/A'}</span>,
        },
        {
            title: 'Account Manager',
            dataIndex: 'account_manager_full_name',
            width: '10%',
            render: (text: string | undefined, record: ICompany) =>
                <span className="truncate" title={record.account_manager_full_name ?? ''}>{record.account_manager_full_name || 'N/A'}</span>,
        },
        {
            title: 'URL',
            dataIndex: 'url',
            width: '12%',
            render: (text: string | null, record: ICompany) => (
                record.url && record.url.trim() !== '' ? (
                    <a href={record.url.startsWith('http') ? record.url : `https://${record.url}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block" title={record.url}>
                        {record.url}
                    </a>
                ) : 'N/A'
            ),
        },
        {
            title: 'Actions',
            dataIndex: 'actions',
            width: '5%',
            render: (value: string, record: ICompany) => (
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                        <div
                            role="button"
                            tabIndex={0}
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 w-9 p-0"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <MoreVertical size={16} />
                        </div>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content className="bg-white rounded-md shadow-lg p-1">
                        <DropdownMenu.Item 
                            className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
                            onSelect={() => handleEditCompany(record.company_id)}
                        >
                            <Pencil size={14} className="mr-2" />
                            Edit
                        </DropdownMenu.Item>
                        <DropdownMenu.Item 
                            className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 text-red-600 flex items-center"
                            onSelect={() => handleDeleteCompany(record)}
                        >
                            <Trash2 size={14} className="mr-2" />
                            Delete
                        </DropdownMenu.Item>
                    </DropdownMenu.Content>
                </DropdownMenu.Root>
            ),
        },
    ];

    return (
        <div className="w-full">
            <DataTable
                data={filteredCompanies.map((company): ICompany => ({
                    ...company,
                    company_id: company.company_id
                }))}
                columns={columns}
                onRowClick={handleRowClick}
            />
        </div>
    );
};

export default CompaniesList;
