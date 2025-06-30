import { ICompany } from 'server/src/interfaces/company.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import CompanyGridCard from "./CompanyGridCard";
import Pagination from 'server/src/components/ui/Pagination';
import { useState } from 'react';

interface CompaniesGridProps {
    filteredCompanies: ICompany[];
    selectedCompanies: string[];
    handleCheckboxChange: (companyId: string) => void;
    handleEditCompany: (companyId: string) => void;
    handleDeleteCompany: (company: ICompany) => void;
    currentPage: number;
    pageSize: number;
    totalCount: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    companyTags?: Record<string, ITag[]>;
    allUniqueTags?: string[];
    onTagsChange?: (companyId: string, tags: ITag[]) => void;
}

type ItemsPerPage = 9 | 18 | 27 | 36;

const CompaniesGrid = ({ 
    filteredCompanies, 
    selectedCompanies, 
    handleCheckboxChange, 
    handleEditCompany, 
    handleDeleteCompany,
    currentPage,
    pageSize,
    totalCount,
    onPageChange,
    onPageSizeChange,
    companyTags = {},
    allUniqueTags = [],
    onTagsChange
}: CompaniesGridProps) => {
    
    const itemsPerPageOptions = [
        { value: '9', label: '9 cards/page' },
        { value: '18', label: '18 cards/page' },
        { value: '27', label: '27 cards/page' },
        { value: '36', label: '36 cards/page' }
    ];

    return (
        <div className="flex flex-col gap-6">
            <Pagination
                id="companies-pagination-top"
                totalItems={totalCount}
                itemsPerPage={pageSize as ItemsPerPage}
                currentPage={currentPage}
                onPageChange={onPageChange}
                onItemsPerPageChange={onPageSizeChange}
                variant="companies"
                itemLabel="companies"
                itemsPerPageOptions={itemsPerPageOptions}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredCompanies.map((company): JSX.Element => (
                    <div key={company.company_id} className="relative">
                        <CompanyGridCard
                            company={company}
                            selectedCompanies={selectedCompanies}
                            handleCheckboxChange={handleCheckboxChange}
                            handleEditCompany={handleEditCompany}
                            handleDeleteCompany={handleDeleteCompany}
                            tags={companyTags[company.company_id] || []}
                            allUniqueTags={allUniqueTags}
                            onTagsChange={onTagsChange}
                        />
                    </div>
                ))}
            </div>

            <Pagination
                id="companies-pagination"
                totalItems={totalCount}
                itemsPerPage={pageSize as ItemsPerPage}
                currentPage={currentPage}
                onPageChange={onPageChange}
                onItemsPerPageChange={onPageSizeChange}
                variant="companies"
                itemLabel="companies"
                itemsPerPageOptions={itemsPerPageOptions}
            />
        </div>
    );
};

export default CompaniesGrid;
