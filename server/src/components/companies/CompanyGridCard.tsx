import Link from "next/link";
import { ICompany } from "server/src/interfaces/company.interfaces";

interface CompanyGridCardProps {
    company: ICompany;
    selectedCompanies: string[];
    handleCheckboxChange: (companyId: string) => void;
}

const CompanyGridCard = ({ company, selectedCompanies, handleCheckboxChange }: CompanyGridCardProps) => {
    return (
        <div className="bg-white rounded-md border border-gray-300 border-2 relative pb-8">
            {/* Checkbox */}
            <div className="absolute top-1 left-2">
                <input
                    type="checkbox"
                    className="form-checkbox h-4 w-4 rounded"
                    checked={selectedCompanies.includes(company.company_id)}
                    onChange={() => handleCheckboxChange(company.company_id)}
                />
            </div>

            {/* Background */}
            <div className="flex justify-center bg-[#EDF2FD] py-6">
                <div className="w-8 h-8 bg-white rounded"></div>
            </div>

            {/* Company Info */}
            <div className="p-4">
                <Link href={`/msp/companies/${company.company_id}`}>
                    <h2 className="text-md font-bold">{company.company_name}</h2>
                </Link>
                <p className="text-sm text-gray-600">
                    <span className="me-1 font-bold">Type:</span>
                    {company.client_type || 'N/A'}
                </p>
                <p className="text-sm text-gray-600">
                    <span className="me-1 font-bold">Phone:</span>
                    {company.phone_no || 'N/A'}
                </p>
                <p className="text-sm text-gray-600">
                    <span className="me-1 font-bold">Address:</span>
                    {company.address || 'N/A'}
                </p>
                <div className="text-sm text-gray-600">
                    <span className="me-1 font-bold">URL:</span>
                    {company.url && company.url.trim() !== '' ? (
                        <a href={company.url} target="_blank" rel="noopener noreferrer" className="text-blue-600">
                        {company.url}
                        </a>
                    ) : (
                        'N/A'
                    )}
                </div>
            </div>
        </div>
    );
};

export default CompanyGridCard;