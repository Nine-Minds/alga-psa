'use client';

import { CaretLeftIcon, CaretRightIcon } from '@radix-ui/react-icons';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { ButtonComponent } from 'server/src/types/ui-reflection/types';

interface DocumentsPaginationProps {
    id: string;
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

const DocumentsPagination = ({ id, currentPage, totalPages, onPageChange }: DocumentsPaginationProps) => {
    const handlePrevious = () => {
        if (currentPage > 1) {
            onPageChange(currentPage - 1);
        }
    };

    const handleNext = () => {
        if (currentPage < totalPages) {
            onPageChange(currentPage + 1);
        }
    };

    if (totalPages <= 1) {
        return null; // Don't render pagination if there's only one page or no pages
    }

    return (
        <ReflectionContainer id={id} label="Documents Pagination">
            <div className="flex justify-center items-center mt-3 space-x-2">
                <button
                    {...useAutomationIdAndRegister<ButtonComponent>({
                        id: `${id}-prev-btn`,
                        type: 'button',
                        label: 'Previous Page',
                        actions: ['click']
                    }).automationIdProps}
                    onClick={handlePrevious}
                    disabled={currentPage === 1}
                    className="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                    <CaretLeftIcon />
                </button>
                <span className="text-sm text-gray-700">
                    Page {currentPage} of {totalPages}
                </span>
                <button
                    {...useAutomationIdAndRegister<ButtonComponent>({
                        id: `${id}-next-btn`,
                        type: 'button',
                        label: 'Next Page',
                        actions: ['click']
                    }).automationIdProps}
                    onClick={handleNext}
                    disabled={currentPage === totalPages}
                    className="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                    <CaretRightIcon />
                </button>
            </div>
        </ReflectionContainer>
    );
};

export default DocumentsPagination;
