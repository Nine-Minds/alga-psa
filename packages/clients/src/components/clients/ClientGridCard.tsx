import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { ReflectedDropdownMenu } from "@alga-psa/ui/components/ReflectedDropdownMenu";
import { MoreVertical, Pencil, Trash2, ExternalLink, Shield, ShieldOff } from 'lucide-react';
import { MouseEvent } from 'react';
import type { IClient } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import ClientAvatar from '@alga-psa/ui/components/ClientAvatar';
import { TagManager } from '@alga-psa/tags/components';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';

interface ClientGridCardProps {
    client: IClient;
    selectedClients: string[];
    handleCheckboxChange: (clientId: string) => void;
    handleEditClient: (clientId: string) => void;
    handleDeleteClient: (client: IClient) => void;
    onQuickView?: (client: IClient) => void;
    tags?: ITag[];
    allUniqueTags?: string[];
    onTagsChange?: (clientId: string, tags: ITag[]) => void;
}

const ClientGridCard = ({
    client,
    selectedClients,
    handleCheckboxChange,
    handleEditClient,
    handleDeleteClient,
    onQuickView,
    tags = [],
    allUniqueTags = [],
    onTagsChange
}: ClientGridCardProps) => {
    const router = useRouter();
    const isDefault = (client as any).is_default;

    const handleCardClick = () => {
        router.push(`/msp/clients/${client.client_id}`);
    };

    const stopPropagation = (e: MouseEvent) => {
        e.stopPropagation();
    };

    return (
        <div
            className="bg-white rounded-md border border-gray-200 shadow-md p-3 cursor-pointer hover:shadow-lg transition-shadow duration-200 flex flex-col relative"
            onClick={handleCardClick}
            data-testid={`client-card-${client.client_id}`}
        >
            <div className="flex items-center space-x-3 w-full">
                {/* Checkbox */}
                <div onClick={stopPropagation} className="flex-shrink-0 [&>div]:mb-0">
                    <Checkbox
                        id={`client-checkbox-${client.client_id}`}
                        checked={selectedClients.includes(client.client_id)}
                        onChange={() => handleCheckboxChange(client.client_id)}
                        aria-label={`Select client ${client.client_name}`}
                        data-testid={`client-checkbox-${client.client_id}`}
                    />
                </div>

                {/* Client Avatar */}
                <div className="flex-shrink-0">
                    <ClientAvatar
                        clientId={client.client_id}
                        clientName={client.client_name}
                        logoUrl={client.logoUrl ?? null}
                        size="lg"
                    />
                </div>

                {/* Client Info */}
                <div className="flex-1 min-w-0">
                    <h2 className="text-md font-semibold text-gray-800 truncate flex items-center gap-2" title={client.client_name}>
                        <a
                          href={`/msp/clients/${client.client_id}`}
                          onClick={stopPropagation}
                          className="text-blue-600 hover:underline"
                        >
                            {client.client_name}
                        </a>
                        {isDefault && (
                            <div className="inline-flex items-center px-2 py-0.5 rounded-full bg-purple-100" title="Default Client">
                                <Shield className="h-3 w-3 text-purple-600 mr-1" />
                                <span className="text-xs text-purple-700 font-medium">Default</span>
                            </div>
                        )}
                        {client.is_tax_exempt && (
                            <Tooltip content="This client is tax exempt - no taxes will be applied to their invoices">
                                <div className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100">
                                    <ShieldOff className="h-3 w-3 text-amber-600 mr-1" />
                                    <span className="text-xs text-amber-700 font-medium">Tax Exempt</span>
                                </div>
                            </Tooltip>
                        )}
                    </h2>
                    <div className="text-sm text-gray-600 mt-1 space-y-0.5">
                        <p className="truncate">
                            <span className="font-medium text-gray-700">Type:</span>
                            <span className="ml-1">{client.client_type || 'N/A'}</span>
                        </p>
                        <p className="truncate">
                            <span className="font-medium text-gray-700">Phone:</span>
                            <span className="ml-1">{(client as any).location_phone || 'N/A'}</span>
                        </p>
                        <p className="truncate">
                            <span className="font-medium text-gray-700">Address:</span>
                            <span className="ml-1">{(
                                (client as any).address_line1 
                                    ? [(client as any).address_line1, (client as any).city, (client as any).state_province].filter(Boolean).join(', ')
                                    : 'N/A'
                            )}</span>
                        </p>
                        <div className="truncate">
                            <span className="font-medium text-gray-700">URL:</span>
                            {client.url && client.url.trim() !== '' ? (
                                <a
                                    href={client.url.startsWith('http') ? client.url : `https://${client.url}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-1 text-blue-600 hover:underline"
                                    onClick={stopPropagation}
                                    data-testid={`client-url-link-${client.client_id}`}
                                >
                                    {client.url}
                                </a>
                            ) : (
                                <span className="ml-1">N/A</span>
                            )}
                        </div>
                        
                        {/* Tags */}
                        {onTagsChange && (
                            <div className="mt-2" onClick={stopPropagation}>
                                <TagManager
                                    entityId={client.client_id}
                                    entityType="client"
                                    initialTags={tags}
                                    onTagsChange={(updatedTags) => onTagsChange(client.client_id, updatedTags)}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Actions Menu */}
                <div onClick={stopPropagation} className="flex-shrink-0">
                    <ReflectedDropdownMenu
                        id={`client-actions-${client.client_id}`}
                        triggerLabel="Client Actions"
                        trigger={
                            <Button
                                id={`client-actions-trigger-${client.client_id}`}
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <MoreVertical className="h-4 w-4" />
                                <span className="sr-only">Client Actions</span>
                            </Button>
                        }
                        items={[
                            ...(onQuickView ? [{
                                id: 'quick-view',
                                text: 'Quick View',
                                icon: <ExternalLink size={14} />,
                                variant: 'default' as const,
                                onSelect: () => onQuickView(client)
                            }] : []),
                            {
                                id: 'edit',
                                text: 'Edit',
                                icon: <Pencil size={14} />,
                                variant: 'default',
                                onSelect: () => handleEditClient(client.client_id)
                            },
                            ...(!isDefault ? [{
                                id: 'delete',
                                text: 'Delete',
                                icon: <Trash2 size={14} />,
                                variant: 'destructive' as const,
                                onSelect: () => handleDeleteClient(client)
                            }] : [])
                        ]}
                        contentProps={{
                            align: "end",
                            sideOffset: 5,
                            className: "bg-white rounded-md shadow-lg p-1 border border-gray-200 min-w-[120px]",
                            onClick: (e) => e.stopPropagation()
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

export default ClientGridCard;
