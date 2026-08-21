import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { ReflectedDropdownMenu } from "@alga-psa/ui/components/ReflectedDropdownMenu";
import { MoreVertical, Pencil, Trash2, ExternalLink, Mail, Phone, MapPin, Globe, UserCircle2, Ticket } from 'lucide-react';
import { MouseEvent } from 'react';
import type { IClient } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import ClientAvatar from '@alga-psa/ui/components/ClientAvatar';
import { TagManager } from '@alga-psa/tags/components';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
    /** Out-of-band count; undefined while the batch is still in flight. */
    openTicketCount?: number;
}

/** One icon + value line. Rendered only when there is a value to show. */
const MetaRow = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
    <div className="flex items-center gap-2 min-w-0 text-sm text-[rgb(var(--color-text-600))]">
        <span className="flex-shrink-0 text-[rgb(var(--color-text-400))]">{icon}</span>
        <span className="truncate">{children}</span>
    </div>
);

const ClientGridCard = ({
    client,
    selectedClients,
    handleCheckboxChange,
    handleEditClient,
    handleDeleteClient,
    onQuickView,
    tags = [],
    allUniqueTags = [],
    onTagsChange,
    openTicketCount
}: ClientGridCardProps) => {
    const router = useRouter();
    const { t } = useTranslation('msp/clients');
    const isDefault = (client as any).is_default;

    const handleCardClick = () => {
        router.push(`/msp/clients/${client.client_id}`);
    };

    const stopPropagation = (e: MouseEvent) => {
        e.stopPropagation();
    };

    // Every field on this card is conditional. Production fill rates are low
    // enough (phone 55%, url 34%, account manager 11%) that rendering "N/A"
    // placeholders turned a sparse client into a wall of nothing. client_type is
    // not shown at all: it is 'company' on 98% of records, so the row carried no
    // information. Absent rows are the signal now — a short card is a thin record.
    const email = (client as any).location_email as string | undefined;
    const phone = (client as any).location_phone as string | undefined;
    const address = (client as any).address_line1
        ? [(client as any).address_line1, (client as any).city, (client as any).state_province]
            .filter(Boolean).join(', ')
        : null;
    const url = client.url && client.url.trim() !== '' ? client.url : null;
    const accountManager = client.account_manager_full_name;
    const lifecycle = client.lifecycle_status;

    const hasMeta = Boolean(email || phone || address || url);

    return (
        <div
            className="group flex flex-col rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4 cursor-pointer shadow-sm dark:shadow-[0_1px_3px_rgb(0_0_0/0.4)] transition-colors hover:border-[rgb(var(--color-primary-500)/0.5)] hover:bg-[rgb(var(--color-primary-500)/0.03)]"
            onClick={handleCardClick}
            data-testid={`client-card-${client.client_id}`}
        >
            {/* Header: selection, identity, actions */}
            <div className="flex items-start gap-3">
                <div onClick={stopPropagation} className="flex-shrink-0 pt-1">
                    <Checkbox
                        id={`client-checkbox-${client.client_id}`}
                        checked={selectedClients.includes(client.client_id)}
                        onChange={() => handleCheckboxChange(client.client_id)}
                        aria-label={t('clientGridCard.selectClient', {
                            defaultValue: 'Select client {{name}}',
                            name: client.client_name
                        })}
                        data-testid={`client-checkbox-${client.client_id}`}
                    />
                </div>

                <div className="flex-shrink-0">
                    <ClientAvatar
                        clientId={client.client_id}
                        clientName={client.client_name}
                        logoUrl={client.logoUrl ?? null}
                        size="lg"
                    />
                </div>

                <div className="flex-1 min-w-0">
                    {/* Not a link: the whole card already navigates here, so a blue
                        anchor inside it was a second affordance for one action. */}
                    <h2
                        className="text-[15px] font-semibold text-[rgb(var(--color-text-900))] truncate"
                        title={client.client_name}
                    >
                        {client.client_name}
                    </h2>

                    {/* Badges are exception-only. In production 'active' covers
                        99.8% of clients and tax exemption 0.2%, so a permanent slot
                        for either would be noise on nearly every card. */}
                    <div className="flex flex-wrap items-center gap-1 mt-1 empty:hidden">
                        {isDefault && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-[rgb(var(--color-primary-500)/0.14)] text-[rgb(var(--color-primary-600))] dark:text-[rgb(var(--color-primary-300))]">
                                {t('clientGridCard.default', { defaultValue: 'Default' })}
                            </span>
                        )}
                        {lifecycle && lifecycle !== 'active' && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-[rgb(var(--color-text-500)/0.14)] text-[rgb(var(--color-text-600))]">
                                {t(`clientGridCard.lifecycle.${lifecycle}`, { defaultValue: lifecycle })}
                            </span>
                        )}
                        {client.is_tax_exempt && (
                            <Tooltip content={t('clientGridCard.taxExemptTooltip', { defaultValue: 'This client is tax exempt - no taxes will be applied to their invoices' })}>
                                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-[rgb(var(--color-accent-500)/0.16)] text-[rgb(var(--color-accent-700))] dark:text-[rgb(var(--color-accent-300))]">
                                    {t('clientGridCard.taxExempt', { defaultValue: 'Tax Exempt' })}
                                </span>
                            </Tooltip>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                    {openTicketCount ? (
                        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold bg-[rgb(var(--color-primary-500)/0.14)] text-[rgb(var(--color-primary-600))] dark:text-[rgb(var(--color-primary-300))]">
                            <Ticket className="h-3 w-3" />
                            {t('clientGridCard.openTickets', {
                                defaultValue: '{{count}} open',
                                count: openTicketCount
                            })}
                        </span>
                    ) : null}
                    <div onClick={stopPropagation}>
                    <ReflectedDropdownMenu
                        id={`client-actions-${client.client_id}`}
                        triggerLabel={t('clientGridCard.clientActions', { defaultValue: 'Client Actions' })}
                        trigger={
                            <Button
                                id={`client-actions-trigger-${client.client_id}`}
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-[rgb(var(--color-text-500))]"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <MoreVertical className="h-4 w-4" />
                                <span className="sr-only">{t('clientGridCard.clientActions', { defaultValue: 'Client Actions' })}</span>
                            </Button>
                        }
                        items={[
                            ...(onQuickView ? [{
                                id: 'quick-view',
                                text: t('clientGridCard.quickView', { defaultValue: 'Quick View' }),
                                icon: <ExternalLink size={14} />,
                                variant: 'default' as const,
                                onSelect: () => onQuickView(client)
                            }] : []),
                            {
                                id: 'edit',
                                text: t('common.actions.edit', { defaultValue: 'Edit' }),
                                icon: <Pencil size={14} />,
                                variant: 'default',
                                onSelect: () => handleEditClient(client.client_id)
                            },
                            ...(!isDefault ? [{
                                id: 'delete',
                                text: t('common.actions.delete', { defaultValue: 'Delete' }),
                                icon: <Trash2 size={14} />,
                                variant: 'destructive' as const,
                                onSelect: () => handleDeleteClient(client)
                            }] : [])
                        ]}
                        contentProps={{
                            align: "end",
                            sideOffset: 5,
                            className: "min-w-[120px]",
                            onClick: (e) => e.stopPropagation()
                        }}
                    />
                    </div>
                </div>
            </div>

            {/* Contact block. Email leads: at 71% it is the best-filled field on
                the record, and it was missing from this card entirely. */}
            {!hasMeta && (
                <p className="mt-3 text-sm text-[rgb(var(--color-text-400))]">
                    {t('clientGridCard.noContactDetails', { defaultValue: 'No contact details' })}
                </p>
            )}
            {hasMeta && (
                <div className="mt-3 flex flex-col gap-1.5">
                    {email && (
                        <MetaRow icon={<Mail className="h-3.5 w-3.5" />}>
                            <a
                                href={`mailto:${email}`}
                                onClick={stopPropagation}
                                className="hover:underline"
                                data-testid={`client-email-link-${client.client_id}`}
                            >
                                {email}
                            </a>
                        </MetaRow>
                    )}
                    {phone && <MetaRow icon={<Phone className="h-3.5 w-3.5" />}>{phone}</MetaRow>}
                    {address && <MetaRow icon={<MapPin className="h-3.5 w-3.5" />}>{address}</MetaRow>}
                    {url && (
                        <MetaRow icon={<Globe className="h-3.5 w-3.5" />}>
                            <a
                                href={url.startsWith('http') ? url : `https://${url}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={stopPropagation}
                                className="text-[rgb(var(--color-primary-600))] dark:text-[rgb(var(--color-primary-300))] hover:underline"
                                data-testid={`client-url-link-${client.client_id}`}
                            >
                                {url}
                            </a>
                        </MetaRow>
                    )}
                </div>
            )}

            {accountManager && (
                <div className="mt-3 flex items-center gap-1.5 min-w-0 text-xs text-[rgb(var(--color-text-500))]">
                    <UserCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-[rgb(var(--color-text-400))]" />
                    <span className="truncate">{accountManager}</span>
                </div>
            )}

            {onTagsChange && (
                <div
                    className={`mt-3 ${tags.length > 0 ? 'pt-3 border-t border-[rgb(var(--color-border-200))] dark:border-[rgb(var(--color-border-300))]' : ''}`}
                    onClick={stopPropagation}
                >
                    <TagManager
                        entityId={client.client_id}
                        entityType="client"
                        initialTags={tags}
                        onTagsChange={(updatedTags) => onTagsChange(client.client_id, updatedTags)}
                    />
                </div>
            )}
        </div>
    );
};

export default ClientGridCard;
