'use client';

import Pagination from 'server/src/components/ui/Pagination';

interface DocumentsPaginationProps {
    id: string;
    currentPage: number;
    totalItems: number;
    itemsPerPage: number;
    onPageChange: (page: number) => void;
    onItemsPerPageChange?: (itemsPerPage: number) => void;
    itemsPerPageOptions?: Array<{ value: string; label: string }>;
}

const DocumentsPagination = ({
    id,
    currentPage,
    totalItems,
    itemsPerPage,
    onPageChange,
    onItemsPerPageChange,
    itemsPerPageOptions
}: DocumentsPaginationProps) => {
    return (
        <Pagination
            id={id}
            currentPage={currentPage}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            onPageChange={onPageChange}
            onItemsPerPageChange={onItemsPerPageChange}
            itemsPerPageOptions={itemsPerPageOptions}
            variant={onItemsPerPageChange ? "clients" : "compact"}
        />
    );
};

export default DocumentsPagination;
