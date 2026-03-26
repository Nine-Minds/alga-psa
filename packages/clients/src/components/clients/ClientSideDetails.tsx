import Link from "next/link";
import type { IClient } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ClientSideDetailsProps {
    client: IClient & {
        location_phone?: string;
        location_email?: string;
        address_line1?: string;
        address_line2?: string;
        city?: string;
        state_province?: string;
        postal_code?: string;
        country_name?: string;
    };
}

const ClientSideDetails = ({ client }: ClientSideDetailsProps) => {
    const { t } = useTranslation('msp/clients');
    // Format location address
    const formatAddress = () => {
        const parts: string[] = [];
        if (client.address_line1) parts.push(client.address_line1);
        if (client.address_line2) parts.push(client.address_line2);
        
        const cityStateZip: string[] = [];
        if (client.city) cityStateZip.push(client.city);
        if (client.state_province) cityStateZip.push(client.state_province);
        if (client.postal_code) cityStateZip.push(client.postal_code);
        
        if (cityStateZip.length > 0) parts.push(cityStateZip.join(', '));
        if (client.country_name) parts.push(client.country_name);
        
        return parts.join('\n');
    };

    return (
        <div className="p-4 bg-[#F7F2FF] rounded-2xl border border-[#8A4DEA] w-72">
            {/* Client name and icon */}
            <div>
                <h2 className="text-md font-bold">{client.client_name}</h2>
                <div className="w-24 h-24 bg-gray-300 rounded-full mx-auto my-6"></div>
            </div>

            {/* Client details */}
            <div className="bg-white p-4 rounded-md border-2 border-gray-300 pb-20">
                <h3 className="text-md font-bold mb-1">{client.client_name}</h3>
                <div className="space-y-4 text-sm">
                    <div>
                        <p className="font-semibold text-gray-700">{t('clientSideDetails.phone', { defaultValue: 'Phone:' })}</p>
                        <p>{client.location_phone || t('common.states.na', { defaultValue: 'N/A' })}</p>
                    </div>
                    <div>
                        <p className="font-semibold text-gray-700">{t('clientSideDetails.url', { defaultValue: 'URL:' })}</p>
                        {client.url ? (
                            <Link href={client.url} className="text-blue-500">
                                {client.url}
                            </Link>
                        ) : (
                            <p>{t('common.states.na', { defaultValue: 'N/A' })}</p>
                        )}
                    </div>
                    <div>
                        <p className="font-semibold text-gray-700">{t('clientSideDetails.address', { defaultValue: 'Address:' })}</p>
                        <p className="whitespace-pre-line">
                            {client.address_line1 ? formatAddress() : t('common.states.na', { defaultValue: 'N/A' })}
                        </p>
                    </div>
                    {client.location_email && (
                        <div>
                            <p className="font-semibold text-gray-700">{t('clientSideDetails.email', { defaultValue: 'Email:' })}</p>
                            <p>{client.location_email}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ClientSideDetails;
