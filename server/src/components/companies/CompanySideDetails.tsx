import Link from "next/link";
import { ICompany } from "server/src/interfaces/company.interfaces";

interface CompanySideDetailsProps {
    company: ICompany & {
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

const CompanySideDetails = ({ company }: CompanySideDetailsProps) => {
    // Format location address
    const formatAddress = () => {
        const parts = [];
        if (company.address_line1) parts.push(company.address_line1);
        if (company.address_line2) parts.push(company.address_line2);
        
        const cityStateZip = [];
        if (company.city) cityStateZip.push(company.city);
        if (company.state_province) cityStateZip.push(company.state_province);
        if (company.postal_code) cityStateZip.push(company.postal_code);
        
        if (cityStateZip.length > 0) parts.push(cityStateZip.join(', '));
        if (company.country_name) parts.push(company.country_name);
        
        return parts.join('\n');
    };

    return (
        <div className="p-4 bg-[#F7F2FF] rounded-2xl border border-[#8A4DEA] w-72">
            {/* Company name and icon */}
            <div>
                <h2 className="text-md font-bold">{company.company_name}</h2>
                <div className="w-24 h-24 bg-gray-300 rounded-full mx-auto my-6"></div>
            </div>

            {/* Company details */}
            <div className="bg-white p-4 rounded-md border-2 border-gray-300 pb-20">
                <h3 className="text-md font-bold mb-1">{company.company_name}</h3>
                <div className="space-y-4 text-sm">
                    <div>
                        <p className="font-semibold text-gray-700">Phone:</p>
                        <p>{company.location_phone || company.phone_no || 'N/A'}</p>
                    </div>
                    <div>
                        <p className="font-semibold text-gray-700">URL:</p>
                        {company.url ? (
                            <Link href={company.url} className="text-blue-500">
                                {company.url}
                            </Link>
                        ) : (
                            <p>N/A</p>
                        )}
                    </div>
                    <div>
                        <p className="font-semibold text-gray-700">Address:</p>
                        <p className="whitespace-pre-line">
                            {company.address_line1 ? formatAddress() : (company.address || 'N/A')}
                        </p>
                    </div>
                    {company.location_email && (
                        <div>
                            <p className="font-semibold text-gray-700">Email:</p>
                            <p>{company.location_email}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CompanySideDetails;