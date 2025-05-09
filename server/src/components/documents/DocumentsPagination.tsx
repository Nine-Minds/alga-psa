'use client';

import Pagination from 'server/src/components/ui/Pagination';

interface DocumentsPaginationProps {
    id: string;
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

const DocumentsPagination = ({ id, currentPage, totalPages, onPageChange }: DocumentsPaginationProps) => {
    const itemsPerPage = 15;
    const totalItems = totalPages * itemsPerPage;

    return (
        <Pagination
            id={id}
            currentPage={currentPage}
            totalItems={totalItems}
            itemsPerPage={itemsPerPage}
            onPageChange={onPageChange}
            variant="compact"
        />
    );
};

export default DocumentsPagination;
