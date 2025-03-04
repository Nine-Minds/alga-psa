"use client";
import { CaretLeftIcon, CaretRightIcon } from '@radix-ui/react-icons';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import CustomSelect from 'server/src/components/ui/CustomSelect';

interface CompaniesPaginationProps {
    filteredCompanies: ICompany[];
    currentPage: number;
    itemsPerPage: number;
    onPageChange: (page: number) => void;
    onItemsPerPageChange: (items: number) => void;
}

type ItemsPerPage = 9 | 18 | 27 | 36;

const CompaniesPagination = ({ 
    filteredCompanies, 
    currentPage, 
    itemsPerPage, 
    onPageChange, 
    onItemsPerPageChange 
}: CompaniesPaginationProps) => {
    const totalPages = Math.ceil(filteredCompanies.length / itemsPerPage);
    
    const handlePageNumberClick = (pageNumber: number) => {
        onPageChange(pageNumber);
    }

    const ListPageButtons = () => {
        const buttons = [];
        for (let i = 1; i <= totalPages; i++) {
            if ((i >= 1 && i <= 3) || (i === totalPages)) {
                buttons.push(
                    <button
                        key={i}
                        onClick={() => handlePageNumberClick(i)}
                        className={`${currentPage === i ? "border-blue-600 text-blue-600" : "border-gray-300 text-gray-500 hover:bg-gray-50"} px-2 py-1 border text-sm font-medium rounded`}
                    >
                        {i}
                    </button>
                );
            } else if (i === 4 && i < totalPages) {
                buttons.push(<span key={i} className="border border-gray-300 px-2 py-1 text-sm font-medium text-gray-700 rounded">...</span>);
            }
        }
        return buttons;
    }

    const handleArrowClick = (arrowType: 'left' | 'right') => {
        if (arrowType === 'left' && currentPage > 1) {
            onPageChange(currentPage - 1);
        } else if (arrowType === 'right' && currentPage < totalPages) {
            onPageChange(currentPage + 1);
        }
    }

    const firstItemIndex = (currentPage - 1) * itemsPerPage + 1;
    const lastItemIndex = Math.min(currentPage * itemsPerPage, filteredCompanies.length);

    const itemsPerPageOptions = [
        { value: '9', label: '9 cards/page' },
        { value: '18', label: '18 cards/page' },
        { value: '27', label: '27 cards/page' },
        { value: '36', label: '36 cards/page' }
    ];

    return (
        <div className="flex py-3 items-center justify-end pr-6">
            <p className="text-sm text-gray-700 mr-6">
                {firstItemIndex} - {lastItemIndex} of {filteredCompanies.length} companies
            </p>

            <div className="inline-flex rounded-md gap-2 mr-8" aria-label="Pagination">
                <button 
                    onClick={() => handleArrowClick('left')} 
                    className="px-1 py-1 border border-gray-300 text-sm font-medium text-gray-500 hover:bg-gray-50 rounded"
                >
                    <CaretLeftIcon className="text-gray-900" />
                </button>
                {ListPageButtons()}
                <button 
                    onClick={() => handleArrowClick('right')} 
                    className="px-1 py-1 border border-gray-300 text-sm font-medium text-gray-500 hover:bg-gray-50 rounded"
                >
                    <CaretRightIcon className="text-gray-900" />
                </button>
            </div>

            <CustomSelect
                value={itemsPerPage.toString()}
                onValueChange={(value) => onItemsPerPageChange(Number(value) as ItemsPerPage)}
                options={itemsPerPageOptions}
                placeholder="Cards per page"
            />
        </div>
    );
};

export default CompaniesPagination;
