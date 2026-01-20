import type { IClient } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import ClientGridCard from "./ClientGridCard";
import Pagination from '@alga-psa/ui/components/Pagination';
import { useState } from 'react';

interface ClientsGridProps {
    filteredClients: IClient[];
    selectedClients: string[];
    handleCheckboxChange: (clientId: string) => void;
    handleEditClient: (clientId: string) => void;
    handleDeleteClient: (client: IClient) => void;
    onQuickView?: (client: IClient) => void;
    currentPage: number;
    pageSize: number;
    totalCount: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    clientTags?: Record<string, ITag[]>;
    allUniqueTags?: ITag[];
    onTagsChange?: (clientId: string, tags: ITag[]) => void;
}

type ItemsPerPage = 9 | 18 | 27 | 36;

const ClientsGrid = ({ 
    filteredClients, 
    selectedClients, 
    handleCheckboxChange, 
    handleEditClient, 
    handleDeleteClient,
    onQuickView,
    currentPage,
    pageSize,
    totalCount,
    onPageChange,
    onPageSizeChange,
    clientTags = {},
    allUniqueTags = [],
    onTagsChange
}: ClientsGridProps) => {
    
    const itemsPerPageOptions = [
        { value: '9', label: '9 cards/page' },
        { value: '18', label: '18 cards/page' },
        { value: '27', label: '27 cards/page' },
        { value: '36', label: '36 cards/page' }
    ];

    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredClients.map((client): React.JSX.Element => (
                    <div key={client.client_id} className="relative">
                        <ClientGridCard
                            client={client}
                            selectedClients={selectedClients}
                            handleCheckboxChange={handleCheckboxChange}
                            handleEditClient={handleEditClient}
                            handleDeleteClient={handleDeleteClient}
                            onQuickView={onQuickView}
                            tags={clientTags[client.client_id] || []}
                            allUniqueTags={allUniqueTags.map(tag => tag.tag_text)}
                            onTagsChange={onTagsChange}
                        />
                    </div>
                ))}
            </div>

            <Pagination
                id="clients-pagination"
                totalItems={totalCount}
                itemsPerPage={pageSize as ItemsPerPage}
                currentPage={currentPage}
                onPageChange={onPageChange}
                onItemsPerPageChange={onPageSizeChange}
                variant="clients"
                itemLabel="clients"
                itemsPerPageOptions={itemsPerPageOptions}
            />
        </div>
    );
};

export default ClientsGrid;
