'use client';

import { CaretLeftIcon, CaretRightIcon } from '@radix-ui/react-icons';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { ButtonComponent } from 'server/src/types/ui-reflection/types';

interface DocumentsPaginationProps {
    id: string;
}

const DocumentsPagination = ({ id }: DocumentsPaginationProps) => {
    return (
        <ReflectionContainer id={id} label="Documents Pagination">
            <div className="flex justify-center mt-3">
                <div className="flex gap-2">
                    <button
                        {...useAutomationIdAndRegister<ButtonComponent>({
                            id: `${id}-prev-btn`,
                            type: 'button',
                            label: 'Previous Page',
                            actions: ['click']
                        }).automationIdProps}
                        className="w-7 h-7 flex items-center justify-center border border-gray-200 rounded-md"
                    >
                        <CaretLeftIcon />
                    </button>
                    <button
                        {...useAutomationIdAndRegister<ButtonComponent>({
                            id: `${id}-next-btn`,
                            type: 'button',
                            label: 'Next Page',
                            actions: ['click']
                        }).automationIdProps}
                        className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md"
                    >
                        <CaretRightIcon />
                    </button>
                </div>
            </div>
        </ReflectionContainer>
    );
};

export default DocumentsPagination;
