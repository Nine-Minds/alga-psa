'use client';
import Pagination from '@alga-psa/ui/components/Pagination';
const DocumentsPagination = ({ id, currentPage, totalItems, itemsPerPage, onPageChange, onItemsPerPageChange, itemsPerPageOptions }) => {
    return (<Pagination id={id} currentPage={currentPage} totalItems={totalItems} itemsPerPage={itemsPerPage} onPageChange={onPageChange} onItemsPerPageChange={onItemsPerPageChange} itemsPerPageOptions={itemsPerPageOptions} variant={onItemsPerPageChange ? "clients" : "compact"}/>);
};
export default DocumentsPagination;
//# sourceMappingURL=DocumentsPagination.jsx.map