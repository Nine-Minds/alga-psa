'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { usePagination } from 'server/src/hooks/usePagination';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { ReactNode } from 'react';

interface PaginationProps {
    id: string;
    totalItems: number;
    itemsPerPage: number;
    currentPage?: number;
    onPageChange: (page: number) => void;
    variant?: 'compact' | 'full' | 'numbered' | 'clients';
    className?: string;
    showTotalItems?: boolean;
    itemLabel?: string;
    onItemsPerPageChange?: (itemsPerPage: number) => void;
    itemsPerPageOptions?: Array<{ value: string; label: string }>;
}

/**
 * Standardized pagination component that can be used across the application
 * Supports multiple variants:
 * - compact: Icon-only buttons with page info
 * - full: Text buttons with page info
 * - numbered: Page number buttons with ellipsis for many pages
 * - clients: Full featured pagination with page numbers and items per page selector
 */
const Pagination = ({
    id,
    totalItems,
    itemsPerPage,
    currentPage: externalCurrentPage,
    onPageChange,
    variant = 'full',
    className = '',
    showTotalItems = false,
    itemLabel = 'items',
    onItemsPerPageChange,
    itemsPerPageOptions = [
        { value: '9', label: '9 cards/page' },
        { value: '18', label: '18 cards/page' },
        { value: '27', label: '27 cards/page' },
        { value: '36', label: '36 cards/page' }
    ]
}: PaginationProps) => {
    // Use the pagination hook for logic
    const {
        currentPage: internalCurrentPage,
        totalPages,
        handlePageChange
    } = usePagination(totalItems, itemsPerPage);

    // Determine which current page to use (controlled vs uncontrolled)
    const currentPage = externalCurrentPage !== undefined ? externalCurrentPage : internalCurrentPage;

    // Handle page change and call the provided callback
    const handleChange = (page: number) => {
        handlePageChange(page);
        onPageChange(page);
    };

    // Generate page number buttons with ellipsis for many pages
    const renderPageButtons = () => {
        const buttons: ReactNode[] = [];
        
        for (let i = 1; i <= totalPages; i++) {
            if ((i >= 1 && i <= 3) || (i === totalPages)) {
                // Show first 3 pages and last page
                buttons.push(
                    <button
                        key={i}
                        onClick={() => handleChange(i)}
                        className={`${
                            currentPage === i 
                                ? "border-blue-600 text-blue-600" 
                                : "border-gray-300 text-gray-500 hover:bg-gray-50"
                        } px-2 py-1 border text-sm font-medium rounded`}
                    >
                        {i}
                    </button>
                );
            } else if (i === 4 && i < totalPages) {
                // Show ellipsis for pages 4+
                buttons.push(
                    <span 
                        key={i} 
                        className="border border-gray-300 px-2 py-1 text-sm font-medium text-gray-700 rounded"
                    >
                        ...
                    </span>
                );
            }
        }
        
        return buttons;
    };

    // Calculate first and last item indices for display
    const firstItemIndex = (currentPage - 1) * itemsPerPage + 1;
    const lastItemIndex = Math.min(currentPage * itemsPerPage, totalItems);

    // Don't render pagination if there's only one page AND no page size selector
    if (totalPages <= 1 && !onItemsPerPageChange) {
        return null;
    }

    // If only one page but page size selector is available, show simplified version
    if (totalPages <= 1 && onItemsPerPageChange) {
        return (
            <ReflectionContainer id={id} label="Pagination">
                <div className={`flex py-3 items-center justify-end pr-6 ${className}`}>
                    <p className="text-sm text-gray-700 mr-6">
                        {totalItems} {itemLabel} {totalItems === 1 ? '' : 'total'}
                    </p>
                    <CustomSelect
                        value={itemsPerPage.toString()}
                        onValueChange={(value) => onItemsPerPageChange(Number(value))}
                        options={itemsPerPageOptions}
                        placeholder="Items per page"
                    />
                </div>
            </ReflectionContainer>
        );
    }

    // Render the appropriate variant
    if (variant === 'clients') {
        return (
            <ReflectionContainer id={id} label="Pagination">
                <div className={`flex py-3 items-center justify-end pr-6 ${className}`}>
                    <p className="text-sm text-gray-700 mr-6">
                        {firstItemIndex} - {lastItemIndex} of {totalItems} {itemLabel}
                    </p>

                    <div className="inline-flex rounded-md gap-2 mr-8" aria-label="Pagination">
                        <button 
                            id={`${id}-prev-btn`}
                            onClick={() => handleChange(currentPage - 1)} 
                            disabled={currentPage === 1}
                            className="px-1 py-1 border border-gray-300 text-sm font-medium text-gray-500 hover:bg-gray-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft className="text-gray-900" />
                        </button>
                        {renderPageButtons()}
                        <button 
                            id={`${id}-next-btn`}
                            onClick={() => handleChange(currentPage + 1)} 
                            disabled={currentPage === totalPages}
                            className="px-1 py-1 border border-gray-300 text-sm font-medium text-gray-500 hover:bg-gray-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ChevronRight className="text-gray-900" />
                        </button>
                    </div>

                    {onItemsPerPageChange && (
                        <CustomSelect
                            value={itemsPerPage.toString()}
                            onValueChange={(value) => onItemsPerPageChange(Number(value))}
                            options={itemsPerPageOptions}
                            placeholder="Items per page"
                        />
                    )}
                </div>
            </ReflectionContainer>
        );
    }

    if (variant === 'numbered') {
        return (
            <ReflectionContainer id={id} label="Pagination">
                <div className={`flex justify-center items-center py-4 ${className}`}>
                    <div className="inline-flex rounded-md gap-1" aria-label="Pagination">
                        <button 
                            id={`${id}-prev-btn`}
                            onClick={() => handleChange(currentPage - 1)} 
                            disabled={currentPage === 1}
                            className="px-1 py-1 border border-gray-300 text-sm font-medium text-gray-500 hover:bg-gray-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft className="text-gray-900" />
                        </button>
                        {renderPageButtons()}
                        <button 
                            id={`${id}-next-btn`}
                            onClick={() => handleChange(currentPage + 1)} 
                            disabled={currentPage === totalPages}
                            className="px-1 py-1 border border-gray-300 text-sm font-medium text-gray-500 hover:bg-gray-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <ChevronRight className="text-gray-900" />
                        </button>
                    </div>
                </div>
            </ReflectionContainer>
        );
    }

    return (
        <ReflectionContainer id={id} label="Pagination">
            <div className={`px-6 py-4 bg-white ${className}`}>
                <div className="flex items-center justify-between space-x-4">
                    {variant === 'compact' ? (
                        // Compact variant with icon buttons
                        <>
                            <button
                                id={`${id}-prev-btn`}
                                onClick={() => handleChange(currentPage - 1)}
                                disabled={currentPage === 1}
                                className="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <span className="text-sm text-[rgb(var(--color-text-700))]">
                                Page {currentPage} of {totalPages}
                                {showTotalItems && ` (${totalItems} total records)`}
                            </span>
                            <button
                                id={`${id}-next-btn`}
                                onClick={() => handleChange(currentPage + 1)}
                                disabled={currentPage === totalPages}
                                className="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </>
                    ) : (
                        // Full variant with text buttons
                        <>
                            <button
                                id={`${id}-prev-btn`}
                                onClick={() => handleChange(currentPage - 1)}
                                disabled={currentPage === 1}
                                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-[rgb(var(--color-text-700))] bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Previous
                            </button>
                            <span className="text-sm text-[rgb(var(--color-text-700))]">
                                Page {currentPage} of {totalPages}
                                {showTotalItems && ` (${totalItems} total records)`}
                            </span>
                            <button
                                id={`${id}-next-btn`}
                                onClick={() => handleChange(currentPage + 1)}
                                disabled={currentPage === totalPages}
                                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-[rgb(var(--color-text-700))] bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Next
                            </button>
                        </>
                    )}
                </div>
            </div>
        </ReflectionContainer>
    );
};

export default Pagination;