import { ICompany } from 'server/src/interfaces/company.interfaces';
import CompanyGridCard from "./CompanyGridCard";
import Pagination from 'server/src/components/ui/Pagination';
import { useState } from 'react';

interface CompaniesGridProps {
    filteredCompanies: ICompany[];
    selectedCompanies: string[];
    handleCheckboxChange: (companyId: string) => void;
    handleEditCompany: (companyId: string) => void;
    handleDeleteCompany: (company: ICompany) => void;
}

type ItemsPerPage = 9 | 18 | 27 | 36;

const CompaniesGrid = ({ filteredCompanies, selectedCompanies, handleCheckboxChange, handleEditCompany, handleDeleteCompany }: CompaniesGridProps) => {
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState<ItemsPerPage>(9); // Show 9 cards per page
    
    // Calculate pagination indexes
    const lastItemIndex = currentPage * itemsPerPage;
    const firstItemIndex = lastItemIndex - itemsPerPage;
    const currentItems = filteredCompanies.slice(firstItemIndex, lastItemIndex);

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
    };

    const handleItemsPerPageChange = (items: number) => {
        setItemsPerPage(items as ItemsPerPage);
        setCurrentPage(1); // Reset to first page when changing items per page
    };

    const itemsPerPageOptions = [
        { value: '9', label: '9 cards/page' },
        { value: '18', label: '18 cards/page' },
        { value: '27', label: '27 cards/page' },
        { value: '36', label: '36 cards/page' }
    ];

    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {currentItems.map((company): JSX.Element => (
                    <div key={company.company_id} className="relative">
                        <CompanyGridCard
                            company={company}
                            selectedCompanies={selectedCompanies}
                            handleCheckboxChange={handleCheckboxChange}
                            handleEditCompany={handleEditCompany}
                            handleDeleteCompany={handleDeleteCompany}
                        />
                    </div>
                ))}
            </div>

            <Pagination
                id="companies-pagination"
                totalItems={filteredCompanies.length}
                itemsPerPage={itemsPerPage}
                currentPage={currentPage}
                onPageChange={handlePageChange}
                onItemsPerPageChange={handleItemsPerPageChange}
                variant="companies"
                itemLabel="companies"
                itemsPerPageOptions={itemsPerPageOptions}
            />
        </div>
    );
};

export default CompaniesGrid;
