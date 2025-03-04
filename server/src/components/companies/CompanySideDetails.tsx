import Link from "next/link";
import { ICompany } from "server/src/interfaces/company.interfaces";

interface CompanySideDetailsProps {
    company: ICompany;
}

const CompanySideDetails = ({ company }: CompanySideDetailsProps) => {
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
                        <p>{company.phone_no}</p>
                    </div>
                    <div>
                        <p className="font-semibold text-gray-700">URL:</p>
                        <Link href={company.url} className="text-blue-500">
                            {company.url}
                        </Link>
                    </div>
                    <div>
                        <p className="font-semibold text-gray-700">Address:</p>
                        <p>{company.address}</p>
                    </div>
                    <div>
                        <p className="font-semibold text-gray-700">Link:</p>
                        <p></p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CompanySideDetails;