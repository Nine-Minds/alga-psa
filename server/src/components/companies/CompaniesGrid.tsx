import { ICompany } from 'server/src/interfaces/company.interfaces';
import CompanyGridCard from "./CompanyGridCard";
import CompaniesPagination from "./CompaniesPagination";
import { useState } from 'react';

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
                            handleEditCompany={handleEditCompany}
                            handleDeleteCompany={handleDeleteCompany}
                        />
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
