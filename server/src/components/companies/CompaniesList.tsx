import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import Link from "next/link";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Button } from "@radix-ui/themes";

interface CompaniesListProps {
    selectedCompanies: string[];
    filteredCompanies: ICompany[];
    setSelectedCompanies: (companies: string[]) => void;
    handleCheckboxChange: (companyId: string) => void;
    handleEditCompany: (companyId: string) => void;
    handleDeleteCompany: (company: ICompany) => void;
}

const CompaniesList = ({ selectedCompanies, filteredCompanies, setSelectedCompanies, handleCheckboxChange, handleEditCompany, handleDeleteCompany }: CompaniesListProps) => {
    const columns: ColumnDefinition<ICompany>[] = [
        {
            title: '',
            dataIndex: 'checkbox',
            render: (value: string, record: ICompany) => (
                <input
                    type="checkbox"
                    className="form-checkbox h-4 w-4"
                    checked={selectedCompanies.includes(record.company_id)}
                    onChange={() => handleCheckboxChange(record.company_id)}
                />
            ),
        },
        {
            title: 'Name',
            dataIndex: 'company_name',
            render: (text: string, record: ICompany) => (
                <Link href={`/msp/companies/${record.company_id}`} className="text-blue-600">
                    {record.company_name}
                </Link>
            ),
        },
        {
            title: 'Client Type',
            dataIndex: 'client_type',
            render: (text: string | null, record: ICompany) => record.client_type || 'N/A',
        },
        {
            title: 'Phone',
            dataIndex: 'phone_no',
            render: (text: string | null, record: ICompany) => record.phone_no || 'N/A',
        },
        {
            title: 'Address',
            dataIndex: 'address',
            render: (text: string | null, record: ICompany) => record.address || 'N/A',
        },
        {
            title: 'Account Owner',
            dataIndex: ['properties', 'account_manager_name'],
            render: (text: string | undefined, record: ICompany) => 
                record.properties?.account_manager_name || 'N/A',
        },
        {
            title: 'Url',
            dataIndex: 'url',
            render: (text: string | null, record: ICompany) => (
                record.url && record.url.trim() !== '' ? (
                    <a href={record.url} target="_blank" rel="noopener noreferrer" className="text-blue-600">
                        {record.url}
                    </a>
                ) : 'N/A'
            ),
        },
        {
            title: 'Actions',
            dataIndex: 'actions',
            render: (value: string, record: ICompany) => (
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                        <div
                            role="button"
                            tabIndex={0}
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-9 w-9 p-0"
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
            />
        </div>
    );
};

export default CompaniesList;
