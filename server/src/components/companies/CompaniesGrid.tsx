import { ICompany } from 'server/src/interfaces/company.interfaces';
import CompanyGridCard from "./CompanyGridCard";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import CompaniesPagination from "./CompaniesPagination";
import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Button } from "@radix-ui/themes";

interface CompaniesGridProps {
    filteredCompanies: ICompany[];
    selectedCompanies: string[];
    handleCheckboxChange: (companyId: string) => void;
    handleEditCompany: (companyId: string) => void;
    handleDeleteCompany: (company: ICompany) => void; 
}

const CompaniesGrid = ({ filteredCompanies, selectedCompanies, handleCheckboxChange, handleEditCompany, handleDeleteCompany }: CompaniesGridProps) => {
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(9); // Show 9 cards per page
    
    // Calculate pagination indexes
    const lastItemIndex = currentPage * itemsPerPage;
    const firstItemIndex = lastItemIndex - itemsPerPage;
    const currentItems = filteredCompanies.slice(firstItemIndex, lastItemIndex);

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
    };

    const handleItemsPerPageChange = (items: number) => {
        setItemsPerPage(items);
        setCurrentPage(1); // Reset to first page when changing items per page
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {currentItems.map((company): JSX.Element => (
                    <div key={company.company_id} className="relative">
                        <CompanyGridCard
                            company={company}
                            selectedCompanies={selectedCompanies}
                            handleCheckboxChange={handleCheckboxChange}
                        />
                        <div className="absolute top-3 right-3">
                            <DropdownMenu.Root>
                                <DropdownMenu.Trigger asChild>
                                    <Button id={`company-menu-${company.company_id}`} variant="ghost" size="1" className="hover:bg-gray-50">
                                        <MoreVertical size={16} />
                                    </Button>
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Portal>
                                    <DropdownMenu.Content className="bg-white rounded-md shadow-lg p-1">
                                        <DropdownMenu.Item 
                                            className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 flex items-center"
                                            onSelect={() => handleEditCompany(company.company_id)}
                                        >
                                            <Pencil size={14} className="mr-2" />
                                            Edit
                                        </DropdownMenu.Item>
                                        <DropdownMenu.Item 
                                            className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 text-color-primary-500 hover:text-color-primary-600 flex items-center"
                                            onSelect={() => handleDeleteCompany(company)}
                                        >
                                            <Trash2 size={14} className="mr-2" />
                                            Delete
                                        </DropdownMenu.Item>
                                    </DropdownMenu.Content>
                                </DropdownMenu.Portal>
                            </DropdownMenu.Root>
                        </div>
                    </div>
                ))}
            </div>

            <CompaniesPagination 
                filteredCompanies={filteredCompanies}
                currentPage={currentPage}
                itemsPerPage={itemsPerPage}
                onPageChange={handlePageChange}
                onItemsPerPageChange={handleItemsPerPageChange}
            />
        </div>
    );
};

export default CompaniesGrid;
