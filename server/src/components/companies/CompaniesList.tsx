import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { useRouter } from 'next/navigation';
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from 'server/src/components/ui/DropdownMenu';
import { Button } from 'server/src/components/ui/Button';
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
                // Wrap DropdownMenu in a div and stop propagation on its click
                <div onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                id={`company-actions-${record.company_id}`}
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                            >
                                <span className="sr-only">Open menu</span>
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-white z-50">
                            <DropdownMenuItem
                                className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
                                onSelect={() => handleEditCompany(record.company_id)}
                            >
                                <Pencil size={14} className="mr-2" />
                                Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 text-red-600 flex items-center"
                                onSelect={() => handleDeleteCompany(record)}
                            >
                                <Trash2 size={14} className="mr-2" />
                                Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
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
                onRowClick={handleRowClick} // Use the original onRowClick signature
            />
        </div>
    );
};

export default CompaniesList;
