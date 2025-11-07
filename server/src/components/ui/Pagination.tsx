'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { usePagination } from 'server/src/hooks/usePagination';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { ReactNode } from 'react';
import { useTranslation } from 'server/src/lib/i18n/client';

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
    itemsPerPageOptions
}: PaginationProps) => {
    const { t } = useTranslation('common');

    const resolvedItemLabel =
        itemLabel || t('pagination.itemsLabel', 'items');

    const resolvedItemsPerPageOptions =
        (itemsPerPageOptions && itemsPerPageOptions.length > 0)
            ? itemsPerPageOptions
            :
        [
            {
                value: '9',
                label: t('pagination.itemsPerPageOption', { count: 9, defaultValue: '9 items/page' }),
            },
            {
                value: '18',
                label: t('pagination.itemsPerPageOption', { count: 18, defaultValue: '18 items/page' }),
            },
            {
                value: '27',
                label: t('pagination.itemsPerPageOption', { count: 27, defaultValue: '27 items/page' }),
            },
            {
                value: '36',
                label: t('pagination.itemsPerPageOption', { count: 36, defaultValue: '36 items/page' }),
            },
        ];

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
        const maxVisiblePages = 5; // Show up to 5 page numbers (current page centered)
        const sidePages = Math.floor(maxVisiblePages / 2); // Pages to show on each side of current

        // Calculate the range of pages to display
        let startPage = Math.max(1, currentPage - sidePages);
        let endPage = Math.min(totalPages, currentPage + sidePages);

        // Adjust if we're near the beginning or end
        if (currentPage <= sidePages) {
            endPage = Math.min(totalPages, maxVisiblePages);
        } else if (currentPage >= totalPages - sidePages) {
            startPage = Math.max(1, totalPages - maxVisiblePages + 1);
        }

        // Add first page and ellipsis if needed
        if (startPage > 1) {
            buttons.push(
                <button
                    key={1}
                    onClick={() => handleChange(1)}
                    className="border-gray-300 text-gray-500 hover:bg-[rgb(var(--color-primary-50))] hover:text-[rgb(var(--color-primary-700))] px-2 py-1 border text-sm font-medium rounded"
                >
                    1
                </button>
            );
            if (startPage > 2) {
                buttons.push(
                    <span
                        key="ellipsis-start"
                        className="border border-gray-300 px-2 py-1 text-sm font-medium text-gray-700 rounded"
                    >
                        ...
                    </span>
                );
            }
        }

        // Add the range of pages around current page
        for (let i = startPage; i <= endPage; i++) {
            buttons.push(
                <button
                    key={i}
                    onClick={() => handleChange(i)}
                    className={`${
                        currentPage === i
                            ? "border-[rgb(var(--color-primary-500))] text-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-50))]"
                            : "border-gray-300 text-gray-500 hover:bg-[rgb(var(--color-primary-50))] hover:text-[rgb(var(--color-primary-700))]"
                    } px-2 py-1 border text-sm font-medium rounded`}
                >
                    {i}
                </button>
            );
        }

        // Add ellipsis and last page if needed
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                buttons.push(
                    <span
                        key="ellipsis-end"
                        className="border border-gray-300 px-2 py-1 text-sm font-medium text-gray-700 rounded"
                    >
                        ...
                    </span>
                );
            }
            buttons.push(
                <button
                    key={totalPages}
                    onClick={() => handleChange(totalPages)}
                    className="border-gray-300 text-gray-500 hover:bg-[rgb(var(--color-primary-50))] hover:text-[rgb(var(--color-primary-700))] px-2 py-1 border text-sm font-medium rounded"
                >
                    {totalPages}
                </button>
            );
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
            <ReflectionContainer
                id={id}
                label={t('pagination.reflectionLabel', 'Pagination')}
            >
                <div className={`flex py-3 items-center justify-end pr-6 ${className}`}>
                    <p className="text-sm text-gray-700 mr-6">
                        {t('pagination.totalItems', {
                            count: totalItems,
                            itemLabel: resolvedItemLabel,
                            defaultValue: `${totalItems} ${resolvedItemLabel} total`
                        })}
                    </p>
                    <CustomSelect
                        value={itemsPerPage.toString()}
                        onValueChange={(value) => onItemsPerPageChange(Number(value))}
                        options={resolvedItemsPerPageOptions}
                        placeholder={t('pagination.itemsPerPagePlaceholder', 'Items per page')}
                    />
                </div>
            </ReflectionContainer>
        );
    }

    // Render the appropriate variant
    if (variant === 'clients') {
        return (
            <ReflectionContainer
                id={id}
                label={t('pagination.reflectionLabel', 'Pagination')}
            >
                <div className={`flex py-3 items-center justify-end pr-6 ${className}`}>
                    <p className="text-sm text-gray-700 mr-6">
                        {t('pagination.range', {
                            from: firstItemIndex,
                            to: lastItemIndex,
                            total: totalItems,
                            itemLabel: resolvedItemLabel,
                            defaultValue: `${firstItemIndex} - ${lastItemIndex} of ${totalItems} ${resolvedItemLabel}`
                        })}
                    </p>

                    <div
                        className="inline-flex rounded-md gap-2 mr-8"
                        aria-label={t('pagination.ariaLabel', 'Pagination')}
                    >
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
                            options={resolvedItemsPerPageOptions}
                            placeholder={t('pagination.itemsPerPagePlaceholder', 'Items per page')}
                        />
                    )}
                </div>
            </ReflectionContainer>
        );
    }

    if (variant === 'numbered') {
        return (
            <ReflectionContainer
                id={id}
                label={t('pagination.reflectionLabel', 'Pagination')}
            >
                <div className={`flex justify-center items-center py-4 ${className}`}>
                    <div
                        className="inline-flex rounded-md gap-1"
                        aria-label={t('pagination.ariaLabel', 'Pagination')}
                    >
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
        <ReflectionContainer
            id={id}
            label={t('pagination.reflectionLabel', 'Pagination')}
        >
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
                                {t('pagination.pageOf', {
                                    current: currentPage,
                                    total: totalPages,
                                    defaultValue: `Page ${currentPage} of ${totalPages}`
                                })}
                                {showTotalItems
                                    ? ` ${t('pagination.totalRecordsInline', {
                                        count: totalItems,
                                        defaultValue: `(${totalItems} total records)`
                                    })}`
                                    : ''}
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
                                {t('pagination.previous', 'Previous')}
                            </button>
                            <span className="text-sm text-[rgb(var(--color-text-700))]">
                                {t('pagination.pageOf', {
                                    current: currentPage,
                                    total: totalPages,
                                    defaultValue: `Page ${currentPage} of ${totalPages}`
                                })}
                                {showTotalItems
                                    ? ` ${t('pagination.totalRecordsInline', {
                                        count: totalItems,
                                        defaultValue: `(${totalItems} total records)`
                                    })}`
                                    : ''}
                            </span>
                            <button
                                id={`${id}-next-btn`}
                                onClick={() => handleChange(currentPage + 1)}
                                disabled={currentPage === totalPages}
                                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-[rgb(var(--color-text-700))] bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {t('pagination.next', 'Next')}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </ReflectionContainer>
    );
};

export default Pagination;
